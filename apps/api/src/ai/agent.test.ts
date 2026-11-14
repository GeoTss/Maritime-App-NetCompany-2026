import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { AskResponse, type Fact } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ASK_FIXTURE_NOW, DEMO_QUESTION, prepareAskFixture } from "../ask/demo-fixture.js";
import { ASK_RECORDING_CONFIG } from "../ask/record-demo-ask.js";
import { DEFAULT_RECORDINGS_DIR } from "../config.js";
import {
  type AgentConfig,
  type AgentDeps,
  AgentError,
  agentRunnerParams,
  ConversationNotFoundError,
  runAgent,
} from "./agent.js";
import { captureLlmCall } from "./call-capture.js";
import { type CallMetrics, createLlm, type LlmFetch } from "./llm.js";
import { PROMPT_VERSION } from "./prompts/agent-system.js";
import { citedFactIds, numericTokens } from "./release-gate.js";
import {
  lastToolResult,
  type ScriptedRequest,
  scriptedFetch,
  scriptedMessage,
  textReply,
  toolCall,
} from "./scripted-llm.js";

const throwingFetch: LlmFetch = async () => {
  throw new Error("network must not be called");
};

const HAIKU: AgentConfig = {
  agentModel: "claude-haiku-5-5",
  agentEffort: "medium",
  llmFallbacks: false,
};

/** Numbers not followed, within their sentence, by a citation of a known fact. */
function uncitedNumbers(answer: string, facts: Fact[]): string[] {
  const known = new Set(facts.map((f) => f.id));
  const out: string[] = [];
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    for (const id of citedFactIds(sentence)) if (!known.has(id)) out.push(`[${id}]`);
    const tail = sentence.split(/\[\s*f_[^\]]*\]/).at(-1) ?? "";
    out.push(...numericTokens(tail).map((t) => t.text));
  }
  return out;
}

describe("agent request", () => {
  it("uses the agent model and effort, auto tool choice, a cached system prompt, no thread", () => {
    const params = agentRunnerParams(HAIKU, [], [{ role: "user", content: "hi" }]);
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.thread).toBe(false);
    expect(params.system).toEqual([
      expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } }),
    ]);
    expect("thinking" in params).toBe(false);
    expect("temperature" in params).toBe(false);
    expect("betas" in params).toBe(false);
    expect("fallbacks" in params).toBe(false);
    expect(PROMPT_VERSION).toBe("agent-system/v1");
  });

  it("sends server-side fallbacks only when enabled with an Opus model", () => {
    const opus = { ...HAIKU, agentModel: "claude-opus-5-5", llmFallbacks: true };
    const params = agentRunnerParams(opus, [], [{ role: "user", content: "hi" }]);
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    const haikuOn = agentRunnerParams({ ...HAIKU, llmFallbacks: true }, [], []);
    expect("fallbacks" in haikuOn).toBe(false);
    const opusOff = agentRunnerParams({ ...opus, llmFallbacks: false }, [], []);
    expect("fallbacks" in opusOff).toBe(false);
  });
});

describe("toolRunner record -> replay round trip (injected transport, no network)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pharos-agent-"));
    return () => rm(dir, { recursive: true, force: true });
  });

  it("replay serves every turn the record run made", async () => {
    const echo = () =>
      betaZodTool({
        name: "echo",
        description: "Echo a word in capitals.",
        inputSchema: z.object({ word: z.string() }).strict(),
        run: async ({ word }) => word.toUpperCase(),
      });
    const messages = [{ role: "user" as const, content: "Echo hi" }];
    const { fetch, requests } = scriptedFetch([
      toolCall(1, "echo", { word: "hi" }),
      textReply(2, "It says HI."),
    ]);

    const recorded: CallMetrics[] = [];
    const rec = createLlm({
      mode: "record",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall: (m) => {
        recorded.push(m);
      },
      fetch,
    });
    const first = await rec.client.beta.messages
      .toolRunner(agentRunnerParams(HAIKU, [echo()], messages))
      .runUntilDone();
    expect(requests).toHaveLength(2);
    expect(await readdir(dir)).toHaveLength(2);
    // Without a thread, the second turn carries the whole history and no server-side state.
    const second = requests[1] as ScriptedRequest;
    expect(second.messages).toHaveLength(3);
    expect(second.thread).toBeUndefined();
    expect(second.previous_message_id).toBeUndefined();

    const replayed: CallMetrics[] = [];
    const rep = createLlm({
      mode: "replay",
      recordingsDir: dir,
      onCall: (m) => {
        replayed.push(m);
      },
      fetch: throwingFetch,
    });
    const again = await rep.client.beta.messages
      .toolRunner(agentRunnerParams(HAIKU, [echo()], messages))
      .runUntilDone();
    expect(again.content).toEqual(first.content);
    expect(replayed.map((m) => m.requestKey)).toEqual(recorded.map((m) => m.requestKey));
    expect(replayed.every((m) => m.mode === "replay")).toBe(true);
  });
});

const sql = await connectTestDb("ask_agent");

if (!sql) {
  describe("runAgent (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_agent")}`, () => {});
  });
}

describe.skipIf(!sql)("runAgent (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;

  beforeEach(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const scriptedDeps = (script: Parameters<typeof scriptedFetch>[0]) => {
    const scripted = scriptedFetch(script);
    const llm = createLlm({
      mode: "live",
      apiKey: "test-key",
      recordingsDir: "/nonexistent",
      onCall: captureLlmCall,
      fetch: scripted.fetch,
    });
    const deps: AgentDeps = { sql: db, llm, config: HAIKU, now: () => ASK_FIXTURE_NOW };
    return { deps, requests: scripted.requests };
  };

  const messagesOf = (conversationId: number) =>
    db<{ id: number; role: string; content: Record<string, unknown> }[]>`
      select id, role, content from messages where conversation_id = ${conversationId} order by id`;

  it("withholds after a failed repair", async () => {
    const { deps, requests } = scriptedDeps([
      textReply(1, "Kestrel is $8,000 cheaper than Strait Line."),
      textReply(2, "Kestrel is still 8,000 cheaper."),
    ]);
    const res = AskResponse.parse(await runAgent(deps, "Who is cheaper?"));
    expect(res.answer).toBeNull();
    expect(res.gate).toEqual({ passed: false, repaired: true, ungroundedNumbers: ["8,000"] });
    expect(requests).toHaveLength(2);

    // The repair turn is one user message naming the ungrounded numbers; the gate never edits text.
    const repair = requests[1]?.messages.at(-1);
    expect(repair?.role).toBe("user");
    expect(JSON.stringify(repair?.content)).toContain("8,000");
    expect(requests[1]?.messages.at(-2)?.role).toBe("assistant");

    // Calls are recorded and linked to the conversation; the withheld text is stored, not shown.
    const calls = await db<{ id: number; conversation_id: number; purpose: string }[]>`
      select id, conversation_id, purpose from llm_calls order by id`;
    expect(calls.map((c) => c.id)).toEqual(res.llmCallIds);
    expect(calls.every((c) => c.conversation_id === res.conversationId)).toBe(true);
    expect(calls.every((c) => c.purpose === "agent")).toBe(true);
    const stored = await messagesOf(res.conversationId);
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored[1]?.id).toBe(res.messageId);
    expect(stored[1]?.content).toMatchObject({ answer: null, gate: res.gate });
  });

  it("releases an answer that passes after the repair turn", async () => {
    const { deps } = scriptedDeps([
      textReply(1, "That saves about 8,000 dollars."),
      textReply(2, "Bunker at Marsaxlokk with Kestrel Marine Fuels."),
    ]);
    const res = await runAgent(deps, "Where?");
    expect(res.answer).toBe("Bunker at Marsaxlokk with Kestrel Marine Fuels.");
    expect(res.gate).toEqual({ passed: true, repaired: true, ungroundedNumbers: [] });
  });

  it("collects tool facts, grounds cited numbers, proposes, and links the recommendation", async () => {
    const { deps, requests } = scriptedDeps([
      toolCall(1, "plan_bunkering", { vessel: "Aegean Pioneer" }),
      (req: ScriptedRequest) => {
        const plan = lastToolResult(req) as { facts: Fact[]; data: { calculationId: number } };
        const best = plan.facts.find((f) => f.id.endsWith("_bestOptionId"));
        return toolCall(2, "propose_action", {
          type: "purchase_order",
          calculationId: plan.data.calculationId,
          optionId: best?.value,
          factRefs: [best?.id],
          rationale: "Lowest total delivered cost.",
        });
      },
      (req: ScriptedRequest) => {
        const plan = lastToolResultOf(req, "plan_bunkering");
        const total = plan.facts.find((f) => f.id.endsWith("_options.0.totalCostUsd"));
        const value = Math.round(total?.value as number).toLocaleString("en-US");
        return textReply(3, `Buy from Kestrel at Marsaxlokk: total $${value} [${total?.id}].`);
      },
    ]);
    const res = await runAgent(deps, DEMO_QUESTION);
    expect(res.gate).toEqual({ passed: true, repaired: false, ungroundedNumbers: [] });
    expect(res.answer).toMatch(/^Buy from Kestrel/);
    expect(requests).toHaveLength(3);
    expect(res.facts.some((f) => f.id.endsWith("_options.0.totalCostUsd"))).toBe(true);
    expect(res.recommendationIds).toHaveLength(1);

    const [rec] = await db<{ id: number; status: string; option_id: string; message_id: number }[]>`
      select id, status, option_id, message_id from recommendations`;
    expect(rec).toMatchObject({ status: "pending", option_id: "MTMLA-kestrel" });
    expect(rec?.id).toBe(res.recommendationIds[0]);
    expect(rec?.message_id).toBe(res.messageId);

    const stored = await messagesOf(res.conversationId);
    expect(stored.map((m) => m.role)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(stored[1]?.content).toMatchObject({ tool: "plan_bunkering", isError: false });
  });

  it("a follow-up in the same conversation may cite facts from an earlier turn", async () => {
    let total: Fact | undefined;
    const first = scriptedDeps([
      toolCall(1, "plan_bunkering", { vessel: "Aegean Pioneer" }),
      (req: ScriptedRequest) => {
        total = lastToolResultOf(req, "plan_bunkering").facts.find((f) =>
          f.id.endsWith("_options.0.totalCostUsd"),
        );
        return textReply(2, "Kestrel at Marsaxlokk is best.");
      },
    ]);
    const one = await runAgent(first.deps, DEMO_QUESTION);
    const second = scriptedDeps([
      (req: ScriptedRequest) => {
        // The earlier question and answer are part of the history.
        expect(JSON.stringify(req.messages)).toContain("Kestrel at Marsaxlokk is best.");
        const value = Math.round(total?.value as number).toLocaleString("en-US");
        return textReply(1, `The total is $${value} [${total?.id}].`);
      },
    ]);
    const two = await runAgent(second.deps, "What does it cost?", one.conversationId);
    expect(two.conversationId).toBe(one.conversationId);
    expect(two.gate.passed).toBe(true);
    expect(two.facts.map((f) => f.id)).toContain(total?.id);
  });

  it("a refusal fails the ask with AgentError, and the call is still recorded", async () => {
    const { deps } = scriptedDeps([scriptedMessage(1, [], "refusal")]);
    await expect(runAgent(deps, "Where?")).rejects.toBeInstanceOf(AgentError);
    const calls = await db`select id from llm_calls`;
    expect(calls).toHaveLength(1);
  });

  it("a truncated answer fails the ask with AgentError", async () => {
    const { deps } = scriptedDeps([
      scriptedMessage(1, [{ type: "text", text: "Bunk" }], "max_tokens"),
    ]);
    await expect(runAgent(deps, "Where?")).rejects.toThrow(/max_tokens/);
  });

  it("an unknown conversation id is rejected before any model call", async () => {
    const { deps, requests } = scriptedDeps([]);
    await expect(runAgent(deps, "Where?", 4242)).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(requests).toHaveLength(0);
  });

  it("replays the recorded demo ask: gate passes, Kestrel is proposed, every number is cited", async () => {
    const llm = createLlm({
      mode: "replay",
      recordingsDir: DEFAULT_RECORDINGS_DIR,
      onCall: captureLlmCall,
      fetch: throwingFetch,
    });
    const deps: AgentDeps = {
      sql: db,
      llm,
      config: ASK_RECORDING_CONFIG,
      now: () => ASK_FIXTURE_NOW,
    };
    const res = AskResponse.parse(await runAgent(deps, DEMO_QUESTION));
    expect(res.gate.passed).toBe(true);
    expect(res.answer).not.toBeNull();
    expect(uncitedNumbers(res.answer ?? "", res.facts)).toEqual([]);
    expect(res.recommendationIds).toHaveLength(1);
    const [rec] = await db<{ status: string; option_id: string; type: string }[]>`
      select status, option_id, type from recommendations where id = ${res.recommendationIds[0] ?? 0}`;
    expect(rec).toEqual({ status: "pending", option_id: "MTMLA-kestrel", type: "purchase_order" });
    const modes = await db<{ mode: string }[]>`select mode from llm_calls`;
    expect(modes.length).toBe(res.llmCallIds.length);
    expect(modes.every((m) => m.mode === "replay")).toBe(true);
  });
});

/** The parsed result of the last call to `tool` in a request's history. */
function lastToolResultOf(req: ScriptedRequest, tool: string): { facts: Fact[]; data: unknown } {
  const uses = new Map<string, string>();
  for (const m of req.messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as { type: string; id?: string; name?: string }[]) {
      if (b.type === "tool_use" && b.id && b.name) uses.set(b.id, b.name);
    }
  }
  for (const m of [...req.messages].reverse()) {
    if (!Array.isArray(m.content)) continue;
    const blocks = m.content as { type: string; tool_use_id?: string; content?: unknown }[];
    for (const b of [...blocks].reverse()) {
      if (b.type !== "tool_result" || uses.get(b.tool_use_id ?? "") !== tool) continue;
      return lastToolResult({ ...req, messages: [{ role: "user", content: [b] }] }) as {
        facts: Fact[];
        data: unknown;
      };
    }
  }
  throw new Error(`no ${tool} result in the request`);
}
