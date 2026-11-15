/**
 * `POST /api/ask/stream`: the same ask as `POST /api/ask`, as server-sent events. `progress`
 * events name each tool as it starts and finishes (no input, output or text), then exactly one
 * `answer` event carrying the `AskResponse` (only gate-released text: a withheld answer is
 * `answer: null`, and the gate shows counts, never the withheld numbers), or one `error` event.
 * Nothing the model wrote streams before the gate.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AskEvent, type AskRequest } from "@pharos/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { type AgentDeps, AgentError, ConversationNotFoundError, runAgent } from "../ai/agent.js";
import { ReplayMissError } from "../ai/llm.js";
import { toAskResponse } from "./response.js";

/** The message a failed ask reports in its `error` event. */
export function describeAskError(err: unknown): string {
  if (err instanceof ConversationNotFoundError || err instanceof AgentError) return err.message;
  if (err instanceof ReplayMissError) return `replay_miss: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `llm_unavailable: ${err.message}`;
  return "The ask failed unexpectedly.";
}

export async function streamAsk(c: Context, deps: AgentDeps, parsed: AskRequest) {
  return streamSSE(c, async (stream) => {
    // Progress arrives from inside the tool loop, synchronously; keep the writes in order.
    let chain: Promise<void> = Promise.resolve();
    const send = (event: AskEvent) => {
      const checked = AskEvent.parse(event);
      chain = chain.then(() =>
        stream.writeSSE({ event: checked.type, data: JSON.stringify(checked) }),
      );
    };
    try {
      const response = await runAgent(
        { ...deps, onProgress: (p) => send({ type: "progress", ...p }) },
        parsed.question,
        parsed.conversationId,
      );
      send({ type: "answer", response: toAskResponse(response) });
    } catch (err) {
      deps.log?.(`[ask/stream] ${err instanceof Error ? err.message : String(err)}`);
      send({ type: "error", message: describeAskError(err) });
    }
    await chain;
  });
}
