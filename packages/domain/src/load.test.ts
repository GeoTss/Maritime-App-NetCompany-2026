import type { ConsumptionCurve } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { clampSpeed, REFERENCE_VESSEL_PROFILES, SHIP_EU_COVERAGE } from "./constants.js";
import { dailyConsumptionMt, legFuel, mainEngineMtPerDay, portStayFuelMt } from "./consumption.js";
import { displacementMt, draughtLoad, loadFactor, voyageLoad, withLoad } from "./load.js";

const C: ConsumptionCurve = {
  refSpeedKn: 13,
  refMtPerDay: 30,
  auxMtPerDay: 2.5,
  minSpeedKn: 9,
  maxSpeedKn: 14.5,
};
// 36 864 / 72 000 = 0.512 = 0.8³, so the factor is 0.8² = 0.64.
const HALF = { displacementMt: 36_864, refDisplacementMt: 72_000 };

describe("displacementMt", () => {
  it("is lightship + cargo + ballast: 12 000 + 40 000 + 2 000 = 54 000", () => {
    expect(displacementMt({ lightshipMt: 12_000, cargoMt: 40_000, ballastMt: 2_000 })).toBe(54_000);
  });
  it("in ballast with no cargo: 12 000 + 0 + 20 000 = 32 000", () => {
    expect(displacementMt({ lightshipMt: 12_000, cargoMt: 0, ballastMt: 20_000 })).toBe(32_000);
  });
  it("rejects a non-positive lightship and negative cargo or ballast", () => {
    expect(() => displacementMt({ lightshipMt: 0, cargoMt: 1, ballastMt: 0 })).toThrow(RangeError);
    expect(() => displacementMt({ lightshipMt: 1, cargoMt: -1, ballastMt: 0 })).toThrow(RangeError);
    expect(() => displacementMt({ lightshipMt: 1, cargoMt: 0, ballastMt: -1 })).toThrow(RangeError);
  });
});

describe("loadFactor", () => {
  it("(36 864 / 72 000)^(2/3) = 0.512^(2/3) = 0.64", () => {
    expect(loadFactor(HALF)).toBeCloseTo(0.64, 12);
  });
  it("is 1 at the reference displacement and when there is no load", () => {
    expect(loadFactor({ displacementMt: 72_000, refDisplacementMt: 72_000 })).toBe(1);
    expect(loadFactor(undefined)).toBe(1);
  });
});

describe("voyageLoad", () => {
  it("reference = lightship + deadweight: 12 000 + 60 000 = 72 000; displacement 12 000 + 45 000 + 0", () => {
    expect(
      voyageLoad({ lightshipMt: 12_000, dwt: 60_000 }, { cargoMt: 45_000, ballastMt: 0 }),
    ).toEqual({ displacementMt: 57_000, refDisplacementMt: 72_000 });
  });
  it("cargo above deadweight is rejected", () => {
    expect(() =>
      voyageLoad({ lightshipMt: 12_000, dwt: 60_000 }, { cargoMt: 60_001, ballastMt: 0 }),
    ).toThrow(RangeError);
  });
  it("cargo plus ballast above deadweight is rejected; exactly deadweight is accepted", () => {
    expect(() =>
      voyageLoad({ lightshipMt: 12_000, dwt: 60_000 }, { cargoMt: 50_000, ballastMt: 10_001 }),
    ).toThrow(RangeError);
    expect(
      voyageLoad({ lightshipMt: 12_000, dwt: 60_000 }, { cargoMt: 50_000, ballastMt: 10_000 }),
    ).toEqual({ displacementMt: 72_000, refDisplacementMt: 72_000 });
  });
});

describe("withLoad and the consumption curve", () => {
  it("a 30 mt/day curve at the reference speed with that load burns 30 × 0.64 = 19.2 + aux 2.5", () => {
    const loaded = withLoad(C, HALF);
    expect(mainEngineMtPerDay(loaded, 13)).toBeCloseTo(19.2, 9);
    expect(dailyConsumptionMt(loaded, 13)).toBeCloseTo(21.7, 9);
  });
  it("auxiliary burn in port is not scaled: 2.5 × 12 / 24 = 1.25", () => {
    expect(portStayFuelMt(withLoad(C, HALF), 12)).toBeCloseTo(1.25, 12);
  });
  it("leg fuel scales the main engine only: 312 nm at 13 kn = 24 h × 21.7 = 21.7 mt", () => {
    const r = legFuel(withLoad(C, HALF), 312, 13);
    expect(r.hours).toBeCloseTo(24, 12);
    expect(r.fuelMt).toBeCloseTo(21.7, 9);
  });
  it("without a load the curve burns exactly as before (30 + 2.5)", () => {
    expect(dailyConsumptionMt(C, 13)).toBe(32.5);
  });
  it("does not mutate the curve it is given", () => {
    const copy = JSON.stringify(C);
    withLoad(C, HALF);
    expect(JSON.stringify(C)).toBe(copy);
    expect(withLoad(C, HALF)).toEqual({ ...C, load: HALF });
  });
  it("rejects a load with a zero displacement", () => {
    expect(() => withLoad(C, { displacementMt: 0, refDisplacementMt: 72_000 })).toThrow();
  });
});

describe("draughtLoad", () => {
  const bulk = REFERENCE_VESSEL_PROFILES.bulk_carrier;
  const ref = bulk.lightshipMt + bulk.dwtMt;
  const ballast = bulk.lightshipMt + bulk.ballastMt;

  it("draught 0 or null is assumed laden at the reference displacement", () => {
    for (const d of [0, null]) {
      const r = draughtLoad(bulk, d);
      expect(r.condition).toBe("assumed_laden");
      expect(r.load).toEqual({ displacementMt: ref, refDisplacementMt: ref });
      expect(loadFactor(r.load)).toBe(1);
    }
  });
  it("at or above the laden draught is laden at the reference displacement", () => {
    expect(draughtLoad(bulk, bulk.ladenDraughtM)).toEqual({
      condition: "laden",
      load: { displacementMt: ref, refDisplacementMt: ref },
    });
    expect(draughtLoad(bulk, bulk.ladenDraughtM + 3).load.displacementMt).toBe(ref);
  });
  it("at or below the ballast draught is ballast at lightship + ballast water", () => {
    expect(draughtLoad(bulk, bulk.ballastDraughtM)).toEqual({
      condition: "ballast",
      load: { displacementMt: ballast, refDisplacementMt: ref },
    });
    expect(draughtLoad(bulk, 1).load.displacementMt).toBe(ballast);
  });
  it("halfway between the draughts is partial at the mean displacement", () => {
    const mid = (bulk.ladenDraughtM + bulk.ballastDraughtM) / 2;
    const r = draughtLoad(bulk, mid);
    expect(r.condition).toBe("partial");
    expect(r.load.displacementMt).toBeCloseTo((ref + ballast) / 2, 9);
  });
  it("85 % of the way is laden, 15 % ballast, between them partial", () => {
    const at = (t: number) =>
      bulk.ballastDraughtM + t * (bulk.ladenDraughtM - bulk.ballastDraughtM);
    expect(draughtLoad(bulk, at(0.85)).condition).toBe("laden");
    expect(draughtLoad(bulk, at(0.84)).condition).toBe("partial");
    // 0.15 itself is not exactly representable after the subtraction; test either side of it.
    expect(draughtLoad(bulk, at(0.149)).condition).toBe("ballast");
    expect(draughtLoad(bulk, at(0.16)).condition).toBe("partial");
  });
  it("is deterministic", () => {
    expect(JSON.stringify(draughtLoad(bulk, 9.3))).toBe(JSON.stringify(draughtLoad(bulk, 9.3)));
  });
});

describe("reference vessel profiles", () => {
  it("every profile has a laden draught above its ballast draught and ballast within deadweight", () => {
    for (const p of Object.values(REFERENCE_VESSEL_PROFILES)) {
      expect(p.ladenDraughtM).toBeGreaterThan(p.ballastDraughtM);
      expect(p.ballastMt).toBeLessThan(p.dwtMt);
      expect(p.lightshipMt).toBeGreaterThan(0);
    }
  });
});

describe("clampSpeed and SHIP_EU_COVERAGE (moved from packages/db)", () => {
  it("rounds to the 0.5 kn grid and holds within the curve", () => {
    expect(clampSpeed(C, 12.3)).toBe(12.5);
    expect(clampSpeed(C, 12.2)).toBe(12);
    expect(clampSpeed(C, 30)).toBe(14.5);
    expect(clampSpeed(C, 1)).toBe(9);
    expect(clampSpeed(C, 12.3, 1)).toBe(12);
    expect(SHIP_EU_COVERAGE).toBe(0.5);
  });
});
