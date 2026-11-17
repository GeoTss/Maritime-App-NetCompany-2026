import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD_SEED, PINNED_NOW_OFFSET_MS, pinnedNow } from "./index.js";

describe("demo clock and seed", () => {
  it("pinnedNow is anchor plus five minutes", () => {
    expect(PINNED_NOW_OFFSET_MS).toBe(5 * 60_000);
    const anchor = new Date("2026-11-14T08:00:00Z");
    expect(pinnedNow(anchor).toISOString()).toBe("2026-11-14T08:05:00.000Z");
    expect(anchor.toISOString()).toBe("2026-11-14T08:00:00.000Z");
  });

  it("the default world seed is 20261114", () => {
    expect(DEFAULT_WORLD_SEED).toBe(20261114);
  });
});
