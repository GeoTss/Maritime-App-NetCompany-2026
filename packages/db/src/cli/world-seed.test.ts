import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD_SEED, parseWorldSeed } from "./world-seed.js";

describe("parseWorldSeed", () => {
  it("defaults when unset or blank", () => {
    expect(parseWorldSeed(undefined)).toBe(DEFAULT_WORLD_SEED);
    expect(parseWorldSeed("  ")).toBe(DEFAULT_WORLD_SEED);
  });

  it("accepts decimal digits from 0 to 2147483647", () => {
    expect(parseWorldSeed("0")).toBe(0);
    expect(parseWorldSeed(" 7 ")).toBe(7);
    expect(parseWorldSeed("2147483647")).toBe(2147483647);
  });

  it.each(["0x10", "1e3", "1.5", "-1", "+5", "abc", "2147483648", "99999999999999999999"])(
    "rejects %s, naming WORLD_SEED but not the value",
    (raw) => {
      try {
        parseWorldSeed(raw);
        expect.unreachable(`${raw} must be rejected`);
      } catch (e) {
        expect(String(e)).toMatch(/WORLD_SEED/);
        expect(String(e)).not.toContain(raw);
      }
    },
  );
});
