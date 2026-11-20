import { HealthResponse } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createClock } from "./clock.js";
import { createFixtureSource, FIXTURE_ANCHOR } from "./read/fixtures.js";

const read = createFixtureSource();

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const app = createApp({
      llmMode: "replay",
      clock: createClock(FIXTURE_ANCHOR),
      pingDb: async () => true,
      read,
    });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({
      status: "ok",
      llmMode: "replay",
      db: "up",
      extractModel: null,
      agentModel: null,
    });
  });

  it("reports the configured extraction and agent models", async () => {
    const app = createApp({
      llmMode: "live",
      clock: createClock(FIXTURE_ANCHOR),
      pingDb: async () => true,
      read,
      models: { extractModel: "claude-haiku-5-5", agentModel: "claude-sonnet-5-5" },
    });
    const body = HealthResponse.parse(await (await app.request("/api/health")).json());
    expect(body).toMatchObject({
      extractModel: "claude-haiku-5-5",
      agentModel: "claude-sonnet-5-5",
    });
  });

  it("reports degraded with db down when the probe rejects", async () => {
    const app = createApp({
      llmMode: "live",
      clock: createClock(FIXTURE_ANCHOR),
      pingDb: async () => {
        throw new Error("ECONNREFUSED");
      },
      read,
    });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "degraded",
      llmMode: "live",
      db: "down",
      extractModel: null,
      agentModel: null,
    });
  });
});
