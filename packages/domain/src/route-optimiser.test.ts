import {
  type ConsumptionCurve,
  type LatLon,
  type RouteCandidate,
  type RouteOptionResult,
  type RouteSpeedInput,
  RouteSpeedResult,
  type WeatherGrid,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { evaluateRoute, optimiseRouteSpeed, routeHazardIds } from "./route-optimiser.js";

const p = (lat: number, lon: number): LatLon => ({ lat, lon });
const HOUR_MS = 3_600_000;
const START = "2026-11-15T00:00:00.000Z";
const at = (hours: number): string =>
  new Date(Date.parse(START) + Math.round(hours * HOUR_MS)).toISOString();

/** Bulk carrier reference curve: 30 mt/day at 13 kn, 2.5 mt/day aux, 9-14.5 kn. */
const BULK: ConsumptionCurve = {
  refSpeedKn: 13,
  refMtPerDay: 30,
  auxMtPerDay: 2.5,
  minSpeedKn: 9,
  maxSpeedKn: 14.5,
};
/** 9, 9.5, …, 14.5: twelve speeds. */
const BULK_GRID = Array.from({ length: 12 }, (_, i) => 9 + i * 0.5);

const DIRECT_20: RouteCandidate = { id: "A", label: "Direct", points: [p(0, 0), p(0, 20)] };
const DIRECT_10: RouteCandidate = { id: "A", label: "Direct", points: [p(0, 0), p(0, 10)] };

function makeInput(over: Partial<RouteSpeedInput> = {}): RouteSpeedInput {
  return {
    startAt: START,
    candidates: [DIRECT_20],
    baseline: { candidateId: "A", speedKn: 12 },
    curve: BULK,
    speedStepKn: 0.5,
    stepNm: 20,
    arriveBy: null,
    notBefore: null,
    dailyCostUsd: 16_000,
    fuelPriceUsdPerMt: { LSMGO: 820, VLSFO: 610, HSFO: 480 },
    etsCoverage: 0.5,
    market: { euaPriceEur: 75, eurUsd: 1.08, year: 2026 },
    weather: null,
    hazards: [],
    fuel: null,
    stops: [],
    ...over,
  };
}

interface PointWeather {
  lat: number;
  lon: number;
  waveHeightM?: number;
  waveDirDeg?: number;
  windSpeedKn?: number;
  windDirDeg?: number;
  currentSpeedKn?: number;
  currentDirDeg?: number;
}

/** A grid whose every point holds the same values at every step. */
function steadyGrid(points: PointWeather[], steps: number, stepHours: number): WeatherGrid {
  const series = (v: number | undefined) => Array.from({ length: steps }, () => v ?? 0);
  return {
    startAt: START,
    stepHours,
    points: points.map((q) => ({
      lat: q.lat,
      lon: q.lon,
      waveHeightM: series(q.waveHeightM),
      waveDirDeg: series(q.waveDirDeg),
      windSpeedKn: series(q.windSpeedKn),
      windDirDeg: series(q.windDirDeg),
      currentSpeedKn: series(q.currentSpeedKn),
      currentDirDeg: series(q.currentDirDeg),
    })),
  };
}

const relClose = (actual: number, expected: number, rel = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel);

function allFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === "object") return Object.values(v).every(allFinite);
  return true;
}

const bestOf = (r: RouteSpeedResult): RouteOptionResult => {
  const best = r.options.find((o) => o.candidateId === r.bestCandidateId);
  if (!best) throw new Error("best option missing");
  return best;
};

describe("evaluateRoute", () => {
  it("hand-computed: (0,0) → (0,20), calm, bulk curve at 12 kn", () => {
    /*
     * distance = 3440.065 × 20 × π/180 = 1200.809215 nm (on the equator, outside both ECA boxes → VLSFO)
     * hours = 1200.809215 / 12 = 100.067435 h
     * daily = 30 × (12/13)³ + 2.5 = 23.595812 + 2.5 = 26.095812 mt/day
     * fuel = 26.095812 × 100.067435 / 24 = 108.805875 mt VLSFO
     * fuel cost = 108.805875 × 610 = 66 371.58 USD
     * CO₂ = 108.805875 × 3.114 = 338.821496 t
     * ETS = 338.821496 × 0.5 coverage × 1 (2026 phase-in) × 75 EUR × 1.08 = 13 722.27 USD
     * time = 16 000 × 100.067435 / 24 = 66 711.62 USD
     * total before FuelEU = 66 371.58 + 13 722.27 + 66 711.62 = 146 805.48 USD
     * (+ FuelEU 3 655.1, the next test)
     */
    const r = evaluateRoute(makeInput(), DIRECT_20, 12);
    const distance = (3440.065 * 20 * Math.PI) / 180;
    const hours = distance / 12;
    const fuel = ((30 * (12 / 13) ** 3 + 2.5) * hours) / 24;
    const co2 = fuel * 3.114;
    const ets = co2 * 0.5 * 1 * 75 * 1.08;
    relClose(r.distanceNm, distance);
    relClose(r.hours, hours);
    relClose(r.calmHours, hours);
    expect(r.weatherDelayHours).toBe(0);
    expect(r.fuelMt.LSMGO).toBe(0);
    expect(r.fuelMt.HSFO).toBe(0);
    relClose(r.fuelMt.VLSFO, fuel);
    relClose(r.totalFuelMt, fuel);
    relClose(r.co2T, co2);
    relClose(r.fuelCostUsd, fuel * 610);
    relClose(r.etsCostUsd, ets);
    relClose(r.timeCostUsd, (16_000 * hours) / 24);
    relClose(r.totalCostUsd - r.fuelEuCostUsd, fuel * 610 + ets + (16_000 * hours) / 24);
    relClose(r.totalCostUsd - r.fuelEuCostUsd, 146_805.477527);
    expect(r.eta).toBe(at(hours));
    expect(r.candidateId).toBe("A");
    expect(r.speedKn).toBe(12);
    expect(r.maxWaveHeightM).toBe(0);
    expect(r.weatherCoveragePct).toBe(0);
    expect(r.feasible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("hand-computed FuelEU exposure: 108.805875 mt VLSFO (HFO row) at coverage 0.5 in 2026", () => {
    /*
     * HFO WtW I = 13.5 + 3.16889 / 0.0405 = 91.744198; 2026 limit T = 89.3368
     * per mt in scope: (I − T) × 40 500 g / (I × 41 000) × 2 400 = 62.209 EUR
     * 108.805875 × 0.5 × 62.209 = 3 384.36 EUR × 1.08 = 3 655.1 USD
     * total = 146 805.48 (fuel + ETS + time, Phase 5) + 3 655.1 = 150 460.6 USD
     */
    const r = evaluateRoute(makeInput(), DIRECT_20, 12);
    const fuel = ((30 * (12 / 13) ** 3 + 2.5) * ((3440.065 * 20 * Math.PI) / 180 / 12)) / 24;
    const i = 13.5 + (3.114 + 0.00005 * 25 + 0.00018 * 298) / 0.0405;
    const perMtEur = (((i - 91.16 * 0.98) * 40_500) / (i * 41_000)) * 2_400;
    relClose(r.fuelEuCostUsd, fuel * 0.5 * perMtEur * 1.08);
    expect(r.fuelEuCostUsd).toBeCloseTo(3655.1, 0);
    relClose(r.totalCostUsd - r.fuelEuCostUsd, 146_805.477527);
    relClose(r.totalCostUsd, r.fuelCostUsd + r.etsCostUsd + r.fuelEuCostUsd + r.timeCostUsd);
  });

  it("no FuelEU exposure at ETS coverage 0", () => {
    expect(evaluateRoute(makeInput({ etsCoverage: 0 }), DIRECT_20, 12).fuelEuCostUsd).toBe(0);
  });

  it("a load condition lowers the burn by the load factor on the main engine", () => {
    // factor 0.64: daily 30 × (12/13)³ × 0.64 + 2.5 vs 30 × (12/13)³ + 2.5
    const load = { displacementMt: 36_864, refDisplacementMt: 72_000 };
    const r = evaluateRoute(makeInput({ curve: { ...BULK, load } }), DIRECT_20, 12);
    const hours = (3440.065 * 20 * Math.PI) / 180 / 12;
    relClose(r.totalFuelMt, ((30 * (12 / 13) ** 3 * 0.64 + 2.5) * hours) / 24);
  });

  it("burns LSMGO for the part of the route inside a sulphur ECA", () => {
    // (36, -10) → (36, 0): the Mediterranean ECA box starts at 5.6° W.
    const route: RouteCandidate = { id: "A", label: "x", points: [p(36, -10), p(36, 0)] };
    const r = evaluateRoute(makeInput(), route, 12);
    expect(r.fuelMt.LSMGO).toBeGreaterThan(0);
    expect(r.fuelMt.VLSFO).toBeGreaterThan(0);
    // 5.6 of the 10 degrees are inside: LSMGO share within one 20 nm sub-step of 56 %.
    expect(r.fuelMt.LSMGO / r.totalFuelMt).toBeCloseTo(0.56, 1);
  });

  it("skips zero-length segments: duplicated points change nothing", () => {
    const dup: RouteCandidate = {
      id: "A",
      label: "Direct",
      points: [p(0, 0), p(0, 0), p(0, 10), p(0, 10), p(0, 20), p(0, 20)],
    };
    const clean: RouteCandidate = {
      id: "A",
      label: "Direct",
      points: [p(0, 0), p(0, 10), p(0, 20)],
    };
    // 2 m points at 0.4° E, 1.4° E, …; a 7 m point at 0.2° W is nearest to (0,0) itself but to no
    // midpoint (the first is at 10/31/2 = 0.16° E: 0.24° from 0.4° E, 0.36° from 0.2° W). A
    // zero-length "sub-step" at the repeated (0,0) would sample it and report 7 m.
    const weather = steadyGrid(
      [
        { lat: 0, lon: -0.2, waveHeightM: 7, waveDirDeg: 90 },
        ...Array.from({ length: 20 }, (_, i) => ({
          lat: 0,
          lon: 0.4 + i,
          waveHeightM: 2,
          waveDirDeg: 90,
        })),
      ],
      60,
      3,
    );
    const input = makeInput({ weather });
    const r = evaluateRoute(input, dup, 12);
    expect(r).toEqual(evaluateRoute(input, clean, 12));
    expect(r.maxWaveHeightM).toBe(2);
    expect(allFinite(r)).toBe(true);
  });

  it("a zero-length route (the vessel is at the destination) is all zeros, never NaN", () => {
    const here: RouteCandidate = { id: "A", label: "Arrived", points: [p(0, 5), p(0, 5)] };
    const weather = steadyGrid([{ lat: 0, lon: 5, waveHeightM: 3 }], 10, 3);
    const r = evaluateRoute(makeInput({ weather }), here, 12);
    expect(allFinite(r)).toBe(true);
    expect(r.distanceNm).toBe(0);
    expect(r.hours).toBe(0);
    expect(r.totalFuelMt).toBe(0);
    expect(r.totalCostUsd).toBe(0);
    expect(r.weatherCoveragePct).toBe(0);
    expect(r.eta).toBe(START);
  });

  it("charges vessel time up to notBefore: arriving before the berth window saves nothing", () => {
    // 1200.81 nm at 12 kn = 100.07 h; the window opens at 120 h → time cost 16 000 × 120 / 24 = 80 000.
    const r = evaluateRoute(makeInput({ notBefore: at(120) }), DIRECT_20, 12);
    relClose(r.timeCostUsd, 80_000);
    const late = evaluateRoute(makeInput({ notBefore: at(90) }), DIRECT_20, 12);
    relClose(late.timeCostUsd, (16_000 * late.hours) / 24);
  });

  it("is infeasible when the ETA is after arriveBy", () => {
    const r = evaluateRoute(makeInput({ arriveBy: at(100) }), DIRECT_20, 12);
    expect(r.feasible).toBe(false);
    expect(r.reasons).toEqual(["misses_arrive_by"]);
    expect(r.meetsArriveBy).toBe(false);
    expect(evaluateRoute(makeInput({ arriveBy: at(101) }), DIRECT_20, 12).meetsArriveBy).toBe(true);
    expect(evaluateRoute(makeInput({ arriveBy: null }), DIRECT_20, 12).meetsArriveBy).toBe(true);
    expect(evaluateRoute(makeInput({ arriveBy: at(101) }), DIRECT_20, 12).feasible).toBe(true);
  });

  it("following current: 1 kn along the track gives fewer hours and less fuel than calm", () => {
    // Eastbound on the equator with a 1 kn current setting east: SOG 13 kn → 600.405 / 13 = 46.185 h
    // instead of 600.405 / 12 = 50.034 h.
    const weather = steadyGrid(
      Array.from({ length: 11 }, (_, i) => ({
        lat: 0,
        lon: i,
        currentSpeedKn: 1,
        currentDirDeg: 90,
      })),
      40,
      3,
    );
    const calm = evaluateRoute(makeInput(), DIRECT_10, 12);
    const helped = evaluateRoute(makeInput({ weather }), DIRECT_10, 12);
    relClose(helped.hours, calm.distanceNm / 13);
    expect(helped.hours).toBeLessThan(calm.hours);
    expect(helped.totalFuelMt).toBeLessThan(calm.totalFuelMt);
    expect(helped.weatherDelayHours).toBeLessThan(0);
    expect(helped.weatherCoveragePct).toBe(100);
  });
});

/*
 * Synthetic storm. Direct: (0,0) → (0,16.65) = 999.67 nm along the equator.
 * Detour: (0,0) → (2.93, 8.325) → (0,16.65) = 1059.37 nm.
 * Grid points every 0.5° along both routes; the direct route's middle third (5.5° E to 11° E)
 * carries head seas (from 090) of `stormM`; everything else is calm. The detour stays ≥ 116 nm
 * from the storm points, so its own calm points are always nearer.
 * 6 m: loss 1.0 × 6² = 36 % → about 333 nm at 0.64 × speed ≈ 1 187 calm-equivalent nm > 1 059 → detour.
 * 2 m: loss 4 % → about 1 013 calm-equivalent nm < 1 059 → direct.
 */
function stormInput(stormM: number): RouteSpeedInput {
  const direct: RouteCandidate = { id: "A", label: "Direct", points: [p(0, 0), p(0, 16.65)] };
  const detour: RouteCandidate = {
    id: "B",
    label: "Detour",
    points: [p(0, 0), p(2.93, 8.325), p(0, 16.65)],
  };
  const points: PointWeather[] = [];
  for (let lon = 0; lon <= 16.5; lon += 0.5) {
    const storm = lon >= 5.5 && lon <= 11;
    points.push({ lat: 0, lon, waveHeightM: storm ? stormM : 0, waveDirDeg: 90 });
  }
  for (let lon = 0.5; lon <= 16; lon += 0.5) {
    const lat = lon <= 8.325 ? (2.93 * lon) / 8.325 : (2.93 * (16.65 - lon)) / 8.325;
    points.push({ lat, lon });
  }
  return makeInput({
    candidates: [direct, detour],
    weather: steadyGrid(points, 40, 6),
  });
}

/** Every option on the grid, from separate evaluateRoute calls. */
function gridOptions(input: RouteSpeedInput, speeds: number[]): RouteOptionResult[] {
  return input.candidates.flatMap((c) => speeds.map((s) => evaluateRoute(input, c, s)));
}

describe("hazard zones", () => {
  // 1 deg of longitude on the equator = 60.0405 nm. DIRECT_20 is (0,0) -> (0,20): 1200.8 nm cut
  // into ceil(1200.8 / 20) = 61 sub-steps; sub-step 30 has its midpoint at lon 30.5/61 x 20 = 10.
  const onTrack = { id: "h-on", center: p(0, 10), radiusNm: 5 };
  // 1 deg of latitude = 60.04 nm away from the track, with a 30 nm radius: no sub-step midpoint inside.
  const offTrack = { id: "h-off", center: p(1, 10), radiusNm: 30 };

  it("lists the zones a sub-step midpoint falls inside, sorted, and no others", () => {
    const input = makeInput({ hazards: [onTrack, offTrack, { ...onTrack, id: "h-a" }] });
    const r = evaluateRoute(input, DIRECT_20, 12);
    expect(r.hazardIds).toEqual(["h-a", "h-on"]);
    expect(routeHazardIds(DIRECT_20.points, input.stepNm, input.hazards)).toEqual(["h-a", "h-on"]);
  });

  it("a route through a zone is infeasible with crosses_hazard", () => {
    const r = evaluateRoute(makeInput({ hazards: [onTrack] }), DIRECT_20, 12);
    expect(r.feasible).toBe(false);
    expect(r.reasons).toEqual(["crosses_hazard"]);
    expect(r.crossesHazard).toBe(true);
  });

  it("a route that misses the zone stays feasible with no hazard ids", () => {
    const r = evaluateRoute(makeInput({ hazards: [offTrack] }), DIRECT_20, 12);
    expect(r.hazardIds).toEqual([]);
    expect(r.crossesHazard).toBe(false);
    expect(r.feasible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("lists both reasons when the route also misses arriveBy", () => {
    const r = evaluateRoute(makeInput({ hazards: [onTrack], arriveBy: at(1) }), DIRECT_20, 12);
    expect(r.reasons).toEqual(["misses_arrive_by", "crosses_hazard"]);
  });

  it("hazards do not change the numbers, only the verdict", () => {
    const clear = evaluateRoute(makeInput(), DIRECT_20, 12);
    const crossing = evaluateRoute(makeInput({ hazards: [onTrack] }), DIRECT_20, 12);
    expect({
      ...crossing,
      feasible: true,
      reasons: [],
      hazardIds: [],
      crossesHazard: false,
    }).toEqual(clear);
  });

  it("the best option is a feasible one that avoids the hazard, even when dearer", () => {
    const detour: RouteCandidate = {
      id: "B",
      label: "Detour",
      points: [p(0, 0), p(3, 10), p(0, 20)],
    };
    const input = makeInput({ candidates: [DIRECT_20, detour], hazards: [onTrack] });
    const free = optimiseRouteSpeed({ ...input, hazards: [] });
    expect(free.bestCandidateId).toBe("A");
    const r = optimiseRouteSpeed(input);
    expect(r.options[0]?.feasible).toBe(false);
    expect(r.options[0]?.hazardIds).toEqual(["h-on"]);
    expect(r.options[1]?.feasible).toBe(true);
    expect(r.bestCandidateId).toBe("B");
  });

  it("a hazard does not change a candidate's chosen speed or cost, only its verdict", () => {
    const base = makeInput({ arriveBy: at(110) });
    const clear = optimiseRouteSpeed(base);
    const crossing = optimiseRouteSpeed({ ...base, hazards: [onTrack] });
    const a = clear.options[0] as RouteOptionResult;
    const b = crossing.options[0] as RouteOptionResult;
    expect(a.speedKn).toBeLessThan(BULK.maxSpeedKn);
    expect({
      ...b,
      feasible: a.feasible,
      reasons: a.reasons,
      hazardIds: a.hazardIds,
      crossesHazard: a.crossesHazard,
    }).toEqual(a);
    expect(b.feasible).toBe(false);
    expect(b.reasons).toEqual(["crosses_hazard"]);
    expect(b.hazardIds).toEqual(["h-on"]);
  });

  it("is deterministic with hazards", () => {
    const input = makeInput({ hazards: [onTrack] });
    expect(JSON.stringify(optimiseRouteSpeed(input))).toBe(
      JSON.stringify(optimiseRouteSpeed(structuredClone(input))),
    );
  });
});

describe("optimiseRouteSpeed", () => {
  it("never searches below the curve's minimum speed (9.124 kn)", () => {
    const curve: ConsumptionCurve = { ...BULK, minSpeedKn: 9.124 };
    const r = optimiseRouteSpeed(
      makeInput({ curve, baseline: { candidateId: "A", speedKn: 12 }, dailyCostUsd: 0 }),
    );
    for (const o of r.options) expect(o.speedKn).toBeGreaterThanOrEqual(9.124);
    // Time is free, so the cheapest speed is the slowest on the grid: 9.124, then +0.5 steps.
    expect(r.options[0]?.speedKn).toBe(9.124);
  });

  it("synthetic storm: 6 m head seas on the direct route make the detour best", () => {
    const input = stormInput(6);
    const r = optimiseRouteSpeed(input);
    expect(r.bestCandidateId).toBe("B");
    const all = gridOptions(input, BULK_GRID);
    const argmin = all.reduce((a, b) => (b.totalCostUsd < a.totalCostUsd ? b : a));
    expect(r.bestCandidateId).toBe(argmin.candidateId);
    expect(bestOf(r)).toEqual(argmin);
    expect(r.options[0]?.maxWaveHeightM).toBe(6);
    expect(r.options[0]?.weatherDelayHours).toBeGreaterThan(10);
  });

  it("synthetic storm: with 2 m seas the direct route stays best", () => {
    const input = stormInput(2);
    const r = optimiseRouteSpeed(input);
    expect(r.bestCandidateId).toBe("A");
    const all = gridOptions(input, BULK_GRID);
    const argmin = all.reduce((a, b) => (b.totalCostUsd < a.totalCostUsd ? b : a));
    expect(r.bestCandidateId).toBe(argmin.candidateId);
    expect(bestOf(r)).toEqual(argmin);
  });

  it("returns one option per candidate in candidate order, the baseline, and the savings", () => {
    const input = stormInput(6);
    const r = optimiseRouteSpeed(input);
    expect(r.options.map((o) => o.candidateId)).toEqual(["A", "B"]);
    expect(r.baseline).toEqual(evaluateRoute(input, input.candidates[0] as RouteCandidate, 12));
    const best = bestOf(r);
    expect(r.savingVsBaselineUsd).toBe(r.baseline.totalCostUsd - best.totalCostUsd);
    expect(r.fuelSavingVsBaselineMt).toBe(r.baseline.totalFuelMt - best.totalFuelMt);
    expect(() => RouteSpeedResult.parse(r)).not.toThrow();
  });

  it("is deterministic: identical JSON for two calls and for a structured clone", () => {
    const input = stormInput(6);
    const a = JSON.stringify(optimiseRouteSpeed(input));
    expect(JSON.stringify(optimiseRouteSpeed(input))).toBe(a);
    expect(JSON.stringify(optimiseRouteSpeed(structuredClone(input)))).toBe(a);
  });

  it("an impossible arriveBy makes every option infeasible and the earliest ETA best", () => {
    const detour: RouteCandidate = {
      id: "B",
      label: "Detour",
      points: [p(0, 0), p(1, 5), p(0, 10)],
    };
    const input = makeInput({ candidates: [DIRECT_10, detour], arriveBy: at(1) });
    const r = optimiseRouteSpeed(input);
    for (const o of [...r.options, r.baseline]) {
      expect(o.feasible).toBe(false);
      expect(o.reasons).toEqual(["misses_arrive_by"]);
    }
    const earliest = gridOptions(input, BULK_GRID).reduce((a, b) =>
      Date.parse(b.eta) < Date.parse(a.eta) ? b : a,
    );
    expect(bestOf(r)).toEqual(earliest);
    expect(r.bestCandidateId).toBe("A");
    expect(bestOf(r).speedKn).toBe(14.5);
  });

  it("a candidate that cannot make arriveBy shows its earliest arrival; a feasible one wins", () => {
    // Direct 600.40 nm: 14.5 kn → 41.41 h. Long way round (0,0)→(3,5)→(0,10) ≈ 2 × 349.9 = 699.7 nm: ≥ 48.3 h.
    const long: RouteCandidate = { id: "B", label: "Long", points: [p(0, 0), p(3, 5), p(0, 10)] };
    const input = makeInput({ candidates: [DIRECT_10, long], arriveBy: at(44) });
    const r = optimiseRouteSpeed(input);
    expect(r.bestCandidateId).toBe("A");
    expect(r.options[0]?.feasible).toBe(true);
    expect(r.options[1]?.feasible).toBe(false);
    expect(r.options[1]?.speedKn).toBe(14.5);
  });

  it("adds an off-grid baseline speed to the baseline candidate's grid", () => {
    // 600.405 nm: 12.3 kn → 48.813 h, 12.0 kn → 50.034 h. With arriveBy at 48.83 h the slowest
    // feasible speed is the baseline's 12.3, cheaper than 12.5 (cost per nm rises above ~9.6 kn).
    const input = makeInput({
      candidates: [DIRECT_10],
      baseline: { candidateId: "A", speedKn: 12.3 },
      arriveBy: at(48.83),
    });
    const r = optimiseRouteSpeed(input);
    expect(bestOf(r).speedKn).toBe(12.3);
    expect(r.savingVsBaselineUsd).toBe(0);
  });

  it("a tie goes to the earlier candidate", () => {
    const twin: RouteCandidate = { ...DIRECT_10, id: "B", label: "Twin" };
    const r = optimiseRouteSpeed(makeInput({ candidates: [DIRECT_10, twin] }));
    expect(r.bestCandidateId).toBe("A");
  });

  it("just in time: with notBefore after the fastest arrival it slows down to meet the window", () => {
    /*
     * 600.405 nm; at $200 000/day vessel time the cheapest speed with no window is the fastest
     * (14.5 kn, 41.41 h). The window opens at 55 h: every arrival before it pays 55 h of time, so
     * the slowest speed still arriving by 55 h wins: 11 kn (54.58 h); 10.5 kn arrives at 57.18 h
     * and pays 2.18 h × 8 333 = 18 200 more time for about 3.4 mt (≈ 2 500 USD) less fuel.
     */
    const fast = optimiseRouteSpeed(makeInput({ candidates: [DIRECT_10], dailyCostUsd: 200_000 }));
    expect(bestOf(fast).speedKn).toBe(14.5);
    const notBefore = at(55);
    const input = makeInput({ candidates: [DIRECT_10], dailyCostUsd: 200_000, notBefore });
    const best = bestOf(optimiseRouteSpeed(input));
    expect(best.speedKn).toBe(11);
    // General form: at the minimum speed, or one grid step slower would arrive after notBefore.
    const slower = evaluateRoute(input, DIRECT_10, best.speedKn - 0.5);
    expect(best.speedKn === BULK.minSpeedKn || Date.parse(slower.eta) > Date.parse(notBefore)).toBe(
      true,
    );
  });

  it("a passage beyond the forecast reports partial coverage", () => {
    // 48 h of forecast (16 × 3 h) on a 1200.8 nm passage: 82.8 h at 14.5 kn, 120.1 h at 10 kn.
    const weather = steadyGrid(
      Array.from({ length: 11 }, (_, i) => ({
        lat: 0,
        lon: 2 * i,
        waveHeightM: 1,
        waveDirDeg: 270,
      })),
      16,
      3,
    );
    const r = optimiseRouteSpeed(
      makeInput({ weather, baseline: { candidateId: "A", speedKn: 10 } }),
    );
    expect(r.baseline.hours).toBeGreaterThan(120);
    for (const o of [...r.options, r.baseline]) {
      expect(o.weatherCoveragePct).toBeGreaterThan(0);
      expect(o.weatherCoveragePct).toBeLessThan(100);
    }
    expect(allFinite(r)).toBe(true);
    const none = optimiseRouteSpeed(makeInput({ weather: null }));
    for (const o of [...none.options, none.baseline]) {
      expect(o.weatherCoveragePct).toBe(0);
      expect(o.weatherDelayHours).toBe(0);
    }
  });

  it("parses its input and rejects an unknown baseline candidate", () => {
    expect(() => optimiseRouteSpeed(makeInput({ speedStepKn: 0 }))).toThrow();
    expect(() =>
      optimiseRouteSpeed(makeInput({ baseline: { candidateId: "Z", speedKn: 12 } })),
    ).toThrow(RangeError);
  });
});

describe("never worse than the baseline (60 seeded inputs)", () => {
  /** Numerical Recipes LCG; the test's only source of variety. */
  function lcg(seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    return {
      next,
      range: (lo: number, hi: number) => lo + (hi - lo) * next(),
      int: (lo: number, hi: number) => lo + Math.floor((hi - lo + 1) * next()),
      pick: <T>(xs: readonly T[]): T => xs[Math.floor(xs.length * next())] as T,
    };
  }
  const round2 = (x: number) => Math.round(x * 100) / 100;

  function randomInput(seed: number, loaded = false): RouteSpeedInput {
    const r = lcg(seed);
    // Western Mediterranean and Biscay: some routes cross the ECA boundary.
    const start = p(round2(r.range(35, 43)), round2(r.range(-12, 4)));
    const end = p(round2(r.range(35, 43)), round2(r.range(-12, 4)));
    if (Math.abs(start.lat - end.lat) + Math.abs(start.lon - end.lon) < 1) end.lon += 2;
    const candidates: RouteCandidate[] = Array.from({ length: r.int(1, 3) }, (_, i) => {
      const viaCount = r.int(0, 2);
      const via = Array.from({ length: viaCount }, (_, k) => {
        const t = (k + 1) / (viaCount + 1);
        return p(
          round2(start.lat + (end.lat - start.lat) * t + r.range(-1, 1)),
          round2(start.lon + (end.lon - start.lon) * t + r.range(-1, 1)),
        );
      });
      return { id: String.fromCharCode(65 + i), label: `R${i}`, points: [start, ...via, end] };
    });
    const minSpeedKn = r.pick([8, 9, 10]);
    const curve: ConsumptionCurve = {
      refSpeedKn: r.pick([12, 13, 14]),
      refMtPerDay: round2(r.range(18, 45)),
      auxMtPerDay: round2(r.range(1.5, 4.5)),
      minSpeedKn,
      maxSpeedKn: minSpeedKn + r.pick([4, 5, 6]),
    };
    const speedStepKn = r.pick([0.5, 1]);
    const baselineSpeed = round2(r.range(curve.minSpeedKn, curve.maxSpeedKn));
    const quickest = 500 / curve.maxSpeedKn; // a rough passage time, hours
    const weather: WeatherGrid | null =
      r.next() < 0.3
        ? null
        : {
            startAt: START,
            stepHours: 3,
            points: Array.from({ length: 60 }, (_, k) => {
              const steps = 30;
              const s = (lo: number, hi: number) =>
                Array.from({ length: steps }, () => round2(r.range(lo, hi)));
              return {
                lat: 34 + 2 * Math.floor(k / 10),
                lon: -12 + 2 * (k % 10),
                waveHeightM: s(0, 7),
                waveDirDeg: s(0, 360),
                windSpeedKn: s(0, 40),
                windDirDeg: s(0, 360),
                currentSpeedKn: s(0, 2),
                currentDirDeg: s(0, 360),
              };
            }),
          };
    const input: RouteSpeedInput = {
      startAt: START,
      candidates,
      baseline: { candidateId: r.pick(candidates).id, speedKn: baselineSpeed },
      curve,
      speedStepKn,
      stepNm: r.pick([10, 20, 40]),
      arriveBy: r.next() < 0.35 ? null : at(r.range(0.4, 1.6) * quickest),
      notBefore: r.next() < 0.5 ? null : at(r.range(0.3, 1.5) * quickest),
      dailyCostUsd: Math.round(r.range(5_000, 60_000)),
      fuelPriceUsdPerMt: {
        LSMGO: round2(r.range(650, 950)),
        VLSFO: round2(r.range(480, 700)),
        HSFO: round2(r.range(380, 520)),
      },
      etsCoverage: r.pick([0, 0.5, 1] as const),
      market: {
        euaPriceEur: round2(r.range(50, 100)),
        eurUsd: 1.08,
        year: r.pick([2024, 2025, 2026]),
      },
      weather,
      hazards: [],
      fuel: null,
      stops: [],
    };
    if (!loaded) return input;
    // Drawn after everything else, so the unloaded inputs are the same as without this branch.
    // Ballast to full load: displacement is 0.45 to 1 of the reference.
    const refDisplacementMt = Math.round(r.range(40_000, 90_000));
    const load = {
      displacementMt: Math.round(refDisplacementMt * r.range(0.45, 1)),
      refDisplacementMt,
    };
    return { ...input, curve: { ...curve, load } };
  }

  /** The grid the optimiser searches, rebuilt here independently. */
  function speedsOf(input: RouteSpeedInput, candidateId: string): number[] {
    const out: number[] = [];
    for (let i = 0; ; i++) {
      const s = round2(input.curve.minSpeedKn + i * input.speedStepKn);
      if (s > input.curve.maxSpeedKn) break;
      out.push(s);
    }
    if (candidateId === input.baseline.candidateId && !out.includes(input.baseline.speedKn)) {
      out.push(input.baseline.speedKn);
    }
    return out;
  }

  it("best ≤ baseline whenever the baseline is feasible; best feasible whenever any option is", () => {
    neverWorse(false);
  });

  it("never worse with a load on the curve", () => {
    neverWorse(true);
  });

  function neverWorse(loaded: boolean): void {
    let feasibleBaselines = 0;
    let infeasibleBaselines = 0;
    let rescued = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const input = randomInput(seed * 7919, loaded);
      const r = optimiseRouteSpeed(input);
      const best = bestOf(r);
      if (r.baseline.feasible) {
        feasibleBaselines++;
        expect(best.totalCostUsd, `seed ${seed}`).toBeLessThanOrEqual(r.baseline.totalCostUsd);
        expect(r.savingVsBaselineUsd, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      } else {
        infeasibleBaselines++;
      }
      const anyFeasible = input.candidates.some((c) =>
        speedsOf(input, c.id).some((s) => evaluateRoute(input, c, s).feasible),
      );
      if (anyFeasible) {
        expect(best.feasible, `seed ${seed}`).toBe(true);
        if (!r.baseline.feasible) rescued++;
      }
    }
    // The sample exercises both branches.
    expect(feasibleBaselines).toBeGreaterThan(10);
    expect(infeasibleBaselines).toBeGreaterThan(5);
    expect(rescued).toBeGreaterThan(0);
    if (loaded) {
      // The load reaches the result: the main-engine burn reads curve.load (consumption.ts, via
      // loadFactor), so a loaded baseline's cost differs from the same input unloaded.
      const differing = [1, 2, 3, 4, 5].filter((seed) => {
        const withLoad = optimiseRouteSpeed(randomInput(seed * 7919, true));
        const without = optimiseRouteSpeed(randomInput(seed * 7919, false));
        return withLoad.baseline.totalCostUsd !== without.baseline.totalCostUsd;
      });
      expect(differing.length).toBeGreaterThan(0);
    }
  }
});
