import { describe, expect, it } from "vitest";
import { position } from "./__helpers.js";
import { createLiveAis, type WsLike } from "./live.js";

const KEY = "SECRET-KEY-123";

class FakeSocket implements WsLike {
  static instances: FakeSocket[] = [];
  static closeAfterOpen = 2;
  onopen: WsLike["onopen"] = null;
  onmessage: WsLike["onmessage"] = null;
  onclose: WsLike["onclose"] = null;
  onerror: WsLike["onerror"] = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
    const n = FakeSocket.instances.length;
    setTimeout(() => {
      this.onopen?.({});
      if (n <= FakeSocket.closeAfterOpen) setTimeout(() => this.onclose?.({}), 0);
    }, 0);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.({});
  }
}

describe("createLiveAis", () => {
  it("a closed socket reconnects with backoff and never logs the key", async () => {
    FakeSocket.instances = [];
    const logs: string[] = [];
    const delays: number[] = [];
    const ctrl = new AbortController();
    const received: unknown[] = [];
    const provider = createLiveAis({
      apiKey: KEY,
      boxes: [
        [
          [35.7, -6],
          [36.4, -5],
        ],
      ],
      WebSocketImpl: FakeSocket,
      log: (l) => logs.push(l),
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const done = provider.run((m) => received.push(m), ctrl.signal);
    // third socket opens and stays open; deliver a frame and a bad frame, then stop
    await new Promise((r) => setTimeout(r, 50));
    expect(FakeSocket.instances).toHaveLength(3);
    const third = FakeSocket.instances[2]!;
    third.onmessage?.({ data: JSON.stringify(position(211000001, 36, -5.5)) });
    third.onmessage?.({ data: "{truncated" });
    await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    await done;

    expect(delays).toEqual([1000, 2000]);
    expect(received).toHaveLength(2);
    expect(received[1]).toBe("{truncated");
    const sub = JSON.parse(third.sent[0] as string);
    expect(sub).toEqual({
      APIKey: KEY,
      BoundingBoxes: [
        [
          [35.7, -6],
          [36.4, -5],
        ],
      ],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    });
    expect(FakeSocket.instances[0]?.url).toBe("wss://stream.aisstream.io/v0/stream");
    const all = logs.join("\n");
    expect(all).not.toContain(KEY);
    expect(all).not.toContain("BoundingBoxes");
  });
});
