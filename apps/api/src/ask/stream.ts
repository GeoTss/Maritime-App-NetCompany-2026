/**
 * `POST /api/ask/stream`: the same ask as `POST /api/ask`, as server-sent events. `progress`
 * events name each tool call (by tool_use id) as it starts, finishes or fails (no input, output or text), then exactly one
 * `answer` event carrying the `AskResponse` (only gate-released text: a withheld answer is
 * `answer: null`, and the gate shows counts, never the withheld numbers), or one `error` event.
 * Nothing the model wrote streams before the gate.
 */
import { AskEvent, type AskRequest } from "@pharos/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { type AgentDeps, runAgent } from "../ai/agent.js";
import { classifyAskFailure } from "./failure.js";
import { toAskResponse } from "./response.js";

/** The message a failed ask reports in its `error` event. */
export function describeAskError(err: unknown): string {
  const { reason, message } = classifyAskFailure(err);
  if (reason === "replay_miss") return `replay_miss: ${message}`;
  if (reason === "api_error") return `llm_unavailable: ${message}`;
  return message;
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
