import { HealthResponse } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createFixtureSource } from "./read/fixtures.js";

const read = createFixtureSource();

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const app = createApp({ llmMode: "replay", pingDb: async () => true, read });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: "ok", llmMode: "replay", db: "up" });
  });

  it("reports degraded with db down when the probe rejects", async () => {
    const app = createApp({
      llmMode: "live",
      pingDb: async () => {
        throw new Error("ECONNREFUSED");
      },
      read,
    });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", llmMode: "live", db: "down" });
  });
});
