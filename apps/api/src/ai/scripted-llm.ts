/**
 * Test support: a transport for `createLlm` that answers Messages requests from a script, so the
 * agent loop (tool runner, gateway, recording) runs for real without the network.
 */
import type { LlmFetch } from "./llm.js";

export type ScriptedBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** A Messages API response body with the given content. */
export function scriptedMessage(
  n: number,
  content: ScriptedBlock[],
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" = "end_turn",
) {
  return {
    id: `msg_scripted_${n}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: content.map((b) => (b.type === "text" ? { ...b, citations: null } : b)),
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1000 + n,
      output_tokens: 100 + n,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      service_tier: "standard",
    },
  };
}

export const textReply = (n: number, text: string) => scriptedMessage(n, [{ type: "text", text }]);

export const toolCall = (n: number, name: string, input: unknown) =>
  scriptedMessage(n, [{ type: "tool_use", id: `toolu_scripted_${n}`, name, input }], "tool_use");

/** A request body as the scripted transport sees it. */
export interface ScriptedRequest {
  messages: { role: string; content: unknown }[];
  [key: string]: unknown;
}

/** A scripted response, or a function that builds one from the request (e.g. from a tool result). */
export type ScriptStep = unknown | ((request: ScriptedRequest) => unknown);

/** The text of the last tool_result in a request, parsed as JSON. */
export function lastToolResult(request: ScriptedRequest): unknown {
  for (const m of [...request.messages].reverse()) {
    if (!Array.isArray(m.content)) continue;
    const block = (m.content as { type: string; content?: unknown }[])
      .filter((b) => b.type === "tool_result")
      .at(-1);
    if (!block) continue;
    const c = block.content;
    const text = typeof c === "string" ? c : (c as { text: string }[]).map((x) => x.text).join("");
    return JSON.parse(text);
  }
  throw new Error("scripted LLM: the request carries no tool_result");
}

/** Serves `script` in order; records each request body. A request past the end fails the test. */
export function scriptedFetch(script: ScriptStep[]): {
  fetch: LlmFetch;
  requests: ScriptedRequest[];
} {
  const requests: ScriptedRequest[] = [];
  const fetch: LlmFetch = async (_url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push(body);
    const step = script[requests.length - 1];
    const next = typeof step === "function" ? step(body) : step;
    if (next === undefined)
      throw new Error(`scripted LLM: no response for request ${requests.length}`);
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": `req_${requests.length}` },
    });
  };
  return { fetch, requests };
}
