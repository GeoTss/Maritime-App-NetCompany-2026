/**
 * Weather-aware route and speed optimiser: one speed setting per route (ruling P2), searched
 * exhaustively over the vessel's speed range for every candidate route. Pure and deterministic:
 * the clock (`startAt`) and the weather snapshot come in with the input.
 */
import {
  FUEL_GRADES,
  type FuelGrade,
  type GradeAmounts,
  type LatLon,
  type RouteCandidate,
  type RouteOptionResult,
  RouteSpeedInput,
  type RouteSpeedResult,
} from "@pharos/shared";
import { dailyConsumptionMt } from "./consumption.js";
import { gradeAt } from "./eca.js";
import { co2Tonnes, etsCost } from "./emissions.js";
import { bearingDeg, greatCircleNm } from "./geo.js";
import { effectiveSpeedKn, sampleWeather } from "./weather-effect.js";

const HOUR_MS = 3_600_000;

interface SubStep {
  mid: LatLon;
  headingDeg: number;
  nm: number;
  grade: FuelGrade;
}

/** Linear in lat/lon between a and b (as `pointAlongPolyline` does within a segment). */
const lerp = (a: LatLon, b: LatLon, t: number): LatLon => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t,
});

/**
 * The polyline cut into sub-steps: each segment is split into equal pieces no longer than `stepNm`.
 * Zero-length segments (repeated points) are skipped. Speed-independent, so computed once per route.
 */
function subSteps(points: LatLon[], stepNm: number): { steps: SubStep[]; distanceNm: number } {
  const steps: SubStep[] = [];
  let distanceNm = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LatLon;
    const b = points[i] as LatLon;
    const len = greatCircleNm(a, b);
    if (!(len > 0)) continue;
    distanceNm += len;
    const n = Math.max(1, Math.ceil(len / stepNm));
    for (let j = 0; j < n; j++) {
      const mid = lerp(a, b, (j + 0.5) / n);
      steps.push({
        mid,
        headingDeg: bearingDeg(lerp(a, b, j / n), lerp(a, b, (j + 1) / n)),
        nm: len / n,
        grade: gradeAt(mid),
      });
    }
  }
  return { steps, distanceNm };
}

function evaluateSteps(
  input: RouteSpeedInput,
  candidateId: string,
  route: { steps: SubStep[]; distanceNm: number },
  speedKn: number,
): RouteOptionResult {
  const startMs = Date.parse(input.startAt);
  const daily = dailyConsumptionMt(input.curve, speedKn);
  const hoursIn: GradeAmounts = { LSMGO: 0, VLSFO: 0, HSFO: 0 };
  let elapsed = 0;
  let delay = 0;
  let walkedNm = 0;
  let sampledNm = 0;
  let maxWaveHeightM = 0;
  for (const step of route.steps) {
    // Weather at the sub-step's midpoint, at the time the vessel starts the sub-step.
    const sample = input.weather
      ? sampleWeather(input.weather, step.mid, new Date(startMs + elapsed * HOUR_MS))
      : null;
    const sog = effectiveSpeedKn(speedKn, sample, step.headingDeg);
    const h = step.nm / sog;
    elapsed += h;
    delay += h - step.nm / speedKn;
    hoursIn[step.grade] += h;
    walkedNm += step.nm;
    if (sample) {
      sampledNm += step.nm;
      maxWaveHeightM = Math.max(maxWaveHeightM, sample.waveHeightM);
    }
  }

  const distanceNm = route.distanceNm;
  const calmHours = distanceNm / speedKn;
  const hours = calmHours + delay;
  const etaMs = startMs + Math.round(hours * HOUR_MS);
  const fuelMt: GradeAmounts = { LSMGO: 0, VLSFO: 0, HSFO: 0 };
  let totalFuelMt = 0;
  let fuelCostUsd = 0;
  for (const g of FUEL_GRADES) {
    fuelMt[g] = (daily * hoursIn[g]) / 24;
    totalFuelMt += fuelMt[g];
    fuelCostUsd += fuelMt[g] * input.fuelPriceUsdPerMt[g];
  }
  const co2T = co2Tonnes(fuelMt);
  const etsCostUsd = etsCost({
    co2T,
    coverage: input.etsCoverage,
    year: input.market.year,
    euaPriceEur: input.market.euaPriceEur,
    eurUsd: input.market.eurUsd,
  }).costUsd;
  // Arriving before the berth window opens saves no vessel time.
  const untilWindowHours =
    input.notBefore === null ? 0 : (Date.parse(input.notBefore) - startMs) / HOUR_MS;
  const timeCostUsd = (input.dailyCostUsd * Math.max(hours, untilWindowHours)) / 24;
  const feasible = input.arriveBy === null || etaMs <= Date.parse(input.arriveBy);

  return {
    candidateId,
    speedKn,
    distanceNm,
    hours,
    calmHours,
    weatherDelayHours: hours - calmHours,
    eta: new Date(etaMs).toISOString(),
    fuelMt,
    totalFuelMt,
    co2T,
    fuelCostUsd,
    etsCostUsd,
    timeCostUsd,
    totalCostUsd: fuelCostUsd + etsCostUsd + timeCostUsd,
    maxWaveHeightM,
    // Both sums add the same sub-steps, so full coverage is exactly 100.
    weatherCoveragePct: walkedNm > 0 ? (sampledNm / walkedNm) * 100 : 0,
    feasible,
    reasons: feasible ? [] : ["misses_arrive_by"],
  };
}

/**
 * One route at one speed through the water. The polyline is walked in equal sub-steps of at most
 * `stepNm`; each takes the weather at its midpoint, the speed over ground from `effectiveSpeedKn`
 * on its heading, and burns `dailyConsumptionMt(curve, speedKn)` for its hours in the grade
 * `gradeAt(midpoint)` requires. Vessel time is charged up to `notBefore` at least.
 */
export function evaluateRoute(
  input: RouteSpeedInput,
  candidate: RouteCandidate,
  speedKn: number,
): RouteOptionResult {
  return evaluateSteps(input, candidate.id, subSteps(candidate.points, input.stepNm), speedKn);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** curve.minSpeedKn, + speedStepKn, … up to curve.maxSpeedKn, each rounded to 2 decimals. */
function speedGrid(input: RouteSpeedInput): number[] {
  const { minSpeedKn, maxSpeedKn } = input.curve;
  const out: number[] = [];
  for (let i = 0; ; i++) {
    const s = round2(minSpeedKn + i * input.speedStepKn);
    if (s > maxSpeedKn) break;
    out.push(s);
  }
  return out;
}

interface Ranked {
  option: RouteOptionResult;
  candidate: number;
}

/**
 * Feasible before infeasible, then cost, fuel, earlier candidate, lower speed. When none is
 * feasible, the earliest ETA first, then the same order.
 */
function pickBest(list: Ranked[]): Ranked {
  const anyFeasible = list.some((r) => r.option.feasible);
  const better = (x: Ranked, y: Ranked): boolean => {
    const a = x.option;
    const b = y.option;
    if (anyFeasible) {
      if (a.feasible !== b.feasible) return a.feasible;
    } else {
      const ea = Date.parse(a.eta);
      const eb = Date.parse(b.eta);
      if (ea !== eb) return ea < eb;
    }
    if (a.totalCostUsd !== b.totalCostUsd) return a.totalCostUsd < b.totalCostUsd;
    if (a.totalFuelMt !== b.totalFuelMt) return a.totalFuelMt < b.totalFuelMt;
    if (x.candidate !== y.candidate) return x.candidate < y.candidate;
    return a.speedKn < b.speedKn;
  };
  let best = list[0] as Ranked;
  for (const r of list) if (better(r, best)) best = r;
  return best;
}

/**
 * Best route and speed: every candidate at every speed on the grid (the baseline speed is added
 * to the baseline candidate's grid), ranked by `pickBest`. Options hold each candidate at its own
 * best speed; the savings are the baseline minus the best.
 */
export function optimiseRouteSpeed(rawInput: RouteSpeedInput): RouteSpeedResult {
  const input = RouteSpeedInput.parse(rawInput);
  const baseIndex = input.candidates.findIndex((c) => c.id === input.baseline.candidateId);
  if (baseIndex < 0) {
    throw new RangeError(`baseline candidate "${input.baseline.candidateId}" is not a candidate`);
  }
  const ids = new Set(input.candidates.map((c) => c.id));
  if (ids.size !== input.candidates.length) throw new RangeError("candidate ids must be unique");

  const grid = speedGrid(input);
  let baseline: RouteOptionResult | null = null;
  const options: Ranked[] = input.candidates.map((c, i) => {
    const route = subSteps(c.points, input.stepNm);
    const speeds = [...grid];
    if (i === baseIndex && !speeds.includes(input.baseline.speedKn)) {
      speeds.push(input.baseline.speedKn);
      speeds.sort((a, b) => a - b);
    }
    const ranked = speeds.map((s) => {
      const option = evaluateSteps(input, c.id, route, s);
      if (i === baseIndex && s === input.baseline.speedKn) baseline = option;
      return { option, candidate: i };
    });
    return pickBest(ranked);
  });
  const best = pickBest(options).option;
  const base = baseline as RouteOptionResult | null;
  if (!base) throw new Error("baseline option was not evaluated");
  return {
    options: options.map((r) => r.option),
    baseline: base,
    bestCandidateId: best.candidateId,
    savingVsBaselineUsd: base.totalCostUsd - best.totalCostUsd,
    fuelSavingVsBaselineMt: base.totalFuelMt - best.totalFuelMt,
  };
}
