import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { LlmCallView, listOf } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type CallMetrics, recordLlmCall } from "../ai/llm.js";
import { createApp } from "../app.js";
import { createClock } from "../clock.js";
import { createFixtureSource, FIXTURE_ANCHOR } from "../read/fixtures.js";
import { LLM_CALLS_LIMIT } from "./routes.js";

const sql = await connectTestDb("llm_calls_routes");

if (!sql) {
  describe("GET /api/llm-calls (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("llm_calls_routes")}`, () => {});
  });
}

describe.skipIf(!sql)("GET /api/llm-calls (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const app = createApp({
    llmMode: "replay",
    clock: createClock(FIXTURE_ANCHOR),
    pingDb: async () => true,
    read: createFixtureSource(),
    llmCalls: { sql: db },
  });

  const metrics = (n: number): CallMetrics => ({
    requestKey: `request-${n}`,
    model: "claude-haiku-5-5",
    latencyMs: 1000 + n,
    usage: { input_tokens: 100 * n, output_tokens: 10 * n, cache_read_input_tokens: n },
    stopReason: "end_turn",
    mode: "replay",
  });

  beforeEach(async () => {
    await db`truncate table llm_calls restart identity`;
  });
  afterAll(async () => {
    await db.end();
  });

  it("lists recorded calls latest first, with tokens, latency and cost", async () => {
    for (const n of [1, 2, 3])
      await recordLlmCall(db, n === 2 ? "agent" : "extract", metrics(n), {});
    const res = await app.request("/api/llm-calls");
    expect(res.status).toBe(200);
    const { items } = listOf(LlmCallView).parse(await res.json());
    expect(items.map((c) => c.requestKey)).toEqual(["request-3", "request-2", "request-1"]);
    expect(items[0]).toMatchObject({
      purpose: "extract",
      model: "claude-haiku-5-5",
      mode: "replay",
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
      latencyMs: 1003,
      stopReason: "end_turn",
      documentId: null,
      conversationId: null,
    });
    const [row] = await db<{ cost_usd: number }[]>`
      select cost_usd from llm_calls where request_key = 'request-3'`;
    expect(items[0]?.costUsd).toBe(row?.cost_usd);
    expect(items[0]?.costUsd).toBeGreaterThan(0);
  });

  it("returns at most 200 calls", async () => {
    expect(LLM_CALLS_LIMIT).toBe(200);
    await db`
      insert into llm_calls (purpose, model, mode, input_tokens, output_tokens, cache_read_tokens,
                             cache_write_tokens, latency_ms, cost_usd, stop_reason, request_key,
                             document_id, conversation_id, created_at)
      select 'agent', 'claude-haiku-5-5', 'replay', 1, 1, 0, 0, 1, 0, null, 'bulk-' || n, null, null,
             now()
      from generate_series(1, 201) as n`;
    const { items } = listOf(LlmCallView).parse(await (await app.request("/api/llm-calls")).json());
    expect(items).toHaveLength(200);
    expect(items[0]?.requestKey).toBe("bulk-201");
    expect(items.at(-1)?.requestKey).toBe("bulk-2");
  });
});
