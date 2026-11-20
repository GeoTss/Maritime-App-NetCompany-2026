import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { QA_CATEGORIES } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../extraction/prng.js";
import { computeQaSplit, devCount, QA_GOLDEN_DIR, qaSplitJson, readQaTruths } from "./split.js";

const fake = (stratum: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${stratum}-${i}`, tags: [stratum] }));

describe("computeQaSplit", () => {
  const cases = [...fake("a", 7), ...fake("b", 4), ...fake("c", 1)];
  const split = computeQaSplit(cases, 9);

  it("puts ceil(n / 2) of every stratum in dev", () => {
    expect(devCount(7)).toBe(4);
    expect(split.strata).toEqual({
      a: { total: 7, dev: 4, heldout: 3 },
      b: { total: 4, dev: 2, heldout: 2 },
      c: { total: 1, dev: 1, heldout: 0 },
    });
  });

  it("picks dev by lowest sha256(seed + id), is a stable partition, ignores input order", () => {
    const expected = fake("a", 7)
      .map((c) => c.id)
      .sort((x, y) => (sha256Hex(`9${x}`) < sha256Hex(`9${y}`) ? -1 : 1))
      .slice(0, 4)
      .sort();
    expect(split.dev.filter((id) => id.startsWith("a-"))).toEqual(expected);
    expect(computeQaSplit([...cases].reverse(), 9)).toEqual(split);
    expect([...split.dev, ...split.heldout].sort()).toEqual(cases.map((c) => c.id).sort());
  });

  it("refuses duplicate ids and a case without a stratum", () => {
    expect(() => computeQaSplit([...fake("a", 1), ...fake("a", 2)])).toThrow(/duplicate/);
    expect(() => computeQaSplit([{ id: "x", tags: [] }])).toThrow(/tags\[0\]/);
  });
});

describe("split.json of the Q&A golden set", () => {
  it("matches the truth files and covers every category in dev", async () => {
    const split = computeQaSplit(await readQaTruths());
    expect(await readFile(join(QA_GOLDEN_DIR, "split.json"), "utf8")).toBe(qaSplitJson(split));
    expect(Object.keys(split.strata).sort()).toEqual([...QA_CATEGORIES].sort());
    for (const s of Object.values(split.strata)) {
      expect(s.dev).toBeGreaterThan(0);
      expect(s.dev).toBe(Math.ceil(s.total / 2));
    }
    expect(split.dev).toHaveLength(35);
    expect(split.heldout).toHaveLength(34);
    expect(split.strata.route_speed).toMatchObject({ total: 11, dev: 6, heldout: 5 });
    expect(split.strata.congestion).toMatchObject({ total: 4, dev: 2, heldout: 2 });
    expect(split.strata.compliance).toMatchObject({ total: 4, dev: 2, heldout: 2 });
    expect(split.strata.security).toMatchObject({ total: 4, dev: 2, heldout: 2 });
  });
});
