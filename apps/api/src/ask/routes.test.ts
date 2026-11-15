import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { AskEvent, AskResponse } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentDeps } from "../ai/agent.js";
import { captureLlmCall } from "../ai/call-capture.js";
import { createLlm, type LlmFetch } from "../ai/llm.js";
import {
  type ScriptStep,
  scriptedFetch,
  scriptedMessage,
  textReply,
  toolCall,
} from "../ai/scripted-llm.js";
import { createApp } from "../app.js";
import { createFixtureSource } from "../read/fixtures.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "./demo-fixture.js";

const sql = await connectTestDb("ask_routes");

if (!sql) {
  describe("POST /api/ask (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_routes")}`, () => {});
  });
}

describe.skipIf(!sql)("POST /api/ask (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;

  beforeEach(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const appWith = (
    script: ScriptStep[],
    llmOpts: { mode?: "live" | "replay"; recordingsDir?: string; fetch?: LlmFetch } = {},
  ) => {
    const scripted = scriptedFetch(script);
    const llm = createLlm({
      mode: llmOpts.mode ?? "live",
      apiKey: "test-key",
      recordingsDir: llmOpts.recordingsDir ?? "/nonexistent",
      onCall: captureLlmCall,
      fetch: llmOpts.fetch ?? scripted.fetch,
    });
    const ask: AgentDeps = {
      sql: db,
      llm,
      config: { agentModel: "claude-haiku-5-5", agentEffort: "medium", llmFallbacks: false },
      now: () => ASK_FIXTURE_NOW,
    };
    const app = createApp({
      llmMode: "live",
      pingDb: async () => true,
      read: createFixtureSource(),
      ask,
    });
    return { app, requests: scripted.requests };
  };

  const post = (app: ReturnType<typeof appWith>["app"], body: unknown) =>
    app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("answers an AskRequest with an AskResponse", async () => {
    const { app } = appWith([textReply(1, "Bunker at Marsaxlokk with Kestrel Marine Fuels.")]);
    const res = await post(app, { question: "Where should we bunker?", conversationId: null });
    expect(res.status).toBe(200);
    const body = AskResponse.parse(await res.json());
    expect(body.answer).toBe("Bunker at Marsaxlokk with Kestrel Marine Fuels.");
    expect(body.gate.passed).toBe(true);
    expect(res.headers.get("x-pharos-data")).toBeNull();
  });

  it("a missing conversationId starts a new conversation", async () => {
    const { app } = appWith([textReply(1, "Kestrel.")]);
    const res = await post(app, { question: "Who?" });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid request without calling the model", async () => {
    const { app, requests } = appWith([]);
    for (const body of [{ question: "" }, { question: 7 }, { question: "x".repeat(2001) }]) {
      const res = await post(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
    const notJson = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it("404 for an unknown conversation", async () => {
    const { app } = appWith([]);
    const res = await post(app, { question: "Where?", conversationId: 999 });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "conversation_not_found" });
  });

  it("502 when the model refuses", async () => {
    const { app } = appWith([scriptedMessage(1, [], "refusal")]);
    const res = await post(app, { question: "Where?", conversationId: null });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "agent_failed" });
  });

  it("502 llm_unavailable with the status when the Anthropic API rejects the call", async () => {
    let calls = 0;
    const unauthorized: LlmFetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
        { status: 401, headers: { "content-type": "application/json", "request-id": "req_401" } },
      );
    };
    const { app } = appWith([], { fetch: unauthorized });
    const res = await post(app, { question: "Where?", conversationId: null });
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error: string; status: number; message: string };
    expect(body).toMatchObject({ error: "llm_unavailable", status: 401 });
    expect(body.message).toMatch(/invalid x-api-key/);
    expect(calls).toBe(1); // a 401 is not retried
  });

  it("502 llm_unavailable with a null status when the API cannot be reached", async () => {
    const offline: LlmFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const { app } = appWith([], { fetch: offline });
    const res = await post(app, { question: "Where?", conversationId: null });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "llm_unavailable", status: null });
  }, 30_000);

  it("500 replay_miss, loud, when a replayed request has no recording", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pharos-ask-replay-"));
    try {
      const { app } = appWith([], { mode: "replay", recordingsDir: dir });
      const res = await post(app, { question: "Where?", conversationId: null });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("replay_miss");
      expect(body.message).toMatch(/no recording for request key [0-9a-f]{64}/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["/api/ask", undefined],
    ["/api/ask", "text/plain"],
    ["/api/ask/stream", "application/x-www-form-urlencoded"],
    ["/api/ask/stream", "multipart/form-data; boundary=x"],
  ])("415s %s with content-type %s, without calling the model", async (path, type) => {
    const { app, requests } = appWith([]);
    const res = await app.request(path, {
      method: "POST",
      ...(type === undefined ? {} : { headers: { "content-type": type } }),
      body: JSON.stringify({ question: "Where?" }),
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "unsupported_media_type" });
    expect(requests).toHaveLength(0);
  });

  /** The stream's events, parsed from the SSE text. */
  const readEvents = async (res: Response) => {
    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter((block) => block.trim() !== "")
      .map((block) => {
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        return AskEvent.parse(JSON.parse(data));
      });
    return { text, events };
  };
  const stream = (app: ReturnType<typeof appWith>["app"], body: unknown) =>
    app.request("/api/ask/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("POST /api/ask/stream sends progress for each tool, then exactly one answer", async () => {
    const { app } = appWith([
      toolCall(1, "plan_bunkering", { vessel: "Aegean Pioneer" }),
      textReply(2, "Bunker at Marsaxlokk with Kestrel Marine Fuels."),
    ]);
    const res = await stream(app, { question: "Where should we bunker?" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const { events } = await readEvents(res);
    const types = events.map((e) => e.type);
    expect(types.indexOf("progress")).toBeGreaterThanOrEqual(0);
    expect(types.filter((t) => t === "answer")).toHaveLength(1);
    expect(types.at(-1)).toBe("answer");
    const progress = events.filter((e) => e.type === "progress");
    expect(progress.map((p) => [p.tool, p.phase])).toEqual([
      ["plan_bunkering", "started"],
      ["plan_bunkering", "finished"],
    ]);
    const answer = events.find((e) => e.type === "answer");
    expect(answer?.type === "answer" && answer.response.answer).toBe(
      "Bunker at Marsaxlokk with Kestrel Marine Fuels.",
    );
  });

  it("a withheld answer never streams its text", async () => {
    const withheld = "The delivered price is 9999.5 USD per tonne.";
    const { app } = appWith([
      toolCall(1, "plan_bunkering", { vessel: "Aegean Pioneer" }),
      textReply(2, withheld),
      textReply(3, withheld),
    ]);
    const res = await stream(app, { question: "What is the price?" });
    const { text, events } = await readEvents(res);
    expect(text).not.toContain("delivered price");
    const answer = events.find((e) => e.type === "answer");
    expect(answer?.type === "answer" && answer.response.answer).toBeNull();
    expect(answer?.type === "answer" && answer.response.gate.passed).toBe(false);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(1);
  });

  it("an invalid request is a 400 before streaming; a failing ask is one error event", async () => {
    const { app } = appWith([]);
    expect((await stream(app, { question: "" })).status).toBe(400);
    const unknown = await readEvents(
      await stream(app, { question: "Where?", conversationId: 999 }),
    );
    expect(unknown.events).toHaveLength(1);
    expect(unknown.events[0]).toMatchObject({ type: "error" });
  });

  it("is not mounted without ask deps", async () => {
    const app = createApp({
      llmMode: "replay",
      pingDb: async () => true,
      read: createFixtureSource(),
    });
    const res = await post(app as ReturnType<typeof appWith>["app"], { question: "Where?" });
    expect(res.status).toBe(404);
  });
});
