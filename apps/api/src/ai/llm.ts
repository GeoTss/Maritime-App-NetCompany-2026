/**
 * The single LLM gateway: every model call in the API goes through the client built here.
 *
 * - `live` forwards to the Anthropic API.
 * - `record` forwards and writes each successful request/response pair to
 *   `<recordingsDir>/<requestKey>.json`.
 * - `replay` serves only recordings and throws `ReplayMissError` on a miss; it never touches
 *   the network and needs no API key. Tests run in replay.
 *
 * Every successful Messages call reports `CallMetrics` (tokens, latency, stop reason) to `onCall`.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic, { type ClientOptions, type Middleware } from "@anthropic-ai/sdk";
import { createDb, type Sql, schema } from "@pharos/db";
import type { Id, LlmCall, LlmMode } from "@pharos/shared";
import { z } from "zod";
import { costUsd, type LlmUsage, promptTokensOf } from "./pricing.js";
import { readBodyOnce } from "./read-body.js";

export type LlmFetch = NonNullable<ClientOptions["fetch"]>;

export interface CallMetrics {
  requestKey: string;
  model: string;
  /** Wall time from sending the request to reading the full response body; 0 in replay. */
  latencyMs: number;
  usage: LlmUsage;
  stopReason: string | null;
  mode: LlmMode;
}

export interface CreateLlmOptions {
  mode: LlmMode;
  /** Required in live and record mode; ignored in replay. */
  apiKey?: string | undefined;
  recordingsDir: string;
  onCall: (metrics: CallMetrics) => void | Promise<void>;
  /** The network transport for live/record (defaults to global fetch). Tests inject one. */
  fetch?: LlmFetch | undefined;
}

/** Placeholder credential for replay mode, which never reaches the API. */
const REPLAY_API_KEY = "replay-no-key";

/** Response headers kept in a recording. */
const RECORDED_HEADERS = ["content-type", "request-id"] as const;

export class ReplayMissError extends Error {
  override name = "ReplayMissError";
  constructor(
    readonly requestKey: string,
    readonly path: string,
  ) {
    super(
      `LLM replay miss: no recording for request key ${requestKey} at ${path}. ` +
        "Re-record it with LLM_MODE=record.",
    );
  }
}

export class UnsupportedLlmRequestError extends Error {
  override name = "UnsupportedLlmRequestError";
}

export const RecordingFile = z.object({
  request: z.object({ method: z.string(), path: z.string(), body: z.unknown() }),
  response: z.object({
    status: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
  }),
});
export type RecordingFile = z.infer<typeof RecordingFile>;

const Usage = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().int().nonnegative(),
      ephemeral_1h_input_tokens: z.number().int().nonnegative(),
    })
    .nullish(),
});

/** The parts of a Messages response the gateway reads. */
const MessageMetrics = z.object({
  model: z.string().optional(),
  stop_reason: z.string().nullish(),
  usage: Usage,
});

/** JSON with object keys sorted recursively; array order is kept. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, sortKeys(obj[k])]),
    );
  }
  return value;
}

/** sha256 of the canonical JSON of method, URL pathname and body. Headers and query are ignored. */
export function requestKey(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ method: method.toUpperCase(), path, body }))
    .digest("hex");
}

function parseRequestBody(body: unknown): unknown {
  if (body === undefined || body === null) return null;
  if (typeof body !== "string") {
    throw new UnsupportedLlmRequestError(
      "The LLM gateway only supports JSON request bodies (no uploads or streamed bodies).",
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new UnsupportedLlmRequestError("The LLM gateway only supports JSON request bodies.");
  }
}

async function readRecording(path: string): Promise<RecordingFile | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return undefined;
    throw err;
  }
  const parsed = RecordingFile.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Malformed LLM recording at ${path}`);
  return parsed.data;
}

async function writeRecording(dir: string, path: string, recording: RecordingFile): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`);
}

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of RECORDED_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/** Metrics for a response that carries `usage` (a Message); undefined for other endpoints. */
function metricsOf(
  key: string,
  requestBody: unknown,
  responseBody: unknown,
  latencyMs: number,
  mode: LlmMode,
): CallMetrics | undefined {
  if (responseBody === null || typeof responseBody !== "object" || !("usage" in responseBody)) {
    return undefined;
  }
  const parsed = MessageMetrics.safeParse(responseBody);
  if (!parsed.success) throw new Error(`LLM response for request key ${key} has malformed usage`);
  const requested = (requestBody as { model?: unknown } | null)?.model;
  const model = typeof requested === "string" ? requested : parsed.data.model;
  if (!model) throw new Error(`LLM call ${key} names no model`);
  return {
    requestKey: key,
    model,
    latencyMs,
    usage: parsed.data.usage,
    stopReason: parsed.data.stop_reason ?? null,
    mode,
  };
}

function gateway(opts: CreateLlmOptions): Middleware {
  const { mode, recordingsDir } = opts;
  const report = async (metrics: CallMetrics | undefined) => {
    if (metrics) await opts.onCall(metrics);
  };

  return async (request, next, ctx) => {
    const method = (request.method ?? "GET").toUpperCase();
    const path = new URL(request.url).pathname;
    const body = parseRequestBody(request.body);
    if (ctx.options?.stream || (body as { stream?: unknown } | null)?.stream === true) {
      throw new UnsupportedLlmRequestError(
        "Streaming LLM requests are not supported by the gateway (live, record or replay).",
      );
    }
    const key = requestKey(method, path, body);
    const file = join(recordingsDir, `${key}.json`);

    if (mode === "replay") {
      const recording = await readRecording(file);
      if (!recording) throw new ReplayMissError(key, file);
      const { status, headers, body: recorded } = recording.response;
      await report(metricsOf(key, body, recorded, 0, mode));
      return new Response(JSON.stringify(recorded), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    const started = performance.now();
    const transported = await next(request);
    // Errors go back to the SDK (which may retry); they are neither recorded nor costed.
    if (!transported.ok) return transported;
    // Read the body once and hand the SDK a new Response over the same bytes, never a read
    // through `clone()` (see read-body.ts: a collected clone cancels the original body).
    const read = await readBodyOnce(transported);
    const latencyMs = performance.now() - started;
    const { response, json } = read;
    let responseBody: unknown;
    if (json.ok) responseBody = json.value;
    else {
      if (mode === "record") {
        throw new UnsupportedLlmRequestError(
          `Cannot record a non-JSON LLM response (request key ${key}).`,
        );
      }
      return response;
    }
    if (mode === "record") {
      await writeRecording(recordingsDir, file, {
        request: { method, path, body },
        response: {
          status: response.status,
          headers: pickHeaders(response.headers),
          body: responseBody,
        },
      });
    }
    await report(metricsOf(key, body, responseBody, latencyMs, mode));
    return response;
  };
}

/**
 * Builds the Anthropic client every model call goes through. The gateway runs as SDK middleware
 * around the transport (`fetch`), so a replay miss propagates as `ReplayMissError` without SDK
 * retries or connection-error wrapping.
 */
export function createLlm(opts: CreateLlmOptions): { client: Anthropic } {
  if (opts.mode !== "replay" && !opts.apiKey) {
    throw new Error(`LLM_MODE=${opts.mode} needs ANTHROPIC_API_KEY.`);
  }
  const client = new Anthropic({
    apiKey: opts.mode === "replay" ? REPLAY_API_KEY : opts.apiKey,
    fetch: opts.fetch,
    middleware: [gateway(opts)],
  });
  return { client };
}

export interface LlmCallLinks {
  documentId?: Id | undefined;
  conversationId?: Id | undefined;
  /** When the call is recorded: the caller's request clock (wall clock if omitted). */
  at?: Date | undefined;
}

/** Inserts one `llm_calls` row (cost computed from the usage) and returns its id. */
export async function recordLlmCall(
  sql: Sql,
  purpose: LlmCall["purpose"],
  metrics: CallMetrics,
  links: LlmCallLinks,
): Promise<Id> {
  const { usage } = metrics;
  const cost = costUsd(metrics.model, usage, promptTokensOf(usage));
  const split = usage.cache_creation;
  const cacheWriteTokens =
    usage.cache_creation_input_tokens ??
    (split ? split.ephemeral_5m_input_tokens + split.ephemeral_1h_input_tokens : 0);
  const [row] = await createDb(sql)
    .insert(schema.llmCalls)
    .values({
      purpose,
      model: metrics.model,
      mode: metrics.mode,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens,
      latencyMs: metrics.latencyMs,
      costUsd: cost,
      stopReason: metrics.stopReason,
      requestKey: metrics.requestKey,
      documentId: links.documentId ?? null,
      conversationId: links.conversationId ?? null,
      createdAt: links.at ?? new Date(),
    })
    .returning({ id: schema.llmCalls.id });
  if (!row) throw new Error("llm_calls insert returned no row");
  return row.id;
}
