import type { HealthResponse, LlmMode } from "@pharos/shared";
import { Hono } from "hono";
import type { AgentDeps } from "./ai/agent.js";
import { type ApprovalDeps, createApprovalRoutes } from "./approvals/routes.js";
import { createAskRoutes } from "./ask/routes.js";
import { createInboxRoutes, type InboxDeps } from "./inbox/routes.js";
import { createLlmCallRoutes, type LlmCallDeps } from "./llm-calls/routes.js";
import { createReadRoutes } from "./read/routes.js";
import type { ReadSource } from "./read/source.js";
import { createUiRoutes } from "./ui/routes.js";

export interface AppDeps {
  llmMode: LlmMode;
  pingDb: () => Promise<boolean>;
  read: ReadSource;
  /** Inbox intake (upload, deliver-next); omitted, those routes are not mounted. */
  inbox?: InboxDeps;
  /** The ops agent behind POST /api/ask; omitted, that route is not mounted. */
  ask?: AgentDeps;
  /** Approve/reject and the executor behind them; omitted, those routes are not mounted. */
  approvals?: ApprovalDeps;
  /** The database behind GET /api/llm-calls; omitted, that route is not mounted. */
  llmCalls?: LlmCallDeps;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.route("/", createUiRoutes());

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
  if (deps.ask) app.route("/api/ask", createAskRoutes(deps.ask));
  if (deps.approvals) app.route("/api/recommendations", createApprovalRoutes(deps.approvals));
  if (deps.llmCalls) app.route("/api/llm-calls", createLlmCallRoutes(deps.llmCalls));
  app.route("/api", createReadRoutes(deps.read));

  return app;
}
