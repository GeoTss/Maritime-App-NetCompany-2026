/** `POST /api/ask`: one question to the ops agent (`AskRequest` -> `AskResponse`). */
import Anthropic from "@anthropic-ai/sdk";
import { AskRequest } from "@pharos/shared";
import { Hono } from "hono";
import { type AgentDeps, AgentError, ConversationNotFoundError, runAgent } from "../ai/agent.js";
import { ReplayMissError } from "../ai/llm.js";

export function createAskRoutes(deps: AgentDeps) {
  const app = new Hono();

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "Body must be JSON." }, 400);
    }
    // A missing conversationId starts a new conversation.
    const parsed = AskRequest.safeParse(
      body !== null && typeof body === "object" ? { conversationId: null, ...body } : body,
    );
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return c.json({ error: "invalid_request", message }, 400);
    }
    try {
      return c.json(await runAgent(deps, parsed.data.question, parsed.data.conversationId));
    } catch (err) {
      if (err instanceof ConversationNotFoundError) {
        return c.json({ error: "conversation_not_found", message: err.message }, 404);
      }
      if (err instanceof AgentError) {
        return c.json({ error: "agent_failed", message: err.message }, 502);
      }
      if (err instanceof ReplayMissError) {
        // Loud on purpose: a prompt or tool output changed without re-recording.
        return c.json({ error: "replay_miss", message: err.message }, 500);
      }
      if (err instanceof Anthropic.APIError) {
        // The model API refused or could not be reached (401, 429, 529, network): say which, as JSON.
        return c.json(
          { error: "llm_unavailable", status: err.status ?? null, message: err.message },
          502,
        );
      }
      throw err;
    }
  });

  return app;
}
