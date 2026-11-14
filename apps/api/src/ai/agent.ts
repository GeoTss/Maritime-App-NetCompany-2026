/**
 * LLM 2: the ops agent. One tool-runner loop over three typed tools; deterministic code computes
 * every number as a cited fact, and the release gate withholds any answer whose numbers are not
 * facts (after one repair turn). Conversations, messages and model calls are persisted.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { Sql } from "@pharos/db";
import { type AskResponse, Fact, type GateResult, type Id } from "@pharos/shared";
import type { AppConfig } from "../config.js";
import { withCallCapture } from "./call-capture.js";
import { recordLlmCall } from "./llm.js";
import { AGENT_SYSTEM, PROMPT_VERSION } from "./prompts/agent-system.js";
import { checkNumbers, citedFactIds } from "./release-gate.js";
import { createToolContext, json, type ToolContext } from "./tools/common.js";
import { planBunkeringTool } from "./tools/plan-bunkering.js";
import { proposeActionTool } from "./tools/propose-action.js";
import { vesselStatusTool } from "./tools/vessel-status.js";

export type AgentConfig = Pick<AppConfig, "agentModel" | "agentEffort" | "llmFallbacks">;

export interface AgentDeps {
  sql: Sql;
  llm: { client: Anthropic };
  config: AgentConfig;
  /** Clock for the tools ("now") and row timestamps. Never reaches the prompt. */
  now?: () => Date;
  log?: (message: string) => void;
}

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Message = Anthropic.Beta.BetaMessage;
type AgentTools = BetaToolRunnerParams["tools"];

/** Fits a non-streaming request; answers are short, the rest is adaptive thinking. */
const MAX_TOKENS = 16_000;
/** Model requests per turn (tool calls plus the answer); bounds cost and latency. */
export const MAX_ITERATIONS = 8;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The model's turn ended without a usable answer (refusal, truncation, no finish). */
export class AgentError extends Error {
  override name = "AgentError";
}

export class ConversationNotFoundError extends Error {
  override name = "ConversationNotFoundError";
  constructor(readonly conversationId: Id) {
    super(`Conversation ${conversationId} does not exist.`);
  }
}

const usesFallbacks = (config: AgentConfig): boolean =>
  config.llmFallbacks && config.agentModel.startsWith("claude-opus");

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
  if (!usesFallbacks(config)) return params;
  return { ...params, betas: [FALLBACK_BETA], fallbacks: "default" };
}

function agentTools(ctx: ToolContext): AgentTools {
  return [vesselStatusTool(ctx), planBunkeringTool(ctx), proposeActionTool(ctx)];
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
      throw new AgentError("The model declined to answer (stop_reason refusal).");
    case "max_tokens":
      throw new AgentError("The answer was cut off (stop_reason max_tokens).");
    case "tool_use":
      throw new AgentError(`The agent did not finish within ${MAX_ITERATIONS} model requests.`);
    default:
      throw new AgentError(`Unexpected stop_reason ${String(final.stop_reason)}.`);
  }
  const text = final.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (text === "") throw new AgentError("The model returned no answer text.");
  return text;
}

/** The one repair turn: names the ungrounded numbers and asks for an answer that cites facts. */
export function repairMessage(ungrounded: string[]): string {
  const list = ungrounded.map((n) => `"${n}"`).join(", ");
  return (
    `Your answer was withheld because these numbers are not backed by a tool fact cited right ` +
    `after them: ${list}. Write the answer again using only numbers that are values of facts the ` +
    "tools returned, each followed in the same sentence by its fact id in square brackets. Do not " +
    "work out any number yourself; leave out anything no fact supports."
  );
}

interface StoredMessage {
  role: "user" | "assistant" | "tool";
  content: { text?: string; answer?: string | null; isError?: boolean; result?: unknown };
}

/** Earlier turns of a conversation: the history the model sees and the facts it may cite. */
async function loadConversation(sql: Sql, conversationId: Id) {
  const rows = await sql<StoredMessage[]>`
    select role, content from messages where conversation_id = ${conversationId} order by id`;
  const history: MessageParam[] = [];
  const priorFacts: Fact[] = [];
  for (const row of rows) {
    const c = row.content ?? {};
    if (row.role === "user" && typeof c.text === "string") {
      history.push({ role: "user", content: c.text });
    } else if (row.role === "assistant" && typeof c.answer === "string") {
      history.push({ role: "assistant", content: c.answer });
    } else if (row.role === "tool" && c.isError === false) {
      const facts = (c.result as { facts?: unknown[] } | undefined)?.facts ?? [];
      for (const f of facts) {
        const parsed = Fact.safeParse(f);
        if (parsed.success) priorFacts.push(parsed.data);
      }
    }
  }
  return { history, priorFacts };
}

async function insertMessage(
  sql: Sql,
  conversationId: Id,
  role: StoredMessage["role"],
  content: unknown,
  at: Date,
): Promise<Id> {
  const [row] = await sql<{ id: number }[]>`
    insert into messages (conversation_id, role, content, created_at)
    values (${conversationId}, ${role}, ${json(content)}::jsonb, ${at.toISOString()}::timestamptz)
    returning id`;
  if (!row) throw new Error("messages insert returned no row");
  return row.id;
}

/**
 * Answers one question, in a new conversation or a given one. The answer is released only if
 * every number in it is a fact a tool returned in this conversation; otherwise one repair turn
 * runs, and if that also fails the answer is withheld (`answer: null`, `gate.passed: false`).
 * Throws `ConversationNotFoundError` for an unknown conversation and `AgentError` when the model
 * gives no usable answer (both after recording the calls made).
 */
export async function runAgent(
  deps: AgentDeps,
  question: string,
  conversationId?: Id | null,
): Promise<AskResponse> {
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
    ({ history, priorFacts } = await loadConversation(sql, convId));
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
  const tools = agentTools(ctx);
  const run = await withCallCapture(async () => {
    const first = await runTurn(deps, tools, [...history, { role: "user", content: question }]);
    const text = answerOf(first.final);
    const gate = checkNumbers(text, [...ctx.ledger.values()]);
    if (gate.passed) return { text, gate };
    const repair = await runTurn(deps, tools, [
      ...first.history,
      { role: "user", content: repairMessage(gate.ungroundedNumbers) },
    ]);
    const repaired = answerOf(repair.final);
    const again: GateResult = {
      ...checkNumbers(repaired, [...ctx.ledger.values()]),
      repaired: true,
    };
    return { text: repaired, gate: again };
  });

  for (const call of ctx.calls) await insertMessage(sql, convId, "tool", call, now());
  const llmCallIds: Id[] = [];
  for (const m of run.calls) {
    llmCallIds.push(await recordLlmCall(sql, "agent", m, { conversationId: convId }));
  }

  const meta = { model: deps.config.agentModel, promptVersion: PROMPT_VERSION };
  if (!run.ok) {
    const error = run.error instanceof Error ? run.error.message : String(run.error);
    await insertMessage(sql, convId, "assistant", { answer: null, error, ...meta }, now());
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
  );
  if (ctx.recommendationIds.length > 0) {
    await sql`
      update recommendations set message_id = ${messageId}
      where id in ${sql(ctx.recommendationIds)} and message_id is null`;
  }
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
