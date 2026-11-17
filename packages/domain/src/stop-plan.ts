/**
 * Stop plans: a route through a bunker port with the quote's fuel added there, costed like a route
 * option plus the fuel bought and the barge fee, and checked for fuel on board, tank space, the
 * offered quantity, the delivery window, the berth window and hazards. Pure and deterministic.
 */
import {
  type EtsCoverageFactor,
  FUEL_GRADES,
  type FuelGrade,
  type GradeAmounts,
  type RecommendedPlan,
  type RouteOptionResult,
  type RouteSpeedInput,
  type StopCandidate,
  type StopPlanReason,
  type StopPlanResult,
  type StopTimeline,
} from "@pharos/shared";
import { stopTimeline } from "./bunker-stop.js";
import { portStayFuelMt } from "./consumption.js";
import { co2Tonnes, etsCost } from "./emissions.js";
import { fuelEuCost } from "./fueleu.js";
import { hazardIdsOfSteps, subSteps } from "./track.js";
import { projectFuelAlongTrack } from "./track-fuel.js";

const HOUR_MS = 3_600_000;
const zero = (): Record<FuelGrade, number> => ({ LSMGO: 0, VLSFO: 0, HSFO: 0 });

function noSeaRoute(input: RouteSpeedInput, stop: StopCandidate, speedKn: number): StopPlanResult {
  return {
    optionId: stop.optionId,
    quoteId: stop.quoteId,
    unlocode: stop.unlocode,
    speedKn,
    distanceNm: 0,
    steamingHours: 0,
    hours: 0,
    seaWeatherDelayHours: 0,
    eta: new Date(Date.parse(input.startAt)).toISOString(),
    stop: null,
    fuel: null,
    fuelMt: zero(),
    co2T: 0,
    fuelCostUsd: 0,
    timeCostUsd: 0,
    etsCostUsd: 0,
    fuelEuCostUsd: 0,
    voyageCostUsd: 0,
    bunkerFuelCostUsd: 0,
    bargeFeeUsd: 0,
    totalCostUsd: 0,
    qtyMt: stop.qtyMt,
    hazardIds: [],
    feasible: false,
    reasons: ["no_sea_route"],
  };
}

/**
 * One stop plan at one speed. The track walks to the port, stays for the stop timeline (waiting,
 * workable weather, bunkering), burns the stay in the port grade and adds the quote's quantity.
 * Steaming fuel is charged ETS and FuelEU at the input's coverage; the stay at the port's own
 * (1 at an EU port, else 0).
 */
export function evaluateStopPlan(
  input: RouteSpeedInput,
  stop: StopCandidate,
  speedKn: number,
): StopPlanResult {
  if (stop.routeError !== null) return noSeaRoute(input, stop, speedKn);
  const onBoard = input.fuel;
  let timeline: StopTimeline | null = null;
  const fuel = projectFuelAlongTrack(
    {
      startAt: input.startAt,
      points: stop.points,
      speedKn,
      stepNm: input.stepNm,
      curve: input.curve,
      weather: input.weather,
      robMt: onBoard?.robMt ?? zero(),
      safetyMarginDays: onBoard?.safetyMarginDays ?? 0,
      stop: {
        pointIndex: stop.stopPointIndex,
        position: stop.position,
        waitingHours: stop.waitingHours,
        bunkeringHours: stop.bunkeringHours,
        stayGrade: stop.stayGrade,
        grade: stop.grade,
        qtyMt: stop.qtyMt,
      },
      probesNm: [],
    },
    (arriveAt) => {
      const t = stopTimeline({
        arriveAt,
        position: stop.position,
        waitingHours: stop.waitingHours,
        bunkeringHours: stop.bunkeringHours,
        weather: input.weather,
      });
      timeline = t;
      return (Date.parse(t.departAt) - arriveAt.getTime()) / HOUR_MS;
    },
  );
  const t = timeline as StopTimeline | null;
  const stayHours = t ? t.waitingHours + t.weatherDelayHours + t.bunkeringHours : 0;
  const startMs = Date.parse(input.startAt);
  const end = fuel.breakpoints[fuel.breakpoints.length - 1];
  const etaMs = end ? Date.parse(end.at) : startMs;
  const hours = (etaMs - startMs) / HOUR_MS;
  const steamingHours = hours - stayHours;
  const route = subSteps(stop.points, input.stepNm);

  const stayFuel = zero();
  stayFuel[stop.stayGrade] = portStayFuelMt(input.curve, stayHours);
  const steamFuel = zero();
  const fuelMt = zero();
  let fuelCostUsd = 0;
  for (const g of FUEL_GRADES) {
    fuelMt[g] = fuel.grades[g].neededMt;
    steamFuel[g] = Math.max(0, fuelMt[g] - stayFuel[g]);
    fuelCostUsd += fuelMt[g] * input.fuelPriceUsdPerMt[g];
  }
  const { market } = input;
  const ets = (mt: GradeAmounts, coverage: EtsCoverageFactor): number =>
    etsCost({
      co2T: co2Tonnes(mt),
      coverage,
      year: market.year,
      euaPriceEur: market.euaPriceEur,
      eurUsd: market.eurUsd,
    }).costUsd;
  const fuelEu = (mt: GradeAmounts, coverage: EtsCoverageFactor): number =>
    fuelEuCost({ fuelMt: mt, coverage, year: market.year, eurUsd: market.eurUsd }).penaltyUsd;
  const stayCoverage: EtsCoverageFactor = stop.portIsEu ? 1 : 0;
  const etsCostUsd = ets(steamFuel, input.etsCoverage) + ets(stayFuel, stayCoverage);
  const fuelEuCostUsd = fuelEu(steamFuel, input.etsCoverage) + fuelEu(stayFuel, stayCoverage);
  const untilWindowHours =
    input.notBefore === null ? 0 : (Date.parse(input.notBefore) - startMs) / HOUR_MS;
  const timeCostUsd = (input.dailyCostUsd * Math.max(hours, untilWindowHours)) / 24;
  const voyageCostUsd = fuelCostUsd + timeCostUsd + etsCostUsd + fuelEuCostUsd;
  const bunkerFuelCostUsd = stop.qtyMt * stop.pricePerMt * stop.fxToUsd;
  const bargeFeeUsd = stop.bargeFee * stop.fxToUsd;
  const hazardIds = hazardIdsOfSteps(route.steps, input.hazards);

  const arrival = fuel.breakpoints.find((b) => b.kind === "stop_arrival");
  const arrivalMs = arrival ? Date.parse(arrival.at) : etaMs;
  const reasons: StopPlanReason[] = [];
  if (input.arriveBy !== null && etaMs > Date.parse(input.arriveBy))
    reasons.push("misses_arrive_by");
  if (hazardIds.length > 0) reasons.push("crosses_hazard");
  if (onBoard && !fuel.keepsMargins) reasons.push("insufficient_fuel");
  if (
    onBoard &&
    arrival &&
    arrival.robMt[stop.grade] + stop.qtyMt > onBoard.tankCapacityMt[stop.grade]
  ) {
    reasons.push("exceeds_tank_capacity");
  }
  if (stop.offeredQtyMt < stop.qtyMt) reasons.push("insufficient_quantity");
  if (
    (stop.deliveryFrom !== null && arrivalMs < Date.parse(stop.deliveryFrom)) ||
    (stop.deliveryTo !== null && arrivalMs > Date.parse(stop.deliveryTo))
  ) {
    reasons.push("outside_delivery_window");
  }

  return {
    optionId: stop.optionId,
    quoteId: stop.quoteId,
    unlocode: stop.unlocode,
    speedKn,
    distanceNm: route.distanceNm,
    steamingHours,
    hours,
    seaWeatherDelayHours: steamingHours - route.distanceNm / speedKn,
    eta: new Date(etaMs).toISOString(),
    stop: t,
    fuel,
    fuelMt,
    co2T: co2Tonnes(fuelMt),
    fuelCostUsd,
    timeCostUsd,
    etsCostUsd,
    fuelEuCostUsd,
    voyageCostUsd,
    bunkerFuelCostUsd,
    bargeFeeUsd,
    totalCostUsd: voyageCostUsd + bunkerFuelCostUsd + bargeFeeUsd,
    qtyMt: stop.qtyMt,
    hazardIds,
    feasible: reasons.length === 0,
    reasons,
  };
}

/**
 * Feasible first; between feasible plans the lower total cost, then the earlier ETA; between
 * infeasible ones the earlier ETA first (as the optimiser ranks infeasible routes), so a quote no
 * speed can make work is shown at its fastest, not its cheapest. Then the lower speed.
 */
export function stopPlanBefore(a: StopPlanResult, b: StopPlanResult): number {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
  const ea = Date.parse(a.eta);
  const eb = Date.parse(b.eta);
  if (!a.feasible && ea !== eb) return ea - eb;
  if (a.totalCostUsd !== b.totalCostUsd) return a.totalCostUsd - b.totalCostUsd;
  if (ea !== eb) return ea - eb;
  return a.speedKn - b.speedKn;
}

/** The stop plan at its best speed on `speeds`. */
export function bestStopPlan(
  input: RouteSpeedInput,
  stop: StopCandidate,
  speeds: number[],
): StopPlanResult {
  if (stop.routeError !== null) return noSeaRoute(input, stop, input.baseline.speedKn);
  const plans = speeds.map((s) => evaluateStopPlan(input, stop, s));
  plans.sort(stopPlanBefore);
  return plans[0] as StopPlanResult;
}

/**
 * The recommended plan. With stop plans: the cheapest feasible one, with what it adds to the
 * fuel-blind best and the next feasible one. Without: the cheapest route (in `options`, each at its
 * own speed) that keeps every fuel margin, with what it adds to the best and the next such route.
 * Null when nothing qualifies.
 */
export function recommendPlan(
  best: RouteOptionResult,
  options: RouteOptionResult[],
  stopPlans: StopPlanResult[],
): RecommendedPlan | null {
  if (stopPlans.length === 0) {
    const ok = options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.feasible)
      .sort(
        (x, y) =>
          x.o.totalCostUsd - y.o.totalCostUsd ||
          Date.parse(x.o.eta) - Date.parse(y.o.eta) ||
          x.i - y.i,
      )
      .map(({ o }) => o);
    const top = ok[0];
    if (!top) return null;
    const next = ok[1];
    return {
      kind: "route",
      optionId: top.candidateId,
      addedHours: top.hours - best.hours,
      addedUsd: top.totalCostUsd - best.totalCostUsd,
      next: next
        ? {
            optionId: next.candidateId,
            totalCostUsd: next.totalCostUsd,
            marginUsd: next.totalCostUsd - top.totalCostUsd,
          }
        : null,
    };
  }
  const feasible = stopPlans.filter((s) => s.feasible).sort(stopPlanBefore);
  const top = feasible[0];
  if (!top) return null;
  const next = feasible[1];
  return {
    kind: "stop",
    optionId: top.optionId,
    addedHours: top.hours - best.hours,
    addedUsd: top.voyageCostUsd + top.bargeFeeUsd - best.totalCostUsd,
    next: next
      ? {
          optionId: next.optionId,
          totalCostUsd: next.totalCostUsd,
          marginUsd: next.totalCostUsd - top.totalCostUsd,
        }
      : null,
  };
}
