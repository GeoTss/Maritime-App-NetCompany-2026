import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./prng.js";
import { computeSplit, devCount, GOLDEN_DIR, splitFromDisk, splitJson } from "./split.js";
import { EVAL_SEED } from "./world.js";

const fake = (stratum: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${stratum}-${i}`, tags: [stratum, "x"] }));

describe("computeSplit", () => {
  const cases = [...fake("a", 40), ...fake("b", 20), ...fake("c", 3)];
  const split = computeSplit(cases, 7);

  it("puts ceil(n x 60/220) of every stratum in dev", () => {
    expect(devCount(20)).toBe(6);
    expect(devCount(40)).toBe(11);
    expect(split.strata).toEqual({
      a: { total: 40, dev: 11, heldout: 29 },
      b: { total: 20, dev: 6, heldout: 14 },
      c: { total: 3, dev: 1, heldout: 2 },
    });
  });

  it("chooses dev by the lowest sha256(seed + id) in each stratum, never by position", () => {
    const expectedB = fake("b", 20)
      .map((c) => c.id)
      .sort((x, y) => (sha256Hex(`7${x}`) < sha256Hex(`7${y}`) ? -1 : 1))
      .slice(0, 6)
      .sort();
    expect(split.dev.filter((id) => id.startsWith("b-"))).toEqual(expectedB);
    expect(computeSplit(cases, 8).dev).not.toEqual(split.dev);
  });

  it("is stable, a partition, and independent of input order", () => {
    expect(computeSplit([...cases].reverse(), 7)).toEqual(split);
    const all = [...split.dev, ...split.heldout].sort();
    expect(all).toEqual(cases.map((c) => c.id).sort());
    expect(split.dev.some((id) => split.heldout.includes(id))).toBe(false);
  });

  it("refuses duplicate ids and cases without a stratum", () => {
    expect(() => computeSplit([...fake("a", 2), ...fake("a", 1)])).toThrow(/duplicate/);
    expect(() => computeSplit([{ id: "x", tags: [] }])).toThrow(/tags\[0\]/);
  });
});

describe("split.json of the golden set", () => {
  it("matches the truth files, covers every category in dev and has ≥ 6 hard dev cases", async () => {
    const split = await splitFromDisk();
    const onDisk = await readFile(join(GOLDEN_DIR, "split.json"), "utf8");
    expect(onDisk).toBe(splitJson(split));
    expect(split.seed).toBe(EVAL_SEED);
    expect(Object.keys(split.strata).sort()).toEqual([
      "eur",
      "forwarded",
      "hard",
      "html",
      "multi_grade",
      "not_a_quote",
      "pdf",
      "plain",
    ]);
    for (const s of Object.values(split.strata)) expect(s.dev).toBeGreaterThan(0);
    expect(split.strata.hard?.dev).toBe(6);
    expect(split.dev).toHaveLength(64);
    expect(split.heldout).toHaveLength(156);
  });
});
