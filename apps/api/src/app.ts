import type { HealthResponse, LlmMode } from "@pharos/shared";
import { Hono } from "hono";
import type { AgentDeps } from "./ai/agent.js";
import { type ApprovalDeps, createApprovalRoutes } from "./approvals/routes.js";
import { createAskRoutes } from "./ask/routes.js";
import type { Clock } from "./clock.js";
import { createEvalRoutes, type EvalRouteDeps } from "./eval/routes.js";
import { createInboxRoutes, type InboxDeps } from "./inbox/routes.js";
import { createLiveRoutes, type LiveDeps } from "./live/routes.js";
import { createLlmCallRoutes, type LlmCallDeps } from "./llm-calls/routes.js";
import { createReadRoutes } from "./read/routes.js";
import type { ReadSource } from "./read/source.js";
import { createReviewRoutes, type ReviewRouteDeps } from "./review/routes.js";
import { createScenarioRoutes } from "./scenario/routes.js";
import type { ScenarioDeps } from "./scenario/service.js";
import { createUiRoutes } from "./ui/routes.js";

export interface AppDeps {
  llmMode: LlmMode;
  pingDb: () => Promise<boolean>;
  /** The configured model per prompt, reported by /api/health; omitted, it reports null. */
  models?: { extractModel: string; agentModel: string };
  read: ReadSource;
  /** Inbox intake (upload, deliver-next); omitted, those routes are not mounted. */
  inbox?: InboxDeps;
  /** The review queue (accept with corrections, reject, retry); omitted, those routes are not mounted. */
  review?: ReviewRouteDeps;
  /** The ops agent behind POST /api/ask; omitted, that route is not mounted. */
  ask?: AgentDeps;
  /** Approve/reject and the executor behind them; omitted, those routes are not mounted. */
  approvals?: ApprovalDeps;
  /** The database behind GET /api/llm-calls; omitted, that route is not mounted. */
  llmCalls?: LlmCallDeps;
  /** Live map data and route planning; omitted, those routes are not mounted. */
  live?: LiveDeps;
  /** The request clock /api/clock reports (required: a forgotten clock would unpin the demo). */
  clock: Clock;
  /** The published evaluation summary behind GET /api/eval/summary; omitted, not mounted. */
  evalSummary?: EvalRouteDeps;
  /** The demo Scenario panel behind /api/scenario; omitted, not mounted. */
  scenario?: ScenarioDeps;
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
      extractModel: deps.models?.extractModel ?? null,
      agentModel: deps.models?.agentModel ?? null,
    };
    return c.json(body);
  });

  if (deps.inbox) app.route("/api/inbox", createInboxRoutes(deps.inbox));
  if (deps.review) app.route("/api/review", createReviewRoutes(deps.review));
  if (deps.ask) app.route("/api/ask", createAskRoutes(deps.ask));
  if (deps.approvals) app.route("/api/recommendations", createApprovalRoutes(deps.approvals));
  if (deps.llmCalls) app.route("/api/llm-calls", createLlmCallRoutes(deps.llmCalls));
  if (deps.live) app.route("/api", createLiveRoutes(deps.live));
  if (deps.evalSummary) app.route("/api/eval", createEvalRoutes(deps.evalSummary));
  if (deps.scenario) app.route("/api/scenario", createScenarioRoutes(deps.scenario));
  app.route("/api", createReadRoutes(deps.read, deps.clock));

  return app;
}
