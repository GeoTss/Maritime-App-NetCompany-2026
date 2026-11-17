/**
 * LLM 2: the ops agent. One tool-runner loop over typed tools; deterministic code computes every
 * number as a cited fact, and the release gate withholds any answer whose numbers are not facts
 * (after one repair turn). Each ask's fact ledger starts with the conversation's earlier facts.
 * Conversations, messages (with each gate attempt on the assistant message) and model calls are
 * persisted.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaToolRunContext } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { Sql } from "@pharos/db";
import type {
  AgentToolName,
  AskEvent,
  AskResult,
  Fact,
  GateAttempt,
  GateResult,
  Id,
} from "@pharos/shared";
import type { AppConfig } from "../config.js";
import { withCallCapture } from "./call-capture.js";
import { loadConversationFacts } from "./fact-ledger.js";
import { FALLBACK_BETA, usesFallbacks } from "./fallbacks.js";
import { recordLlmCall } from "./llm.js";
import { AGENT_SYSTEM, PROMPT_VERSION } from "./prompts/agent-system.js";
import { checkNumbers, citedFactIds } from "./release-gate.js";
import { createToolContext, json } from "./tools/common.js";
import { type AgentTools, agentTools } from "./tools/registry.js";

export type AgentConfig = Pick<AppConfig, "agentModel" | "agentEffort" | "llmFallbacks">;

export interface AgentDeps {
  sql: Sql;
  llm: { client: Anthropic };
  config: AgentConfig;
  /** Clock for the tools ("now") and row timestamps. Never reaches the prompt. */
  now?: () => Date;
  log?: (message: string) => void;
  /** Called when each tool call starts (ms 0) and finishes (elapsed ms); names no input or output. */
  onProgress?: (event: ToolProgress) => void;
}

export type ToolProgress = Omit<Extract<AskEvent, { type: "progress" }>, "type">;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Message = Anthropic.Beta.BetaMessage;

/** Fits a non-streaming request; answers are short, the rest is adaptive thinking. */
const MAX_TOKENS = 16_000;
/** Model requests per turn (tool calls plus the answer); bounds cost and latency. */
export const MAX_ITERATIONS = 8;

/** The model's turn ended without a usable answer (refusal, truncation, no finish). */
export class AgentError extends Error {
  override name = "AgentError";
  constructor(
    message: string,
    readonly reason: AgentErrorReason,
  ) {
    super(message);
  }
}

/** Why the model's turn gave no answer: it declined, ran out of tokens, or otherwise did not finish. */
export type AgentErrorReason = "refusal" | "truncation" | "agent_error";

/** Every way an ask fails that a caller tells apart (see ask/failure.ts); `internal` is the rest. */
export type AgentFailureReason =
  | AgentErrorReason
  | "replay_miss"
  | "api_error"
  | "conversation_not_found";

export class ConversationNotFoundError extends Error {
  override name = "ConversationNotFoundError";
  constructor(readonly conversationId: Id) {
    super(`Conversation ${conversationId} does not exist.`);
  }
}

/**
 * The tool runner request. `thread: false` sends the full history every turn, with no server-side
 * state, so each request is self-contained and replays from its recording.
 */
export function agentRunnerParams(
  config: AgentConfig,
  tools: AgentTools,
  messages: MessageParam[],
): BetaToolRunnerParams {
  const params: BetaToolRunnerParams = {
    model: config.agentModel,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools,
    tool_choice: { type: "auto" },
    output_config: { effort: config.agentEffort },
    messages,
    thread: false,
    max_iterations: MAX_ITERATIONS,
  };
  if (!usesFallbacks(config.agentModel, config.llmFallbacks)) return params;
  return { ...params, betas: [FALLBACK_BETA], fallbacks: "default" };
}

/**
 * Reports each tool call's start and end (`failed` when it throws, which still propagates), keyed by
 * the `tool_use` id; the tool objects (so the request body) are unchanged.
 */
export function withProgress(
  tools: AgentTools,
  onProgress?: (event: ToolProgress) => void,
): AgentTools {
  if (!onProgress) return tools;
  return tools.map((tool) => {
    const inner = tool as { name: AgentToolName; run: (...args: unknown[]) => unknown };
    return {
      ...tool,
      run: async (...args: unknown[]) => {
        const callId = (args[1] as BetaToolRunContext | undefined)?.toolUse?.id;
        if (!callId) throw new Error("tool run without a tool_use id");
        const started = Date.now();
        onProgress({ callId, tool: inner.name, phase: "started", ms: 0 });
        try {
          const result = await inner.run(...args);
          onProgress({ callId, tool: inner.name, phase: "finished", ms: Date.now() - started });
          return result;
        } catch (err) {
          onProgress({ callId, tool: inner.name, phase: "failed", ms: Date.now() - started });
          throw err;
        }
      },
    };
  }) as AgentTools;
}

/** Runs the tool loop to its final message; returns it with the full history (ending with it). */
async function runTurn(
  deps: AgentDeps,
  tools: AgentTools,
  messages: MessageParam[],
): Promise<{ final: Message; history: MessageParam[] }> {
  const runner = deps.llm.client.beta.messages.toolRunner(
    agentRunnerParams(deps.config, tools, messages),
  );
  const final = await runner.runUntilDone();
  const history = [...runner.params.messages];
  if (history.at(-1)?.role !== "assistant") {
    history.push({
      role: "assistant",
      content: final.content as Anthropic.Beta.BetaContentBlockParam[],
    });
  }
  return { final, history };
}

/** The answer text, after checking the stop reason. */
function answerOf(final: Message): string {
  switch (final.stop_reason) {
    case "end_turn":
    case "stop_sequence":
      break;
    case "refusal":
      throw new AgentError("The model declined to answer (stop_reason refusal).", "refusal");
    case "max_tokens":
      throw new AgentError("The answer was cut off (stop_reason max_tokens).", "truncation");
    case "tool_use":
      throw new AgentError(
        `The agent did not finish within ${MAX_ITERATIONS} model requests.`,
        "agent_error",
      );
    default:
      throw new AgentError(`Unexpected stop_reason ${String(final.stop_reason)}.`, "agent_error");
  }
  const text = final.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (text === "") throw new AgentError("The model returned no answer text.", "agent_error");
  return text;
}

/** The one repair turn: names the ungrounded numbers and asks for an answer that cites facts. */
export function repairMessage(ungrounded: string[]): string {
  const list = ungrounded.map((n) => `"${n}"`).join(", ");
  return (
    `Your answer was withheld because these numbers or citations are not backed by a tool fact: ` +
    `${list}. Write the answer again using only numbers that are values of facts the tools ` +
    "returned, in ASCII digits. Put the id of the fact each number comes from in square brackets " +
    "immediately after that number (after its unit, if it has one), one id per number; never " +
    "gather the ids at the end of a sentence. Cite only fact ids the tools returned. Do not work " +
    "out any number yourself; leave out anything no fact supports."
  );
}

interface StoredMessage {
  role: "user" | "assistant" | "tool";
  content: { text?: string; answer?: string | null };
}

/** Earlier turns of a conversation as the model sees them: questions and released answers. */
async function loadHistory(sql: Sql, conversationId: Id): Promise<MessageParam[]> {
  const rows = await sql<StoredMessage[]>`
    select role, content from messages where conversation_id = ${conversationId} order by id`;
  const history: MessageParam[] = [];
  for (const row of rows) {
    const c = row.content ?? {};
    if (row.role === "user" && typeof c.text === "string") {
      history.push({ role: "user", content: c.text });
    } else if (row.role === "assistant" && typeof c.answer === "string") {
      history.push({ role: "assistant", content: c.answer });
    }
  }
  return history;
}

async function insertMessage(
  sql: Sql,
  conversationId: Id,
  role: StoredMessage["role"],
  content: unknown,
  at: Date,
  gateAttempts: GateAttempt[] = [],
): Promise<Id> {
  const [row] = await sql<{ id: number }[]>`
    insert into messages (conversation_id, role, content, gate_attempts, created_at)
    values (${conversationId}, ${role}, ${json(content)}::jsonb, ${json(gateAttempts)}::jsonb,
            ${at.toISOString()}::timestamptz)
    returning id`;
  if (!row) throw new Error("messages insert returned no row");
  return row.id;
}

/**
 * Answers one question, in a new conversation or a given one. The answer is released only if
 * every number in it is a fact a tool returned in this conversation; otherwise one repair turn
 * runs, and if that also fails the answer is withheld (`answer: null`, `gate.passed: false`).
 * Each gate attempt is stored on the assistant message (`gate_attempts`), also when a later turn
 * fails, and returned as `gate.attempts`. The result carries the ungrounded numbers themselves; the
 * HTTP routes send only their counts (ask/response.ts).
 * Throws `ConversationNotFoundError` for an unknown conversation and `AgentError` when the model
 * gives no usable answer (both after recording the calls made).
 */
export async function runAgent(
  deps: AgentDeps,
  question: string,
  conversationId?: Id | null,
): Promise<AskResult> {
  const { sql } = deps;
  const now = deps.now ?? (() => new Date());

  let convId: Id;
  let history: MessageParam[] = [];
  let priorFacts: Fact[] = [];
  if (conversationId != null) {
    const [conv] = await sql<{ id: number }[]>`
      select id from conversations where id = ${conversationId}`;
    if (!conv) throw new ConversationNotFoundError(conversationId);
    convId = conv.id;
    history = await loadHistory(sql, convId);
    priorFacts = await loadConversationFacts(sql, convId);
  } else {
    const [conv] = await sql<{ id: number }[]>`
      insert into conversations (title, created_at)
      values (${question.slice(0, 120)}, ${now().toISOString()}::timestamptz)
      returning id`;
    if (!conv) throw new Error("conversations insert returned no row");
    convId = conv.id;
  }
  await insertMessage(sql, convId, "user", { text: question }, now());

  const ctx = createToolContext({ sql, now, priorFacts });
  const tools = withProgress(agentTools(ctx), deps.onProgress);
  /** Every gate pass so far, kept outside the run so a failed repair turn still stores attempt 1. */
  const attempts: GateAttempt[] = [];
  const run = await withCallCapture(async () => {
    const first = await runTurn(deps, tools, [...history, { role: "user", content: question }]);
    const text = answerOf(first.final);
    const gate = checkNumbers(text, [...ctx.ledger.values()]);
    attempts.push(...gate.attempts);
    if (gate.passed) return { text, gate };
    const repair = await runTurn(deps, tools, [
      ...first.history,
      { role: "user", content: repairMessage(gate.ungroundedNumbers) },
    ]);
    const repaired = answerOf(repair.final);
    const second = checkNumbers(repaired, [...ctx.ledger.values()]);
    attempts.push({
      attempt: 2,
      passed: second.passed,
      ungroundedNumbers: second.ungroundedNumbers,
    });
    const again: GateResult = { ...second, repaired: true, attempts: [...attempts] };
    return { text: repaired, gate: again };
  });

  for (const call of ctx.calls) await insertMessage(sql, convId, "tool", call, now());
  const llmCallIds: Id[] = [];
  for (const m of run.calls) {
    llmCallIds.push(await recordLlmCall(sql, "agent", m, { conversationId: convId, at: now() }));
  }

  const meta = { model: deps.config.agentModel, promptVersion: PROMPT_VERSION };
  /** Every recommendation proposed during this ask traces back to the ask's assistant message. */
  const linkRecommendations = async (messageId: Id) => {
    if (ctx.recommendationIds.length === 0) return;
    await sql`
      update recommendations set message_id = ${messageId}
      where id in ${sql(ctx.recommendationIds)} and message_id is null`;
  };

  if (!run.ok) {
    const error = run.error instanceof Error ? run.error.message : String(run.error);
    const messageId = await insertMessage(
      sql,
      convId,
      "assistant",
      { answer: null, error, ...meta },
      now(),
      attempts,
    );
    await linkRecommendations(messageId);
    deps.log?.(`[agent] conversation ${convId}: ${error}`);
    throw run.error;
  }

  const { text, gate } = run.value;
  const answer = gate.passed ? text : null;
  const messageId = await insertMessage(
    sql,
    convId,
    "assistant",
    {
      answer,
      // Kept for review and evals; never returned by the API.
      withheldAnswer: gate.passed ? null : text,
      gate,
      citedFactIds: citedFactIds(text),
      ...meta,
    },
    now(),
    gate.attempts,
  );
  await linkRecommendations(messageId);
  if (!gate.passed) {
    deps.log?.(
      `[agent] conversation ${convId}: answer withheld, ungrounded ${gate.ungroundedNumbers.join(" | ")}`,
    );
  }

  return {
    conversationId: convId,
    messageId,
    answer,
    facts: [...ctx.ledger.values()],
    gate,
    recommendationIds: ctx.recommendationIds,
    llmCallIds,
  };
}
