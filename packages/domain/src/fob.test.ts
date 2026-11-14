import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { projectFuelOnBoard } from "./fob.js";

const C = { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 8, maxSpeedKn: 16 };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const input = () => ({
  robMt: { LSMGO: 60, VLSFO: 100, HSFO: 0 },
  speedKn: 13,
  safetyMarginDays: 1,
  curve: C,
  legs: [
    { distanceNm: 312, grade: "LSMGO" as const },
    { distanceNm: 624, grade: "VLSFO" as const },
    { distanceNm: 156, grade: "LSMGO" as const },
  ],
});

describe("projectFuelOnBoard", () => {
  // Daily burn at 13 kn = 30 + 2.5 = 32.5 mt/day.
  // Leg 0: 312/13 = 24 h -> 32.5 mt LSMGO. Leg 1: 624/13 = 48 h -> 65 mt VLSFO.
  // Leg 2: 156/13 = 12 h -> 16.25 mt LSMGO.
  // ROB L: 60 -> 27.5 -> 27.5 -> 11.25. ROB V: 100 -> 100 -> 35 -> 35.
  // Margin = 1 day * 32.5 for burned grades L and V; HSFO never burned -> 0.
  // Shortfall L = 48.75 + 32.5 - 60 = 21.25; V = 65 + 32.5 - 100 < 0 -> 0.
  it("projects the worked example", () => {
    const p = projectFuelOnBoard(input());
    expect(p.legs.map((l) => l.fuelMt)).toEqual([32.5, 65, 16.25]);
    expect(p.legs.map((l) => l.hours)).toEqual([24, 48, 12]);
    expect(p.legs.map((l) => l.robAfterMt.LSMGO)).toEqual([27.5, 27.5, 11.25]);
    expect(p.legs.map((l) => l.robAfterMt.VLSFO)).toEqual([100, 35, 35]);
    expect(p.requiredMt).toEqual({ LSMGO: 48.75, VLSFO: 65, HSFO: 0 });
    expect(p.safetyMarginMt).toEqual({ LSMGO: 32.5, VLSFO: 32.5, HSFO: 0 });
    expect(p.shortfallMt).toEqual({ LSMGO: 21.25, VLSFO: 0, HSFO: 0 });
    expect(p.belowMarginAtLeg).toEqual({ LSMGO: 0, VLSFO: null, HSFO: null });
    expect(p.minRobMt).toEqual({ LSMGO: 11.25, VLSFO: 35, HSFO: 0 });
    expect(p.legs.map((l) => l.index)).toEqual([0, 1, 2]);
  });
  it("no legs: nothing required, no margin, no shortfall", () => {
    const p = projectFuelOnBoard({ ...input(), legs: [] });
    expect(p.legs).toEqual([]);
    expect(p.requiredMt).toEqual({ LSMGO: 0, VLSFO: 0, HSFO: 0 });
    expect(p.safetyMarginMt).toEqual({ LSMGO: 0, VLSFO: 0, HSFO: 0 });
    expect(p.shortfallMt).toEqual({ LSMGO: 0, VLSFO: 0, HSFO: 0 });
    expect(p.belowMarginAtLeg).toEqual({ LSMGO: null, VLSFO: null, HSFO: null });
    expect(p.minRobMt).toEqual({ LSMGO: 60, VLSFO: 100, HSFO: 0 });
  });
  it("reports negative ROB without clamping", () => {
    const p = projectFuelOnBoard({
      ...input(),
      robMt: { LSMGO: 10, VLSFO: 0, HSFO: 0 },
      legs: [{ distanceNm: 312, grade: "LSMGO" }],
    });
    expect(p.legs[0]!.robAfterMt.LSMGO).toBe(-22.5);
    expect(p.minRobMt.LSMGO).toBe(-22.5);
    expect(p.shortfallMt.LSMGO).toBe(55);
  });
  it("is deterministic and does not mutate a frozen input", () => {
    const frozen = deepFreeze(input());
    expect(JSON.stringify(projectFuelOnBoard(frozen))).toBe(
      JSON.stringify(projectFuelOnBoard(frozen)),
    );
  });
  it("rejects schema-invalid input and speeds outside the curve", () => {
    expect(() => projectFuelOnBoard({ ...input(), speedKn: -1 })).toThrow(ZodError);
    expect(() => projectFuelOnBoard({ ...input(), speedKn: 17 })).toThrow(RangeError);
  });
});
