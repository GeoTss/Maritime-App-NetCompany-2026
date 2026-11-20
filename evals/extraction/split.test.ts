import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./prng.js";
import {
  computeSplit,
  devCount,
  GOLDEN_DIR,
  SECURITY_RULE,
  splitFromDisk,
  splitJson,
  VARIANT_TAG,
} from "./split.js";
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

  it("splits Track 3 security strata half and half, hard ones by trap, without moving others", () => {
    const security = [
      ...fake("security-plain", 16),
      ...["four-six-guards", "eur-day-rate"].flatMap((trap) =>
        ["a", "b"].map((r) => ({
          id: `security-hard-${trap}-${r}`,
          tags: ["security-hard", trap],
        })),
      ),
    ];
    const both = computeSplit([...cases, ...security], 7);
    expect(both.strata["security-plain"]).toEqual({ total: 16, dev: 8, heldout: 8 });
    expect(both.strata["security-hard:four-six-guards"]).toEqual({ total: 2, dev: 1, heldout: 1 });
    expect(both.strata["security-hard:eur-day-rate"]).toEqual({ total: 2, dev: 1, heldout: 1 });
    expect(both.securityRule).toBe(SECURITY_RULE);
    expect(split.securityRule).toBeUndefined();
    const old = new Set(cases.map((c) => c.id));
    expect(both.dev.filter((id) => old.has(id))).toEqual(split.dev);
    expect(both.heldout.filter((id) => old.has(id))).toEqual(split.heldout);
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
      "hard-variant",
      "html",
      "multi_grade",
      "not_a_quote",
      "pdf",
      "plain",
      "security-hard:eur-day-rate",
      "security-hard:fees-separate-charges",
      "security-hard:forwarded-older-offer",
      "security-hard:four-six-guards",
      "security-hard:missing-disembark",
      "security-hard:team-in-words",
      "security-html",
      "security-pdf",
      "security-plain",
    ]);
    for (const s of Object.values(split.strata)) expect(s.dev).toBeGreaterThan(0);
    expect(split.strata.hard?.dev).toBe(6);
    expect(split.strata["hard-variant"]).toEqual({ total: 20, dev: 20, heldout: 0 });
    for (const t of ["security-plain", "security-html", "security-pdf"]) {
      expect(split.strata[t]).toEqual({ total: 16, dev: 8, heldout: 8 });
    }
    // 84 / 156 before Track 3, plus 24 + 6 security cases on each side.
    expect(split.dev).toHaveLength(84 + 30);
    expect(split.heldout).toHaveLength(156 + 30);
  });

  it("Track 3 leaves every earlier case's membership as it was (84 dev, 156 held-out)", async () => {
    const split = await splitFromDisk();
    const earlier = (ids: string[]) => ids.filter((id) => !id.startsWith("security-"));
    expect(earlier(split.dev)).toHaveLength(84);
    expect(earlier(split.heldout)).toHaveLength(156);
    const truths = await Promise.all(
      [...split.dev, ...split.heldout].map(async (id) =>
        JSON.parse(await readFile(join(GOLDEN_DIR, `${id}.truth.json`), "utf8")),
      ),
    );
    const alone = computeSplit(truths.filter((t) => !t.tags[0].startsWith("security-")));
    expect(earlier(split.dev)).toEqual(alone.dev);
    expect(earlier(split.heldout)).toEqual(alone.heldout);
    expect(alone.securityRule).toBeUndefined();
  });

  it("puts every dev-only trap variant in dev and leaves the 220 approved cases' split alone", async () => {
    const split = await splitFromDisk();
    const truths = await Promise.all(
      [...split.dev, ...split.heldout].map(async (id) =>
        JSON.parse(await readFile(join(GOLDEN_DIR, `${id}.truth.json`), "utf8")),
      ),
    );
    const approved = truths.filter(
      (t) => !t.tags.includes(VARIANT_TAG) && !t.tags[0].startsWith("security-"),
    );
    const variants = truths.filter((t) => t.tags.includes(VARIANT_TAG));
    expect(approved).toHaveLength(220);
    expect(variants).toHaveLength(20);
    for (const v of variants) expect(split.dev).toContain(v.id);
    const alone = computeSplit(approved);
    const fuel = (id: string) => !id.endsWith("-v2") && !id.startsWith("security-");
    expect(split.dev.filter(fuel)).toEqual(alone.dev);
    expect(split.heldout.filter((id) => !id.startsWith("security-"))).toEqual(alone.heldout);
    expect(alone.dev).toHaveLength(64);
  });
});
