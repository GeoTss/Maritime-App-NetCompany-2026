import type { AskEvent, AskResponse } from "@pharos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askStream, operatorAskError, REPLAY_MISS_MESSAGE } from "@/lib/sse";

const response: AskResponse = {
  conversationId: 1,
  messageId: 2,
  answer: "Bunker at Piraeus for $612.50/mt [f_q1_price].",
  facts: [],
  recommendationIds: [],
  llmCallIds: [3],
  subjects: [],
  gate: { passed: true, repaired: false, ungroundedCount: 0, attempts: [] },
};

const frame = (event: AskEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** A streamed body that delivers the given text in the given chunks. */
function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function mockStream(chunks: string[], status = 200) {
  const fn = vi.fn(
    async () =>
      new Response(streamOf(chunks), {
        status,
        headers: { "content-type": "text/event-stream" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const request = { question: "Where should Aegean Pioneer bunker?", conversationId: null };

describe("askStream", () => {
  it("parses each event, even when a frame is split across chunks", async () => {
    const progress: AskEvent = {
      type: "progress",
      callId: "toolu_1",
      tool: "plan_bunkering",
      phase: "started",
      ms: 0,
    };
    const text = frame(progress) + frame({ type: "answer", response });
    const fn = mockStream([text.slice(0, 17), text.slice(17, 80), text.slice(80)]);
    const events: AskEvent[] = [];
    await askStream(request, (e) => events.push(e), new AbortController().signal);
    expect(events).toEqual([progress, { type: "answer", response }]);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ask/stream");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("a stream that ends without an answer ends in an error event", async () => {
    mockStream([
      frame({ type: "progress", callId: "toolu_1", tool: "list_fleet", phase: "started", ms: 0 }),
    ]);
    const events: AskEvent[] = [];
    await askStream(request, (e) => events.push(e), new AbortController().signal);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("an event that fails its schema becomes an error, not data", async () => {
    mockStream([`event: answer\ndata: {"type":"answer","response":{"answer":"$9"}}\n\n`]);
    const events: AskEvent[] = [];
    await askStream(request, (e) => events.push(e), new AbortController().signal);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
  });

  it("an HTTP failure becomes an error event with the API's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "invalid_request", message: "question: Required" }),
            {
              status: 400,
            },
          ),
      ),
    );
    const events: AskEvent[] = [];
    await askStream(request, (e) => events.push(e), new AbortController().signal);
    expect(events).toEqual([{ type: "error", message: "question: Required" }]);
  });

  it("a replay miss (stream event or HTTP code) becomes an operator sentence with no key or path", async () => {
    const developer =
      "replay_miss: LLM replay miss: no recording for request key 9f2c at /app/fixtures/llm-recordings/9f2c.json. Re-record it with LLM_MODE=record.";
    mockStream([frame({ type: "error", message: developer })]);
    const streamed: AskEvent[] = [];
    await askStream(request, (e) => streamed.push(e), new AbortController().signal);
    expect(streamed).toEqual([{ type: "error", message: REPLAY_MISS_MESSAGE }]);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "replay_miss", message: developer.slice(13) }), {
            status: 500,
          }),
      ),
    );
    const http: AskEvent[] = [];
    await askStream(request, (e) => http.push(e), new AbortController().signal);
    expect(http).toEqual([{ type: "error", message: REPLAY_MISS_MESSAGE }]);
    expect(REPLAY_MISS_MESSAGE).toBe(
      "This question has no recorded reply. Start a new conversation and pick a suggested question.",
    );
    expect(REPLAY_MISS_MESSAGE).not.toMatch(/replay_miss|key|\/|LLM_MODE/);
    // Other errors keep the API's own sentence.
    expect(operatorAskError("Conversation 9 not found.")).toBe("Conversation 9 not found.");
  });

  it("an aborted ask ends quietly", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const events: AskEvent[] = [];
    await askStream(request, (e) => events.push(e), controller.signal);
    expect(events).toEqual([]);
  });
});
