import { PINNED_NOW_OFFSET_MS, pinnedNow } from "@pharos/db";
import { describe, expect, it } from "vitest";
import { createClock } from "./clock.js";

const ANCHOR = new Date("2026-11-14T08:00:00.000Z");

describe("createClock", () => {
  it("pinned: now() is always the anchor plus five minutes", () => {
    const clock = createClock(ANCHOR);
    expect(clock.pinned).toBe(true);
    expect(PINNED_NOW_OFFSET_MS).toBe(5 * 60_000);
    expect(clock.now().toISOString()).toBe("2026-11-14T08:05:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-11-14T08:05:00.000Z");
    expect(clock.anchor()?.toISOString()).toBe("2026-11-14T08:00:00.000Z");
    expect(pinnedNow(ANCHOR).toISOString()).toBe("2026-11-14T08:05:00.000Z");
  });

  it("pinned: callers cannot move the clock by mutating what it returns", () => {
    const clock = createClock(ANCHOR);
    clock.now().setTime(0);
    clock.anchor()?.setTime(0);
    expect(clock.now().toISOString()).toBe("2026-11-14T08:05:00.000Z");
    expect(clock.anchor()?.toISOString()).toBe("2026-11-14T08:00:00.000Z");
  });

  it("unpinned keeps the wall clock", () => {
    const clock = createClock(null);
    expect(clock.pinned).toBe(false);
    expect(clock.anchor()).toBeNull();
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
