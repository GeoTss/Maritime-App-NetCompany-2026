import type { AisBox } from "./boxes.js";
import { type AisProvider, abortableSleep } from "./types.js";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

/** The subset of the WebSocket API used here (Node 22's global WebSocket satisfies it). */
export interface WsLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}
export type WebSocketCtor = new (url: string) => WsLike;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

async function frameText(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as Uint8Array);
  if (data && typeof (data as Blob).text === "function") return (data as Blob).text();
  return null;
}

/**
 * Live AISStream client. The subscription (key, boxes, the two message types) is sent on open, well
 * inside the 3 s limit. The key and the subscription body are never logged. Reconnects with a
 * backoff of 1 s doubling to 30 s, reset once a message arrives.
 */
export function createLiveAis(opts: {
  apiKey: string;
  boxes: AisBox[];
  WebSocketImpl?: WebSocketCtor;
  log?: (line: string) => void;
  /** Test seam: replaces the real wait between reconnects. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): AisProvider {
  const WS = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
  const log = opts.log ?? ((l) => console.log(l));
  const sleep = opts.sleep ?? abortableSleep;

  return {
    mode: "live",
    async run(onMessage, signal) {
      let delay = MIN_BACKOFF_MS;
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          let ws: WsLike;
          try {
            ws = new WS(AISSTREAM_URL);
          } catch {
            log("ais: could not open the AISStream socket");
            return resolve();
          }
          const finish = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          const onAbort = () => {
            try {
              ws.close();
            } catch {}
            finish();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                APIKey: opts.apiKey,
                BoundingBoxes: opts.boxes,
                FilterMessageTypes: ["PositionReport", "ShipStaticData"],
              }),
            );
            log("ais: connected to AISStream, subscription sent");
          };
          ws.onmessage = (ev) => {
            void frameText(ev.data).then((text) => {
              if (text === null) return;
              delay = MIN_BACKOFF_MS;
              try {
                onMessage(JSON.parse(text) as unknown);
              } catch {
                // Unparseable frame: pass the text through so the ingester counts it as dropped.
                onMessage(text);
              }
            });
          };
          ws.onerror = () => {};
          ws.onclose = finish;
        });
        if (signal.aborted) break;
        log(`ais: connection closed; reconnecting in ${delay} ms`);
        await sleep(delay, signal);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
    },
  };
}
