import type { HealthResponse, LlmMode } from "@pharos/shared";
import { Hono } from "hono";

export interface AppDeps {
  llmMode: LlmMode;
  pingDb: () => Promise<boolean>;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/api/health", async (c) => {
    const dbUp = await deps.pingDb().catch(() => false);
    const body: HealthResponse = {
      status: dbUp ? "ok" : "degraded",
      llmMode: deps.llmMode,
      db: dbUp ? "up" : "down",
    };
    return c.json(body);
  });

  return app;
}
