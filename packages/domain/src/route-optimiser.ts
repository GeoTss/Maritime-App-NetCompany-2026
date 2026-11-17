/**
 * Weather-aware route and speed optimiser: one speed setting per route (ruling P2), searched
 * exhaustively over the vessel's speed range for every candidate route. Pure and deterministic:
 * the clock (`startAt`) and the weather snapshot come in with the input.
 */
import {
  FUEL_GRADES,
  type GradeAmounts,
  type HazardZone,
  type LatLon,
  type RouteCandidate,
  type RouteOptionResult,
  RouteSpeedInput,
  type RouteSpeedResult,
} from "@pharos/shared";
import { dailyConsumptionMt } from "./consumption.js";
import { co2Tonnes, etsCost } from "./emissions.js";
import { fuelEuCost } from "./fueleu.js";
import { bestStopPlan, recommendPlan } from "./stop-plan.js";
import { hazardIdsOfSteps, type SubStep, subSteps, walkSteps } from "./track.js";
import { projectFuelAlongTrack } from "./track-fuel.js";

const HOUR_MS = 3_600_000;

/** Zones a polyline passes through: any sub-step midpoint (steps of at most `stepNm`) inside one. Sorted. */
export function routeHazardIds(points: LatLon[], stepNm: number, zones: HazardZone[]): string[] {
  return hazardIdsOfSteps(subSteps(points, stepNm).steps, zones);
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
  let delay = 0;
  let walkedNm = 0;
  let sampledNm = 0;
  let maxWaveHeightM = 0;
  for (const step of walkSteps(route.steps, new Date(startMs), speedKn, input.weather)) {
    const h = step.hours;
    delay += h - step.nm / speedKn;
    hoursIn[step.grade] += h;
    walkedNm += step.nm;
    if (step.waveHeightM !== null) {
      sampledNm += step.nm;
      maxWaveHeightM = Math.max(maxWaveHeightM, step.waveHeightM);
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
  const fuelEuCostUsd = fuelEuCost({
    fuelMt,
    coverage: input.etsCoverage,
    year: input.market.year,
    eurUsd: input.market.eurUsd,
  }).penaltyUsd;
  // Arriving before the berth window opens saves no vessel time.
  const untilWindowHours =
    input.notBefore === null ? 0 : (Date.parse(input.notBefore) - startMs) / HOUR_MS;
  const timeCostUsd = (input.dailyCostUsd * Math.max(hours, untilWindowHours)) / 24;
  const meetsArriveBy = input.arriveBy === null || etaMs <= Date.parse(input.arriveBy);
  const hazardIds = hazardIdsOfSteps(route.steps, input.hazards);
  const reasons: RouteOptionResult["reasons"] = [];
  if (!meetsArriveBy) reasons.push("misses_arrive_by");
  if (hazardIds.length > 0) reasons.push("crosses_hazard");
  const feasible = reasons.length === 0;

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
    fuelEuCostUsd,
    timeCostUsd,
    totalCostUsd: fuelCostUsd + etsCostUsd + fuelEuCostUsd + timeCostUsd,
    maxWaveHeightM,
    // Both sums add the same sub-steps, so full coverage is exactly 100.
    weatherCoveragePct: walkedNm > 0 ? (sampledNm / walkedNm) * 100 : 0,
    feasible,
    meetsArriveBy,
    crossesHazard: hazardIds.length > 0,
    hazardIds,
    reasons,
    fuel: null,
  };
}

/**
 * One route at one speed through the water. The polyline is walked in equal sub-steps of at most
 * `stepNm`; each takes the weather at its midpoint, the speed over ground from `effectiveSpeedKn`
 * on its heading, and burns `dailyConsumptionMt(curve, speedKn)` for its hours in the grade
 * `gradeAt(midpoint)` requires. Vessel time is charged up to `notBefore` at least. A route whose
 * sub-step midpoint lies inside a hazard zone is infeasible (`crosses_hazard`).
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
    const s = Math.max(minSpeedKn, round2(minSpeedKn + i * input.speedStepKn));
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
 * feasible, the earliest ETA first, then the same order. `passes` says what counts as feasible:
 * across candidates the real verdict; across one candidate's speeds only the speed-dependent
 * reasons, since `crosses_hazard` is the same at every speed (so the speed is chosen as if the
 * hazard were absent, and the option is still reported infeasible).
 */
function pickBest(list: Ranked[], passes: (o: RouteOptionResult) => boolean): Ranked {
  const anyFeasible = list.some((r) => passes(r.option));
  const better = (x: Ranked, y: Ranked): boolean => {
    const a = x.option;
    const b = y.option;
    if (anyFeasible) {
      if (passes(a) !== passes(b)) return passes(a);
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
    return pickBest(ranked, (o) => !o.reasons.includes("misses_arrive_by"));
  });
  // The fuel-blind choice: berth window and hazards only (fuel is checked below, not ranked on).
  const best = pickBest(options, (o) => o.feasible).option;
  const base = baseline as RouteOptionResult | null;
  if (!base) throw new Error("baseline option was not evaluated");

  const pointsOf = new Map(input.candidates.map((c) => [c.id, c.points]));
  const fueled = (o: RouteOptionResult): RouteOptionResult => {
    if (!input.fuel) return o;
    const fuel = projectFuelAlongTrack({
      startAt: input.startAt,
      points: pointsOf.get(o.candidateId) ?? [],
      speedKn: o.speedKn,
      stepNm: input.stepNm,
      curve: input.curve,
      weather: input.weather,
      robMt: input.fuel.robMt,
      safetyMarginDays: input.fuel.safetyMarginDays,
      stop: null,
      probesNm: [],
    });
    const reasons: RouteOptionResult["reasons"] = fuel.keepsMargins
      ? o.reasons
      : [...o.reasons, "insufficient_fuel"];
    return { ...o, fuel, reasons, feasible: reasons.length === 0 };
  };
  const finalOptions = options.map((r) => fueled(r.option));
  const finalBest = finalOptions.find((o) => o.candidateId === best.candidateId) ?? fueled(best);
  const stopPlans = input.fuel ? input.stops.map((s) => bestStopPlan(input, s, grid)) : [];
  return {
    options: finalOptions,
    baseline: fueled(base),
    bestCandidateId: best.candidateId,
    savingVsBaselineUsd: base.totalCostUsd - best.totalCostUsd,
    fuelSavingVsBaselineMt: base.totalFuelMt - best.totalFuelMt,
    stopPlans,
    plan: input.fuel ? recommendPlan(finalBest, stopPlans) : null,
  };
}
