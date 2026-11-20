import { describe, expect, it } from "vitest";
import { createPrng, prngInt, prngPick } from "./prng.js";

describe("prng", () => {
  it("prng is deterministic", () => {
    const a = createPrng(20261114);
    const b = createPrng(20261114);
    const first = [a(), a(), a(), a(), a()];
    expect([b(), b(), b(), b(), b()]).toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const c = createPrng(20261115);
    expect([c(), c(), c(), c(), c()]).not.toEqual(first);
  });

  it("prngInt stays in [min, max] and prngPick picks from the list", () => {
    const r = createPrng(1);
    for (let i = 0; i < 200; i++) {
      const n = prngInt(r, 3, 7);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      expect(["a", "b"]).toContain(prngPick(r, ["a", "b"]));
    }
    expect(() => prngPick(r, [])).toThrow(RangeError);
  });
});
