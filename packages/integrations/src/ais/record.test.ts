import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { position, safety } from "./__helpers.js";
import { recordCapture } from "./record.js";
import type { AisProvider } from "./types.js";

const emitting = (msgs: unknown[]): AisProvider => ({
  mode: "live",
  run: async (onMessage) => {
    for (const m of msgs) onMessage(m);
  },
});

describe("recordCapture", () => {
  it("leaves the old capture unchanged when a run receives no position", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "pharos-rec-")), "ais-capture.jsonl");
    writeFileSync(out, "old\n");
    const r = await recordCapture({
      provider: emitting([safety(211000001, "HELLO"), { junk: true }]),
      out,
      seconds: 1,
      maxMessages: 10,
    });
    expect(r).toMatchObject({ written: false, positions: 0, hazardMessages: 1, skipped: 1 });
    expect(readFileSync(out, "utf8")).toBe("old\n");
  });

  it("writes the capture when a position arrives", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "pharos-rec-")), "ais-capture.jsonl");
    const r = await recordCapture({
      provider: emitting([position(211000001, 36, -5.5), safety(211000001, "HELLO")]),
      out,
      seconds: 1,
      maxMessages: 10,
    });
    expect(r).toMatchObject({ written: true, messages: 2, positions: 1 });
    expect(readFileSync(out, "utf8").trim().split("\n")).toHaveLength(2);
  });
});
