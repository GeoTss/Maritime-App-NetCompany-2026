import type { HealthResponse, LlmMode } from "@pharos/shared";
import { Hono } from "hono";
import { createInboxRoutes, type InboxDeps } from "./inbox/routes.js";
import { createReadRoutes } from "./read/routes.js";
import type { ReadSource } from "./read/source.js";

export interface AppDeps {
  llmMode: LlmMode;
  pingDb: () => Promise<boolean>;
  read: ReadSource;
  /** Inbox intake (upload, deliver-next); omitted, those routes are not mounted. */
  inbox?: InboxDeps;
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

  // Before the read routes, whose /api/* middleware would otherwise tag these responses.
  if (deps.inbox) app.route("/api/inbox", createInboxRoutes(deps.inbox));
  app.route("/api", createReadRoutes(deps.read));

  return app;
}
