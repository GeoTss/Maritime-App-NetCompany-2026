/**
 * Fuel on board along a track: the same sub-step walk as the route optimiser, burning the daily
 * rate at the planned speed in the grade each sub-step requires, with an optional bunker stop that
 * burns the stay in the port grade and then adds the bunkered quantity. Pure and deterministic.
 */
import {
  type AlongTrack,
  FUEL_GRADES,
  type FuelBreakpoint,
  type FuelGrade,
  type GradeAmounts,
  type GradeFuelCheck,
  type LatLon,
  type TrackFuel,
  type TrackFuelInput,
} from "@pharos/shared";
import { dailyConsumptionMt, portStayFuelMt } from "./consumption.js";
import { lerp, subSteps, walkSteps } from "./track.js";

const HOUR_MS = 3_600_000;

type Rob = Record<FuelGrade, number>;
const zero = (): Rob => ({ LSMGO: 0, VLSFO: 0, HSFO: 0 });
const copy = (r: Rob): Rob => ({ LSMGO: r.LSMGO, VLSFO: r.VLSFO, HSFO: r.HSFO });
const iso = (ms: number): string => new Date(Math.round(ms)).toISOString();

interface Segment {
  nm0: number;
  nm1: number;
  t0: number;
  t1: number;
  p0: LatLon;
  p1: LatLon;
  rob0: Rob;
  rob1: Rob;
}

/** How long the vessel stays at the stop, given when it arrives. */
export type StayHours = (arriveAt: Date) => number;

/**
 * Projects fuel on board per grade along `points` at `speedKn`. Margins (`safetyMarginDays` ×
 * daily consumption at the speed) apply to the grades burned on the track and are checked after
 * every sub-step and on arrival at the stop. `stayHours` sets the stop's stay (defaults to waiting +
 * bunkering hours).
 */
export function projectFuelAlongTrack(input: TrackFuelInput, stayHours?: StayHours): TrackFuel {
  const { curve, speedKn, stop } = input;
  const daily = dailyConsumptionMt(curve, speedKn);
  const startMs = Date.parse(input.startAt);
  const route = subSteps(input.points, input.stepNm);
  const stayOf: StayHours =
    stayHours ?? (() => (stop ? stop.waitingHours + stop.bunkeringHours : 0));

  let arrival: { at: number; hours: number } | null = null;
  const walked = walkSteps(
    route.steps,
    new Date(startMs),
    speedKn,
    input.weather,
    stop
      ? {
          pointIndex: stop.pointIndex,
          hours: (at) => {
            const hours = stayOf(at);
            arrival = { at: at.getTime(), hours };
            return hours;
          },
        }
      : undefined,
  );

  const burned = new Set<FuelGrade>(route.steps.map((s) => s.grade));
  if (stop) burned.add(stop.stayGrade);
  const margin = zero();
  for (const g of FUEL_GRADES) margin[g] = burned.has(g) ? input.safetyMarginDays * daily : 0;

  const rob: Rob = copy(input.robMt);
  const steam = zero();
  const stay = zero();
  const bunkered = zero();
  const minRob: Rob = copy(rob);
  const below: Record<FuelGrade, GradeFuelCheck["belowMarginAt"]> = {
    LSMGO: null,
    VLSFO: null,
    HSFO: null,
  };
  const dry: Record<FuelGrade, AlongTrack | null> = { LSMGO: null, VLSFO: null, HSFO: null };
  const check = (nm: number, at: number, position: LatLon): void => {
    for (const g of FUEL_GRADES) {
      minRob[g] = Math.min(minRob[g], rob[g]);
      if (below[g] === null && rob[g] < margin[g]) {
        below[g] = { nm, at: iso(at), position, robMt: rob[g] };
      }
      if (dry[g] === null && rob[g] < 0) dry[g] = { nm, at: iso(at), position };
    }
  };

  const first = input.points[0] as LatLon;
  const breakpoints: FuelBreakpoint[] = [
    { kind: "start", nm: 0, at: iso(startMs), position: first, robMt: copy(rob) },
  ];
  const segments: Segment[] = [];
  let stopDone = stop === null;
  let elapsedHours = 0;
  let nm = 0;
  let prevGrade: FuelGrade | null = null;

  const callAtStop = (at: number, hours: number): void => {
    if (!stop) return;
    breakpoints.push({
      kind: "stop_arrival",
      nm,
      at: iso(at),
      position: stop.position,
      robMt: copy(rob),
    });
    check(nm, at, stop.position);
    const stayMt = portStayFuelMt(curve, hours);
    rob[stop.stayGrade] -= stayMt;
    stay[stop.stayGrade] += stayMt;
    rob[stop.grade] += stop.qtyMt;
    bunkered[stop.grade] += stop.qtyMt;
    breakpoints.push({
      kind: "stop_departure",
      nm,
      at: iso(at + hours * HOUR_MS),
      position: stop.position,
      robMt: copy(rob),
    });
    stopDone = true;
  };

  for (const step of walked) {
    if (!stopDone && stop && step.pointIndexAfter > stop.pointIndex && arrival) {
      const a = arrival as { at: number; hours: number };
      callAtStop(a.at, a.hours);
      elapsedHours += a.hours;
    }
    const t0 = step.startAt.getTime();
    if (prevGrade !== null && step.grade !== prevGrade) {
      breakpoints.push({
        kind: "grade_change",
        nm,
        at: iso(t0),
        position: step.start,
        robMt: copy(rob),
      });
    }
    prevGrade = step.grade;
    const rob0 = copy(rob);
    const burn = (daily * step.hours) / 24;
    rob[step.grade] -= burn;
    steam[step.grade] += burn;
    elapsedHours += step.hours;
    const nm1 = nm + step.nm;
    const t1 = t0 + step.hours * HOUR_MS;
    segments.push({ nm0: nm, nm1, t0, t1, p0: step.start, p1: step.end, rob0, rob1: copy(rob) });
    nm = nm1;
    check(nm, t1, step.end);
  }

  // A stop at the last point: the vessel arrives at the end of the walk.
  if (!stopDone && stop) {
    const at = startMs + elapsedHours * HOUR_MS;
    const hours = stayOf(new Date(Math.round(at)));
    callAtStop(at, hours);
    elapsedHours += hours;
  }

  const endMs = startMs + elapsedHours * HOUR_MS;
  const last = input.points[input.points.length - 1] as LatLon;
  breakpoints.push({
    kind: "end",
    nm: route.distanceNm,
    at: iso(endMs),
    position: last,
    robMt: copy(rob),
  });

  const grades = {} as Record<FuelGrade, GradeFuelCheck>;
  for (const g of FUEL_GRADES) {
    const neededMt = steam[g] + stay[g];
    grades[g] = {
      neededMt,
      marginMt: margin[g],
      minRobMt: minRob[g],
      shortfallMt: Math.max(0, neededMt + margin[g] - input.robMt[g] - bunkered[g]),
      belowMarginAt: below[g],
      runsDryAt: dry[g],
    };
  }

  const probes = input.probesNm.map((probeNm) => {
    if (probeNm <= 0 || segments.length === 0) {
      return {
        nm: Math.max(0, probeNm),
        at: iso(startMs),
        position: first,
        robMt: copy(input.robMt as GradeAmounts),
      };
    }
    const seg = segments.find((s) => s.nm1 >= probeNm);
    if (!seg) {
      return { nm: route.distanceNm, at: iso(endMs), position: last, robMt: copy(rob) };
    }
    const f = seg.nm1 > seg.nm0 ? (probeNm - seg.nm0) / (seg.nm1 - seg.nm0) : 1;
    const robMt = zero();
    for (const g of FUEL_GRADES) robMt[g] = seg.rob0[g] + (seg.rob1[g] - seg.rob0[g]) * f;
    return {
      nm: probeNm,
      at: iso(seg.t0 + (seg.t1 - seg.t0) * f),
      position: lerp(seg.p0, seg.p1, f),
      robMt,
    };
  });

  return {
    breakpoints,
    grades: { LSMGO: grades.LSMGO, VLSFO: grades.VLSFO, HSFO: grades.HSFO },
    keepsMargins: FUEL_GRADES.every((g) => below[g] === null),
    probes,
  };
}
