/**
 * `POST /api/ask`: one question to the ops agent (`AskRequest` -> `AskResponse`, whose gate carries
 * counts only; see response.ts).
 */
import { AskRequest } from "@pharos/shared";
import { type Context, Hono } from "hono";
import { type AgentDeps, runAgent } from "../ai/agent.js";
import { requireContentType } from "../http/require-content-type.js";
import { classifyAskFailure } from "./failure.js";
import { toAskResponse } from "./response.js";
import { streamAsk } from "./stream.js";

export function createAskRoutes(deps: AgentDeps) {
  const app = new Hono();
  app.use(requireContentType("application/json"));

  /** The validated request, or the 400 response. A missing conversationId starts a new one. */
  const readRequest = async (c: Context): Promise<AskRequest | Response> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "Body must be JSON." }, 400);
    }
    const parsed = AskRequest.safeParse(
      body !== null && typeof body === "object" ? { conversationId: null, ...body } : body,
    );
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return c.json({ error: "invalid_request", message }, 400);
    }
    return parsed.data;
  };

  app.post("/stream", async (c) => {
    const parsed = await readRequest(c);
    return parsed instanceof Response ? parsed : streamAsk(c, deps, parsed);
  });

  app.post("/", async (c) => {
    const request = await readRequest(c);
    if (request instanceof Response) return request;
    try {
      return c.json(toAskResponse(await runAgent(deps, request.question, request.conversationId)));
    } catch (err) {
      const failure = classifyAskFailure(err);
      switch (failure.reason) {
        case "conversation_not_found":
        case "replay_miss":
          return c.json({ error: failure.reason, message: failure.message }, failure.status as 404);
        case "refusal":
        case "truncation":
        case "agent_error":
          return c.json({ error: "agent_failed", message: failure.message }, 502);
        case "api_error":
          // The model API refused or could not be reached (401, 429, 529, network): say which, as JSON.
          return c.json(
            {
              error: "llm_unavailable",
              status: failure.upstreamStatus ?? null,
              message: failure.message,
            },
            502,
          );
        default:
          break;
      }
      throw err;
    }
  });

  return app;
}
