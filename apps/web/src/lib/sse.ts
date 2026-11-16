/**
 * `POST /api/ask/stream` read as server-sent events. Each `data:` payload is parsed with
 * `AskEvent`; anything else (a malformed frame, an HTTP error, a stream that ends without an
 * answer) is reported as one `error` event, so the dock always ends in an answer or an error row.
 * An aborted ask ends quietly.
 */
import { AskEvent, type AskRequest } from "@pharos/shared";

const isAbort = (err: unknown, signal: AbortSignal) =>
  signal.aborted || (err instanceof DOMException && err.name === "AbortError");

/**
 * In replay (the offline demo) a question nobody recorded has no answer. The API's message names
 * the request key and the recording path: developer text, so the operator gets a sentence instead.
 */
export const REPLAY_MISS_MESSAGE =
  "This question has no recorded answer in the demo. Ask one of the suggested questions.";

const isReplayMiss = (text: string) => /^replay_miss\b/.test(text);

/** The error text the dock shows: the API's message, except a replay miss. */
export function operatorAskError(message: string): string {
  return isReplayMiss(message) ? REPLAY_MISS_MESSAGE : message;
}

async function httpErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    if (typeof body.error === "string" && isReplayMiss(body.error)) return REPLAY_MISS_MESSAGE;
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // fall through
  }
  return `The ask failed: the API answered ${res.status}.`;
}

/** The `data:` lines of one SSE frame, joined as the spec says (by newlines). */
function dataOf(frame: string): string | null {
  const lines = frame.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (lines.length === 0) return null;
  return lines.map((l) => l.slice(5).replace(/^ /, "")).join("\n");
}

export async function askStream(
  req: AskRequest,
  onEvent: (e: AskEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let ended = false;
  const emit = (e: AskEvent) => {
    if (ended) return;
    if (e.type !== "progress") ended = true;
    onEvent(e.type === "error" ? { ...e, message: operatorAskError(e.message) } : e);
  };
  const fail = (message: string) => emit({ type: "error", message });

  let res: Response;
  try {
    res = await fetch("/api/ask/stream", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (isAbort(err, signal)) return;
    return fail("The assistant could not be reached.");
  }
  if (!res.ok) return fail(await httpErrorMessage(res));
  if (!res.body) return fail("The answer stream was empty.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleFrame = (frame: string) => {
    const data = dataOf(frame);
    if (data === null) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return fail("The answer stream sent an unreadable event.");
    }
    const parsed = AskEvent.safeParse(json);
    if (!parsed.success)
      return fail("The answer stream sent an event that did not match its contract.");
    emit(parsed.data);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.search(/\r?\n\r?\n/);
      while (cut !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
        handleFrame(frame);
        if (ended) {
          await reader.cancel().catch(() => undefined);
          return;
        }
        cut = buffer.search(/\r?\n\r?\n/);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleFrame(buffer);
  } catch (err) {
    if (isAbort(err, signal)) return;
    return fail("The answer stream dropped before the answer arrived.");
  }
  if (!ended && !signal.aborted) fail("The answer stream ended before an answer arrived.");
}
