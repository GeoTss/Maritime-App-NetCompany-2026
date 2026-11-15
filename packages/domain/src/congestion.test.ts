import type { CongestionInput } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { portCongestion } from "./congestion.js";

const PORT = { lat: 36, lon: -5.4 };
const near = { lat: 36.1, lon: -5.4 }; // ~6 nm away
const far = { lat: 38, lon: -5.4 }; // ~120 nm away
const v = (p: { lat: number; lon: number }, sogKn: number | null, navStatus: string | null) => ({
  ...p,
  sogKn,
  navStatus,
});
const base = { port: PORT, radiusNm: 20, hoursPerAnchoredVessel: 1.5, maxWaitingHours: 72 };

describe("portCongestion", () => {
  it("2 anchored + 2 moored + 2 slow non-anchored + 1 underway in range, 4 anchored out of range", () => {
    const input: CongestionInput = {
      ...base,
      vessels: [
        v(near, 0, "at anchor"),
        v(near, 0.1, "at anchor"),
        v(near, 0.2, null), // slow, no status: not anchored
        v(near, 0, "under way using engine"), // in a basin: not anchored
        v(near, 0, "moored"),
        v(near, 0.1, "moored"),
        v(near, 12, "under way using engine"),
        ...Array.from({ length: 4 }, () => v(far, 0, "at anchor")),
      ],
    };
    // only navStatus "at anchor" counts: 2 x 1.5 h = 3 h; in range 7
    expect(portCongestion(input)).toEqual({ anchoredCount: 2, inRangeCount: 7, waitingHours: 3 });
  });
  it("caps waiting at maxWaitingHours: 60 x 1.5 = 90 -> 72", () => {
    const vessels = Array.from({ length: 60 }, () => v(near, 0, "at anchor"));
    expect(portCongestion({ ...base, vessels }).waitingHours).toBe(72);
  });
  it("empty input and unknown speed", () => {
    expect(portCongestion({ ...base, vessels: [] })).toEqual({
      anchoredCount: 0,
      inRangeCount: 0,
      waitingHours: 0,
    });
    expect(portCongestion({ ...base, vessels: [v(near, null, null)] }).anchoredCount).toBe(0);
  });
  it("is deterministic", () => {
    const input = { ...base, vessels: [v(near, 0, "at anchor")] };
    expect(portCongestion(input)).toEqual(portCongestion(input));
  });
});
