/**
 * The one place an ask's failure is classified: the route, the stream and the Q&A runner all call
 * `classifyAskFailure`, so a new failure is added here and nowhere else.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AgentError, type AgentFailureReason, ConversationNotFoundError } from "../ai/agent.js";
import { ReplayMissError } from "../ai/llm.js";

export interface AskFailure {
  reason: AgentFailureReason | "internal";
  /** The HTTP status the route answers with. */
  status: number;
  /** What the error says; for `internal`, a fixed text (the cause is logged, never sent). */
  message: string;
  /** The model API's own status, for `api_error` only (null when it could not be reached). */
  upstreamStatus?: number | null;
}

export function classifyAskFailure(err: unknown): AskFailure {
  if (err instanceof ConversationNotFoundError) {
    return { reason: "conversation_not_found", status: 404, message: err.message };
  }
  if (err instanceof AgentError) return { reason: err.reason, status: 502, message: err.message };
  if (err instanceof ReplayMissError) {
    // Loud on purpose: a prompt or tool output changed without re-recording.
    return { reason: "replay_miss", status: 500, message: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    return {
      reason: "api_error",
      status: 502,
      message: err.message,
      upstreamStatus: err.status ?? null,
    };
  }
  return { reason: "internal", status: 500, message: "The ask failed unexpectedly." };
}
