import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { AskResponse } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentDeps } from "../ai/agent.js";
import { captureLlmCall } from "../ai/call-capture.js";
import { createLlm } from "../ai/llm.js";
import { type ScriptStep, scriptedFetch, scriptedMessage, textReply } from "../ai/scripted-llm.js";
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

  const appWith = (script: ScriptStep[]) => {
    const scripted = scriptedFetch(script);
    const llm = createLlm({
      mode: "live",
      apiKey: "test-key",
      recordingsDir: "/nonexistent",
      onCall: captureLlmCall,
      fetch: scripted.fetch,
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
    const notJson = await app.request("/api/ask", { method: "POST", body: "{" });
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
