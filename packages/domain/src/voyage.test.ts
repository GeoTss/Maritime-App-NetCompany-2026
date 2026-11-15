import type { ConsumptionCurve, Port, RouteLeg, Voyage } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { polylineNm } from "./geo.js";
import {
  cumulativeNm,
  fuelBetween,
  hoursBetween,
  legsForRoute,
  portGrade,
  positionAt,
  remainingFobLegs,
  remainingRoutePoints,
  sailedNmAt,
  tankFreeMt,
  totalNm,
  type VoyagePath,
} from "./voyage.js";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-14T00:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);
/** One degree of latitude along a meridian: 2π × 3440.065 / 360 nm. */
const NM_PER_DEG = (2 * Math.PI * 3440.065) / 360;

const port = (id: number, lat: number, inEca: boolean): Port => ({
  id,
  unlocode: `XXP0${id}`,
  name: `Port ${id}`,
  country: "XX",
  lat,
  lon: 0,
  isEu: true,
  inEca,
  approachNm: 0,
});
// Route A (0°N) -> port 2 (1°N) -> C (2°N); only the end ports matter for in-port burn.
const A = port(1, 0, true); // ECA origin: in-port burn is LSMGO
const C = port(3, 2, false); // non-ECA destination: in-port burn is VLSFO

const LEG_AB: RouteLeg = {
  id: 1,
  fromPortId: 1,
  toPortId: 2,
  distanceNm: 60,
  requiredGrade: "LSMGO",
  etsCoverage: 1,
  waypoints: [
    { lat: 0, lon: 0 },
    { lat: 1, lon: 0 },
  ],
};
const LEG_BC: RouteLeg = {
  id: 2,
  fromPortId: 2,
  toPortId: 3,
  distanceNm: 40,
  requiredGrade: "VLSFO",
  etsCoverage: 1,
  waypoints: [
    { lat: 1, lon: 0 },
    { lat: 2, lon: 0 },
  ],
};

/** At 10 kn: main 24 + aux 2.4 = 26.4 mt/day = 1.1 mt/h = 0.11 mt/nm; in port 0.1 mt/h. */
const CURVE: ConsumptionCurve = {
  refSpeedKn: 10,
  refMtPerDay: 24,
  auxMtPerDay: 2.4,
  minSpeedKn: 8,
  maxSpeedKn: 14,
};
const VOYAGE: Voyage = {
  id: 1,
  vesselId: 1,
  voyageNo: "T-1",
  originPortId: 1,
  destinationPortId: 3,
  plannedSpeedKn: 10,
  plannedRoute: [1, 2, 3],
  status: "underway",
  departedAt: T0,
  cargoMt: 0,
  ballastMt: 0,
};
// 100 nm at 10 kn: departs T0, arrives T0 + 10 h.
const PATH: VoyagePath = {
  voyage: VOYAGE,
  legs: [LEG_AB, LEG_BC],
  origin: A,
  destination: C,
  curve: CURVE,
  departAt: T0,
};

describe("legsForRoute", () => {
  it("returns the legs in passage order", () => {
    expect(legsForRoute([1, 2, 3], [LEG_BC, LEG_AB])).toEqual([LEG_AB, LEG_BC]);
  });
  it("throws when a leg is missing", () => {
    expect(() => legsForRoute([1, 3], [LEG_AB, LEG_BC])).toThrow(/1 -> 3/);
  });
});

describe("path distances", () => {
  it("totalNm sums the legs (60 + 40 = 100)", () => {
    expect(totalNm(PATH)).toBe(100);
  });
  it("cumulativeNm gives the distance to each port, origin first", () => {
    expect(cumulativeNm(PATH)).toEqual([0, 60, 100]);
  });
});

describe("portGrade", () => {
  it("ECA ports burn LSMGO, others VLSFO", () => {
    expect(portGrade(A)).toBe("LSMGO");
    expect(portGrade(C)).toBe("VLSFO");
  });
});

describe("sailedNmAt", () => {
  it("is 0 before departure", () => {
    expect(sailedNmAt(PATH, at(-2))).toBe(0);
  });
  it("is speed × elapsed hours while underway (3 h × 10 kn = 30 nm)", () => {
    expect(sailedNmAt(PATH, at(3))).toBe(30);
  });
  it("is clamped to the route length after arrival", () => {
    expect(sailedNmAt(PATH, at(12))).toBe(100);
  });
});

describe("positionAt", () => {
  it("30 nm along the first leg is 30 / 60.0405 degrees north", () => {
    const p = positionAt(PATH, 30);
    expect(p.lat).toBeCloseTo(30 / NM_PER_DEG, 9);
    expect(p.lon).toBe(0);
  });
  it("80 nm is 20 nm into the second leg", () => {
    expect(positionAt(PATH, 80).lat).toBeCloseTo(1 + 20 / NM_PER_DEG, 9);
  });
  it("beyond the route is the destination port", () => {
    expect(positionAt(PATH, 150)).toEqual({ lat: 2, lon: 0 });
  });
});

describe("remainingFobLegs", () => {
  it("at the origin, both whole legs remain", () => {
    expect(remainingFobLegs(PATH, 0)).toEqual([
      { distanceNm: 60, grade: "LSMGO" },
      { distanceNm: 40, grade: "VLSFO" },
    ]);
  });
  it("30 nm in: the rest of leg 1 (30) then leg 2 (40)", () => {
    expect(remainingFobLegs(PATH, 30)).toEqual([
      { distanceNm: 30, grade: "LSMGO" },
      { distanceNm: 40, grade: "VLSFO" },
    ]);
  });
  it("exactly at the end of leg 1, only leg 2 remains", () => {
    expect(remainingFobLegs(PATH, 60)).toEqual([{ distanceNm: 40, grade: "VLSFO" }]);
  });
  it("after arrival nothing remains", () => {
    expect(remainingFobLegs(PATH, 100)).toEqual([]);
  });
});

describe("fuelBetween", () => {
  it("2 h in port at the ECA origin then 80 nm: LSMGO 0.2 + 6.6, VLSFO 2.2", () => {
    const f = fuelBetween(PATH, at(-2), at(8));
    expect(f.LSMGO).toBeCloseTo(6.8, 9);
    expect(f.VLSFO).toBeCloseTo(2.2, 9);
    expect(f.HSFO).toBe(0);
  });
  it("last 10 nm then 3 h at the non-ECA destination: VLSFO 1.1 + 0.3", () => {
    const f = fuelBetween(PATH, at(9), at(13));
    expect(f.LSMGO).toBe(0);
    expect(f.VLSFO).toBeCloseTo(1.4, 9);
    expect(f.HSFO).toBe(0);
  });
  it("an empty interval burns nothing", () => {
    expect(fuelBetween(PATH, at(4), at(4))).toEqual({ LSMGO: 0, VLSFO: 0, HSFO: 0 });
  });
});

describe("tankFreeMt", () => {
  it("is capacity minus ROB (500 - 120.5 = 379.5)", () => {
    expect(tankFreeMt(500, 120.5)).toBe(379.5);
  });
  it("is 0 for a full tank", () => {
    expect(tankFreeMt(500, 500)).toBe(0);
  });
  it("rejects ROB above capacity, negatives and NaN", () => {
    expect(() => tankFreeMt(500, 500.1)).toThrow(RangeError);
    expect(() => tankFreeMt(-1, 0)).toThrow(RangeError);
    expect(() => tankFreeMt(500, -1)).toThrow(RangeError);
    expect(() => tankFreeMt(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe("hoursBetween", () => {
  it("is (b - a) in hours, signed", () => {
    expect(hoursBetween(T0, at(1.5))).toBe(1.5);
    expect(hoursBetween(at(1.5), T0)).toBe(-1.5);
  });
  it("rejects an invalid date", () => {
    expect(() => hoursBetween(new Date(Number.NaN), T0)).toThrow(RangeError);
    expect(() => hoursBetween(T0, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("voyage maths is deterministic", () => {
  it("same inputs give identical outputs and inputs are not mutated", () => {
    const before = JSON.stringify(PATH);
    const run = () =>
      JSON.stringify({
        sailed: sailedNmAt(PATH, at(7.25)),
        pos: positionAt(PATH, 72.5),
        rest: remainingFobLegs(PATH, 72.5),
        fuel: fuelBetween(PATH, at(-1), at(11)),
        cum: cumulativeNm(PATH),
      });
    expect(run()).toBe(run());
    expect(JSON.stringify(PATH)).toBe(before);
  });
});

describe("remainingRoutePoints", () => {
  // Consistent fixture: leg distances equal their polyline lengths. A(0,0) -> M(1,0) -> B(1,1) -> C(2,1).
  const w = (lat: number, lon: number) => ({ lat, lon });
  const len = (pts: { lat: number; lon: number }[]) => polylineNm(pts);
  const wp1 = [w(0, 0), w(0.5, 0), w(1, 0)];
  const wp2 = [w(1, 0), w(1, 1), w(2, 1)];
  const path: VoyagePath = {
    voyage: { plannedSpeedKn: 12 } as Voyage,
    legs: [
      { ...LEG_AB, distanceNm: len(wp1), waypoints: wp1 },
      { ...LEG_BC, distanceNm: len(wp2), waypoints: wp2 },
    ],
    origin: A,
    destination: { ...C, lat: 2, lon: 1 },
    curve: CURVE,
    departAt: T0,
  };
  const total = len(wp1) + len(wp2);

  it.each([0, 10, 45, len(wp1), len(wp1) + 20, total - 1, total])(
    "at %f nm starts at positionAt and the rest has length total - sailed",
    (sailed) => {
      const pts = remainingRoutePoints(path, sailed);
      expect(pts[0]).toEqual(positionAt(path, sailed));
      expect(pts[pts.length - 1]).toEqual({ lat: 2, lon: 1 });
      expect(Math.abs(polylineNm(pts) - (total - sailed))).toBeLessThan(0.01);
    },
  );
  it("mid first leg keeps later waypoints once, with no duplicate at the leg join", () => {
    const pts = remainingRoutePoints(path, 10);
    expect(pts).toHaveLength(5); // position, (0.5,0), (1,0), (1,1), (2,1)
  });
});
