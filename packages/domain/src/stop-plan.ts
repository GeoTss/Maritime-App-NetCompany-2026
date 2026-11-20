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
  type LatLon,
  type RecommendedPlan,
  type RouteOptionResult,
  type RouteSpeedInput,
  type StopCandidate,
  type StopPlanReason,
  type StopPlanResult,
  type StopTimeline,
  type TrackFuel,
} from "@pharos/shared";
import { areaPasses } from "./areas.js";
import { stopTimeline } from "./bunker-stop.js";
import { HEAVY_WEATHER_MAX_WAVE_M } from "./constants.js";
import { portStayFuelMt } from "./consumption.js";
import { co2Tonnes, etsCost } from "./emissions.js";
import { fuelEuCost } from "./fueleu.js";
import { polylineNm } from "./geo.js";
import { outdatedItems, portCallPlan } from "./port-call.js";
import { securityPlan } from "./security.js";
import { hazardIdsOfSteps, subSteps, type WalkedStep, walkSteps } from "./track.js";
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
    maxWaveHeightM: 0,
    portCall: null,
    feasible: false,
    reasons: ["no_sea_route"],
  };
}

/**
 * The walk a stop plan's fuel projection makes (`projectFuelAlongTrack`): the same sub-steps,
 * start and weather, paused at the port for the stay its timeline gives (`stay`: departure minus
 * arrival; none without one). For whatever needs the times and positions along it (the voyage
 * timeline). Null when the input has no such stop, or the stop has no sea route.
 */
export function walkStopPlan(
  input: RouteSpeedInput,
  optionId: string,
  speedKn: number,
  stay: StopTimeline | null,
): { points: LatLon[]; steps: WalkedStep[]; stopPointIndex: number } | null {
  const stop = input.stops.find((s) => s.optionId === optionId);
  if (!stop || stop.routeError !== null) return null;
  const stayHours = stay ? (Date.parse(stay.departAt) - Date.parse(stay.arriveAt)) / HOUR_MS : 0;
  const { steps } = subSteps(stop.points, input.stepNm);
  return {
    points: stop.points,
    stopPointIndex: stop.stopPointIndex,
    steps: walkSteps(steps, new Date(Date.parse(input.startAt)), speedKn, input.weather, {
      pointIndex: stop.stopPointIndex,
      hours: () => stayHours,
    }),
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
  const clearanceHours = stop.terms && input.stores ? stop.terms.clearanceHours : 0;
  const passes =
    stop.terms && input.stores
      ? areaPasses(
          stop.points,
          input.stepNm,
          (input.nautical ?? []).map((i) => ({ id: i.itemId, boxes: i.coverage })),
        )
      : [];
  const walk = (serviceHours: number): { fuel: TrackFuel; timeline: StopTimeline | null } => {
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
        probesNm: passes.map((p) => p.enterNm),
      },
      (arriveAt) => {
        const t = stopTimeline({
          arriveAt,
          position: stop.position,
          waitingHours: stop.waitingHours,
          bunkeringHours: stop.bunkeringHours,
          clearanceHours,
          serviceHours,
          weather: input.weather,
        });
        timeline = t;
        return (Date.parse(t.departAt) - arriveAt.getTime()) / HOUR_MS;
      },
    );
    return { fuel, timeline };
  };

  // Pass 1 decides what the call must do; pass 2 times the call with those jobs.
  let { fuel, timeline } = walk(stop.bunkeringHours);
  let call: ReturnType<typeof portCallPlan> | null = null;
  if (stop.terms && input.stores) {
    const startMsCall = Date.parse(input.startAt);
    const t1 = timeline as StopTimeline | null;
    const arrival1 = fuel.breakpoints.find((b) => b.kind === "stop_arrival");
    const end1 = fuel.breakpoints[fuel.breakpoints.length - 1];
    const fuelToStopMt = zero();
    for (const g of FUEL_GRADES) {
      fuelToStopMt[g] = Math.max(0, (onBoard?.robMt[g] ?? 0) - (arrival1?.robMt[g] ?? 0));
      if (!onBoard) fuelToStopMt[g] = 0;
    }
    const fuelTotalMt = zero();
    for (const g of FUEL_GRADES) fuelTotalMt[g] = fuel.grades[g].neededMt;
    const stopNm = polylineNm(stop.points.slice(0, stop.stopPointIndex + 1));
    const timeAt = (probes: TrackFuel["probes"]) => (nm: number) =>
      probes.find((p) => p.nm === nm)?.at ?? input.startAt;
    const outdated = outdatedItems(
      input.stores.onBoard,
      input.nautical ?? [],
      passes,
      { nm: stopNm, position: stop.position },
      timeAt(fuel.probes),
    );
    const arriveMs = t1 ? Date.parse(t1.arriveAt) : startMsCall;
    call = portCallPlan({
      stores: input.stores,
      terms: stop.terms,
      portIsEu: stop.portIsEu,
      now: new Date(startMsCall),
      arriveAt: new Date(arriveMs),
      hoursToStop: (arriveMs - startMsCall) / HOUR_MS,
      hoursToEta: ((end1 ? Date.parse(end1.at) : startMsCall) - startMsCall) / HOUR_MS,
      stayHours: t1
        ? t1.waitingHours + t1.clearanceHours + t1.weatherDelayHours + t1.serviceHours
        : 0,
      fuelToStopMt,
      fuelTotalMt,
      outdated,
      bunkeringHours: stop.bunkeringHours,
    });
    ({ fuel, timeline } = walk(call.serviceHours));
    call = {
      ...call,
      outdated: outdatedItems(
        input.stores.onBoard,
        input.nautical ?? [],
        passes,
        { nm: stopNm, position: stop.position },
        timeAt(fuel.probes),
      ),
    };
  }
  const t = timeline as StopTimeline | null;
  const stayHours = t
    ? t.waitingHours + t.clearanceHours + t.weatherDelayHours + t.serviceHours
    : 0;
  // Track 3, as for a route option: the danger areas on the stop plan's own walk (the call's stay
  // included, so a team aboard across it is paid for it), its team, premium and canal dues.
  const walked = input.security ? walkStopPlan(input, stop.optionId, speedKn, t) : null;
  const sec =
    input.security && walked
      ? securityPlan({
          steps: walked.steps,
          areas: input.security.areas,
          quotes: input.security.quotes,
          hullValueUsd: input.security.hullValueUsd,
          canal: input.security.canal,
        })
      : null;
  const convoyWaitHours = sec?.result.convoyWaitHours ?? 0;
  const startMs = Date.parse(input.startAt);
  const end = fuel.breakpoints[fuel.breakpoints.length - 1];
  const walkEndMs = end ? Date.parse(end.at) : startMs;
  // The wait for the canal convoy adds to the voyage (the walk's later weather is not shifted).
  const etaMs = walkEndMs + Math.round(convoyWaitHours * HOUR_MS);
  const hours = (etaMs - startMs) / HOUR_MS;
  const steamingHours = (walkEndMs - startMs) / HOUR_MS - stayHours;
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
  if (call) for (const r of call.reasons) if (!reasons.includes(r)) reasons.push(r);
  if (fuel.maxWaveHeightM > HEAVY_WEATHER_MAX_WAVE_M) reasons.push("heavy_weather");
  if (
    (stop.deliveryFrom !== null && arrivalMs < Date.parse(stop.deliveryFrom)) ||
    (stop.deliveryTo !== null && arrivalMs > Date.parse(stop.deliveryTo))
  ) {
    reasons.push("outside_delivery_window");
  }
  if (sec) for (const r of sec.reasons) reasons.push(r);

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
    totalCostUsd:
      voyageCostUsd +
      bunkerFuelCostUsd +
      bargeFeeUsd +
      (call?.extraCostUsd ?? 0) +
      (sec?.result.extraCostUsd ?? 0),
    qtyMt: stop.qtyMt,
    hazardIds,
    maxWaveHeightM: fuel.maxWaveHeightM,
    portCall: call
      ? {
          jobs: call.jobs,
          costLines: call.costLines,
          extraCostUsd: call.extraCostUsd,
          notices: call.notices,
          outdated: call.outdated,
          provisionsDaysAtEta: call.provisionsDaysAtEta,
          sludgeM3AtEta: call.sludgeM3AtEta,
          sewageM3AtEta: call.sewageM3AtEta,
        }
      : null,
    feasible: reasons.length === 0,
    reasons,
    ...(sec ? { security: sec.result } : {}),
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
    addedUsd:
      top.voyageCostUsd + top.bargeFeeUsd + (top.portCall?.extraCostUsd ?? 0) - best.totalCostUsd,
    next: next
      ? {
          optionId: next.optionId,
          totalCostUsd: next.totalCostUsd,
          marginUsd: next.totalCostUsd - top.totalCostUsd,
        }
      : null,
  };
}
