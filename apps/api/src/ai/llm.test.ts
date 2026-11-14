import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type Anthropic from "@anthropic-ai/sdk";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CallMetrics,
  canonicalJson,
  createLlm,
  type LlmFetch,
  RecordingFile,
  ReplayMissError,
  recordLlmCall,
  requestKey,
} from "./llm.js";

const PARAMS = {
  model: "claude-haiku-5-5",
  max_tokens: 256,
  messages: [{ role: "user" as const, content: "Say hi" }],
};

const MESSAGE = {
  id: "msg_test_1",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: [{ type: "text", text: "hi", citations: null }],
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 12,
    output_tokens: 3,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    service_tier: "standard",
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "request-id": "req_test_1",
      "x-not-recorded": "dropped",
    },
  });
}

const throwingFetch: LlmFetch = async () => {
  throw new Error("network must not be called");
};

function textOf(message: Anthropic.Message): string {
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

let dir: string;
let calls: CallMetrics[];
const onCall = (m: CallMetrics) => {
  calls.push(m);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pharos-llm-"));
  calls = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("requestKey / canonicalJson", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("gives the same key for the same body with keys in a different order", () => {
    const a = requestKey("POST", "/v1/messages", { model: "m", max_tokens: 1, x: { p: 1, q: 2 } });
    const b = requestKey("POST", "/v1/messages", { x: { q: 2, p: 1 }, max_tokens: 1, model: "m" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the body, the method and the path", () => {
    const k = requestKey("POST", "/v1/messages", { a: 1 });
    expect(requestKey("POST", "/v1/messages", { a: 2 })).not.toBe(k);
    expect(requestKey("PUT", "/v1/messages", { a: 1 })).not.toBe(k);
    expect(requestKey("POST", "/v1/messages/count_tokens", { a: 1 })).not.toBe(k);
  });
});

describe("createLlm record mode", () => {
  it("forwards to the network, returns the live body and writes the recording", async () => {
    const seen: string[] = [];
    const baseFetch: LlmFetch = async (url) => {
      seen.push(String(url));
      return jsonResponse(MESSAGE);
    };
    const { client } = createLlm({
      mode: "record",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall,
      fetch: baseFetch,
    });
    const msg = await client.messages.create(PARAMS);
    expect(textOf(msg)).toBe("hi");
    expect(seen).toHaveLength(1);

    const key = requestKey("POST", "/v1/messages", PARAMS);
    const file = RecordingFile.parse(JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")));
    expect(file.request).toEqual({ method: "POST", path: "/v1/messages", body: PARAMS });
    expect(file.response.status).toBe(200);
    expect(file.response.headers).toEqual({
      "content-type": "application/json",
      "request-id": "req_test_1",
    });
    expect(file.response.body).toEqual(MESSAGE);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      requestKey: key,
      model: "claude-haiku-5-5",
      stopReason: "end_turn",
      mode: "record",
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    expect(calls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not write a recording for an error response", async () => {
    const { client } = createLlm({
      mode: "record",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall,
      fetch: async () =>
        jsonResponse(
          { type: "error", error: { type: "invalid_request_error", message: "x" } },
          400,
        ),
    });
    await expect(client.messages.create(PARAMS)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("createLlm replay mode", () => {
  async function writeRecording(body: unknown) {
    const key = requestKey("POST", "/v1/messages", body);
    const file: RecordingFile = {
      request: { method: "POST", path: "/v1/messages", body },
      response: {
        status: 200,
        headers: { "content-type": "application/json", "request-id": "req_rec" },
        body: MESSAGE,
      },
    };
    await writeFile(join(dir, `${key}.json`), JSON.stringify(file));
    return key;
  }

  it("returns the recorded body without touching the network and reports latency 0", async () => {
    const key = await writeRecording(PARAMS);
    const { client } = createLlm({
      mode: "replay",
      recordingsDir: dir,
      onCall,
      fetch: throwingFetch,
    });
    const msg = await client.messages.create(PARAMS);
    expect(textOf(msg)).toBe("hi");
    expect(msg.usage.input_tokens).toBe(12);
    expect(calls).toEqual([
      {
        requestKey: key,
        model: "claude-haiku-5-5",
        latencyMs: 0,
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        },
        stopReason: "end_turn",
        mode: "replay",
      },
    ]);
  });

  it("hits the recording when the same request is built with keys in a different order", async () => {
    await writeRecording(PARAMS);
    const { client } = createLlm({
      mode: "replay",
      recordingsDir: dir,
      onCall,
      fetch: throwingFetch,
    });
    const reordered = {
      messages: [{ content: "Say hi", role: "user" as const }],
      max_tokens: 256,
      model: "claude-haiku-5-5",
    };
    expect(textOf(await client.messages.create(reordered))).toBe("hi");
  });

  it("round-trips a recording made in record mode", async () => {
    const rec = createLlm({
      mode: "record",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall,
      fetch: async () => jsonResponse(MESSAGE),
    });
    await rec.client.messages.create(PARAMS);
    const rep = createLlm({ mode: "replay", recordingsDir: dir, onCall, fetch: throwingFetch });
    expect(textOf(await rep.client.messages.create(PARAMS))).toBe("hi");
  });

  it("throws ReplayMissError naming the key and the recording path, and never calls the network", async () => {
    let networkCalls = 0;
    const counting: LlmFetch = async () => {
      networkCalls += 1;
      throw new Error("network must not be called");
    };
    const { client } = createLlm({ mode: "replay", recordingsDir: dir, onCall, fetch: counting });
    const key = requestKey("POST", "/v1/messages", PARAMS);
    const path = join(dir, `${key}.json`);

    const err = await client.messages.create(PARAMS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplayMissError);
    const miss = err as ReplayMissError;
    expect(miss.requestKey).toBe(key);
    expect(miss.path).toBe(path);
    expect(miss.message).toContain(key);
    expect(miss.message).toContain(path);
    expect(networkCalls).toBe(0);
    expect(calls).toEqual([]);
  });

  it("does not need an API key", () => {
    expect(() =>
      createLlm({ mode: "replay", recordingsDir: dir, onCall, fetch: throwingFetch }),
    ).not.toThrow();
  });

  it("rejects streaming requests with a clear error", async () => {
    const { client } = createLlm({
      mode: "replay",
      recordingsDir: dir,
      onCall,
      fetch: throwingFetch,
    });
    await expect(client.messages.create({ ...PARAMS, stream: true })).rejects.toThrow(
      /streaming.*not supported/i,
    );
  });
});

describe("createLlm live mode", () => {
  it("forwards, writes nothing and reports metrics", async () => {
    const { client } = createLlm({
      mode: "live",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall,
      fetch: async () => jsonResponse(MESSAGE),
    });
    expect(textOf(await client.messages.create(PARAMS))).toBe("hi");
    expect(await readdir(dir)).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.mode).toBe("live");
  });

  it("refuses to build a live client without an API key", () => {
    expect(() => createLlm({ mode: "live", recordingsDir: dir, onCall })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("awaits an async onCall before resolving", async () => {
    let done = false;
    const { client } = createLlm({
      mode: "live",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall: async () => {
        await new Promise((r) => setTimeout(r, 5));
        done = true;
      },
      fetch: async () => jsonResponse(MESSAGE),
    });
    await client.messages.create(PARAMS);
    expect(done).toBe(true);
  });
});

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** A full garbage collection, then a macrotask so FinalizationRegistry callbacks can run. */
async function collectGarbage(): Promise<void> {
  gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createLlm under garbage collection", () => {
  // Node 22's fetch (undici 6.21) cancels a Response's body when a clone of that Response is
  // garbage collected. A collection can land anywhere, so the response the gateway hands the SDK
  // must have a body that no collection can cancel. `onCall` runs after the gateway has read the
  // body and before the SDK reads it, which puts the collection in that window every time.
  it.each(["record", "live"] as const)(
    "%s: a collection after the gateway reads the body does not break the call",
    async (mode) => {
      const { client } = createLlm({
        mode,
        apiKey: "test-key",
        recordingsDir: dir,
        onCall: async (m) => {
          calls.push(m);
          await collectGarbage();
        },
        fetch: async () => jsonResponse(MESSAGE),
      });
      const msg = await client.messages.create(PARAMS);
      expect(textOf(msg)).toBe("hi");
      expect(msg._request_id).toBe("req_test_1");
      expect(calls.map((c) => c.mode)).toEqual([mode]);
    },
  );

  it("replay: a collection before the client reads the body does not break the call", async () => {
    const rec = createLlm({
      mode: "record",
      apiKey: "test-key",
      recordingsDir: dir,
      onCall,
      fetch: async () => jsonResponse(MESSAGE),
    });
    await rec.client.messages.create(PARAMS);
    const rep = createLlm({
      mode: "replay",
      recordingsDir: dir,
      onCall: async (m) => {
        calls.push(m);
        await collectGarbage();
      },
      fetch: throwingFetch,
    });
    expect(textOf(await rep.client.messages.create(PARAMS))).toBe("hi");
  });
});

const sql = await connectTestDb("api_llm_calls");

if (!sql) {
  describe("recordLlmCall (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("api_llm_calls")}`, () => {});
  });
}

describe.skipIf(!sql)("recordLlmCall (Postgres)", () => {
  if (!sql) return;
  afterAll(async () => {
    await sql.end();
  });
  const readRow = async (id: number) => {
    const rows = await sql`
      select purpose, model, mode, input_tokens as "inputTokens", output_tokens as "outputTokens",
        cache_read_tokens as "cacheReadTokens", cache_write_tokens as "cacheWriteTokens",
        latency_ms as "latencyMs", cost_usd as "costUsd", stop_reason as "stopReason",
        request_key as "requestKey", document_id as "documentId",
        conversation_id as "conversationId", created_at as "createdAt"
      from llm_calls where id = ${id}`;
    return rows[0];
  };

  it("inserts a row with tokens, latency and computed cost, and returns its id", async () => {
    const metrics: CallMetrics = {
      requestKey: "a".repeat(64),
      model: "claude-opus-5-5",
      latencyMs: 812.5,
      usage: {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_read_input_tokens: 2_000,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 },
      },
      stopReason: "end_turn",
      mode: "live",
    };
    const id = await recordLlmCall(sql, "agent", metrics, {});
    expect(id).toBeGreaterThan(0);

    const row = await readRow(id);
    expect(row).toMatchObject({
      purpose: "agent",
      model: "claude-opus-5-5",
      mode: "live",
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 300,
      latencyMs: 812.5,
      stopReason: "end_turn",
      requestKey: "a".repeat(64),
      documentId: null,
      conversationId: null,
    });
    // 0.004 + 0.010 + 0.0004 + 300 x $5 / MTok (0.0015)
    expect(row?.costUsd).toBeCloseTo(0.0159, 12);
    expect(row?.createdAt).toBeTruthy();
  });

  it("stores a null stop reason and zero cache counts when absent", async () => {
    const id = await recordLlmCall(
      sql,
      "extract",
      {
        requestKey: "b".repeat(64),
        model: "claude-haiku-5-5",
        latencyMs: 0,
        usage: { input_tokens: 1_000, output_tokens: 500 },
        stopReason: null,
        mode: "replay",
      },
      {},
    );
    const row = await readRow(id);
    expect(row).toMatchObject({ stopReason: null, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(row?.costUsd).toBeCloseTo(0.00035, 12);
  });

  it("refuses an unknown model before inserting", async () => {
    await expect(
      recordLlmCall(
        sql,
        "agent",
        {
          requestKey: "c".repeat(64),
          model: "claude-unknown-1",
          latencyMs: 1,
          usage: { input_tokens: 1, output_tokens: 1 },
          stopReason: "end_turn",
          mode: "live",
        },
        {},
      ),
    ).rejects.toThrow(/claude-unknown-1/);
  });
});
