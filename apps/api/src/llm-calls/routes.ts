/** `GET /api/llm-calls` → `{ items: LlmCallView[] }`: recorded model calls, latest first. */
import type { Sql } from "@pharos/db";
import { type LlmCall, LlmCallView } from "@pharos/shared";
import { Hono } from "hono";

/** At most this many calls are listed. */
export const LLM_CALLS_LIMIT = 200;

export interface LlmCallDeps {
  sql: Sql;
}

interface LlmCallRow {
  id: number;
  purpose: LlmCall["purpose"];
  model: string;
  mode: LlmCall["mode"];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  cost_usd: number;
  stop_reason: string | null;
  request_key: string;
  document_id: number | null;
  conversation_id: number | null;
  /** postgres.js returns timestamptz as text here (the Drizzle client sets that parser). */
  created_at: string | Date;
}

const toView = (r: LlmCallRow): LlmCallView =>
  LlmCallView.parse({
    id: r.id,
    purpose: r.purpose,
    model: r.model,
    mode: r.mode,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    latencyMs: r.latency_ms,
    costUsd: r.cost_usd,
    stopReason: r.stop_reason,
    requestKey: r.request_key,
    documentId: r.document_id,
    conversationId: r.conversation_id,
    createdAt: new Date(r.created_at).toISOString(),
  });

export function createLlmCallRoutes(deps: LlmCallDeps) {
  const app = new Hono();
  app.get("/", async (c) => {
    const rows = await deps.sql<LlmCallRow[]>`
      select id, purpose, model, mode, input_tokens, output_tokens, cache_read_tokens,
             cache_write_tokens, latency_ms, cost_usd, stop_reason, request_key, document_id,
             conversation_id, created_at
      from llm_calls order by created_at desc, id desc limit ${LLM_CALLS_LIMIT}`;
    return c.json({ items: rows.map(toView) });
  });
  return app;
}
