import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { position } from "./__helpers.js";
import { createReplayAis } from "./replay.js";

describe("createReplayAis", () => {
  it("speed Infinity emits every valid line in order and skips a truncated one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pharos-replay-"));
    const path = join(dir, "capture.jsonl");
    const lines = [0, 1000, 5000].map((offsetMs, i) =>
      JSON.stringify({ offsetMs, message: position(211000000 + i, 36, -5.5) }),
    );
    writeFileSync(path, `${lines[0]}\n{"offsetMs":10\n${lines[1]}\n${lines[2]}\n`);
    const out: { MetaData: { MMSI: number } }[] = [];
    await createReplayAis({ path, speed: Infinity }).run(
      (m) => out.push(m as (typeof out)[number]),
      new AbortController().signal,
    );
    expect(out.map((m) => m.MetaData.MMSI)).toEqual([211000000, 211000001, 211000002]);
  });

  it("a missing capture names npm run record:ais", async () => {
    await expect(
      createReplayAis({ path: join(tmpdir(), "pharos-nope.jsonl") }).run(
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/npm run record:ais/);
  });
});
