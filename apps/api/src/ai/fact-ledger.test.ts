import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { AskResponse, type Fact } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, DEMO_QUESTION, prepareAskFixture } from "../ask/demo-fixture.js";
import { type AgentDeps, runAgent } from "./agent.js";
import { captureLlmCall } from "./call-capture.js";
import { loadConversationFacts } from "./fact-ledger.js";
import { createLlm } from "./llm.js";
import {
  lastToolResult,
  type ScriptedRequest,
  scriptedFetch,
  textReply,
  toolCall,
} from "./scripted-llm.js";

const sql = await connectTestDb("ask_fact_ledger");

if (!sql) {
  describe("fact ledger (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_fact_ledger")}`, () => {});
  });
}

const fact = (id: string, value: number): Fact => ({
  id,
  label: `label of ${id.replace(/\d/g, "")}`,
  value,
  unit: "mt",
  provenance: { source: "db", table: "t", rowId: 1, field: "f" },
});

describe.skipIf(!sql)("fact ledger (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;

  beforeEach(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const conversation = async () => {
    const [row] = await db<{ id: number }[]>`
      insert into conversations (title, created_at) values ('t', now()) returning id`;
    if (!row) throw new Error("no conversation");
    return row.id;
  };
  const message = (conversationId: number, role: string, content: unknown) =>
    db`insert into messages (conversation_id, role, content, created_at)
       values (${conversationId}, ${role}, ${JSON.stringify(content)}::jsonb, now())`;

  it("loadConversationFacts returns the facts of every successful earlier tool result, in order", async () => {
    const conv = await conversation();
    const other = await conversation();
    const [a, b, c, d] = ["f_x_1_a", "f_x_2_b", "f_x_3_c", "f_x_4_d"].map((id, i) => fact(id, i));
    await message(conv, "user", { text: "q1" });
    await message(conv, "tool", {
      tool: "x",
      input: {},
      isError: false,
      result: { facts: [a, b] },
    });
    await message(conv, "tool", { tool: "x", input: {}, isError: true, result: { error: "no" } });
    await message(other, "tool", { tool: "x", input: {}, isError: false, result: { facts: [d] } });
    await message(conv, "assistant", { answer: "ok" });
    await message(conv, "tool", { tool: "y", input: {}, isError: false, result: { facts: [c] } });

    expect(await loadConversationFacts(db, conv)).toEqual([a, b, c]);
    expect(await loadConversationFacts(db, other)).toEqual([d]);
    expect(await loadConversationFacts(db, 4242)).toEqual([]);
  });

  const scriptedDeps = (script: Parameters<typeof scriptedFetch>[0]): AgentDeps => {
    const llm = createLlm({
      mode: "live",
      apiKey: "test-key",
      recordingsDir: "/nonexistent",
      onCall: captureLlmCall,
      fetch: scriptedFetch(script).fetch,
    });
    return {
      sql: db,
      llm,
      config: { agentModel: "claude-haiku-5-5", agentEffort: "medium", llmFallbacks: false },
      now: () => ASK_FIXTURE_NOW,
    };
  };

  it("turn 2 calculates over turn 1's facts: subtract gives 26 with lineage, and the answer passes", async () => {
    let operands: string[] = [];
    const one = await runAgent(
      scriptedDeps([
        toolCall(1, "plan_bunkering", { vessel: "Aegean Pioneer" }),
        (req: ScriptedRequest) => {
          const plan = lastToolResult(req) as { facts: Fact[] };
          const headline = (i: number) =>
            plan.facts.find((f) => f.id.endsWith(`_options.${i}.headlinePriceUsdPerMt`))?.id ?? "";
          operands = [headline(0), headline(1)];
          return textReply(2, "Kestrel at Marsaxlokk is best.");
        },
      ]),
      DEMO_QUESTION,
    );
    expect(operands.every((id) => id.startsWith("f_plan_bunkering_"))).toBe(true);

    // Turn 2 is a new request: the model calls calculate with the ids it saw in turn 1.
    let derived: Fact | undefined;
    const two = AskResponse.parse(
      await runAgent(
        scriptedDeps([
          toolCall(1, "calculate", { op: "subtract", operands }),
          (req: ScriptedRequest) => {
            derived = (lastToolResult(req) as { facts: Fact[] }).facts[0];
            return textReply(
              2,
              `Kestrel's headline price is $${derived?.value}/mt higher [${derived?.id}].`,
            );
          },
        ]),
        "How much higher is Kestrel's headline price than Strait Line's?",
        one.conversationId,
      ),
    );

    const [calc] = await db<{ id: number; kind: string; operand_fact_ids: string[] }[]>`
      select id, kind, operand_fact_ids from calculations where kind = 'calculate'`;
    expect(calc?.operand_fact_ids).toEqual(operands);
    expect(derived).toEqual({
      id: `f_calc:${calc?.id}:value`,
      label:
        "subtract of MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): headline price and " +
        "GIGIB-straitline (Strait Line Fuels, Gibraltar): headline price",
      value: 26,
      unit: "USD/mt",
      provenance: { source: "derived", operation: "subtract", operands },
    });
    expect(two.gate.passed).toBe(true);
    expect(two.answer).toContain("$26/mt");
    expect(two.facts.map((f) => f.id)).toEqual(expect.arrayContaining([...operands, derived?.id]));

    // A third turn would see both turns' facts, the derived one last.
    const ledger = await loadConversationFacts(db, one.conversationId);
    expect(ledger.at(-1)?.id).toBe(derived?.id);
    expect(ledger.map((f) => f.id)).toEqual(expect.arrayContaining(operands));
  });

  it("an operand the conversation never returned is a tool error, and no calculation is stored", async () => {
    let error = "";
    const res = await runAgent(
      scriptedDeps([
        toolCall(1, "calculate", {
          op: "subtract",
          operands: ["f_plan_bunkering_1_options.0.headlinePriceUsdPerMt", "f_x_9_y"],
        }),
        (req: ScriptedRequest) => {
          const last = req.messages.at(-1)?.content as { is_error?: boolean; content?: unknown }[];
          const block = last.find((b) => b.is_error);
          error = JSON.stringify(block?.content);
          return textReply(2, "I do not have those figures.");
        },
      ]),
      "What is the difference?",
    );
    expect(error).toMatch(/not returned earlier in this conversation/);
    expect(res.gate.passed).toBe(true);
    expect(await db`select id from calculations where kind = 'calculate'`).toHaveLength(0);
  });
});
