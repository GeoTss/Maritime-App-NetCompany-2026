/** Voyage progress: where a vessel is along its planned route at a given time, and what it burned. */
import type {
  ConsumptionCurve,
  FobLeg,
  FuelGrade,
  GradeAmounts,
  LatLon,
  Port,
  RouteLeg,
  Voyage,
} from "@pharos/shared";
import { legFuel, portStayFuelMt } from "./consumption.js";
import { greatCircleNm, pointAlongPolyline } from "./geo.js";

const HOUR_MS = 3_600_000;

export interface VoyagePath {
  voyage: Voyage;
  /** Legs in passage order. */
  legs: RouteLeg[];
  origin: Port;
  destination: Port;
  curve: ConsumptionCurve;
  /** When the vessel leaves (or left) the origin; for an in-port vessel this is the anchor. */
  departAt: Date;
}

/** Grade burned alongside in a port: LSMGO inside an ECA, else VLSFO. */
export const portGrade = (p: Port): FuelGrade => (p.inEca ? "LSMGO" : "VLSFO");

/** The route legs joining consecutive port ids, in passage order; throws if one is missing. */
export function legsForRoute(route: number[], legs: RouteLeg[]): RouteLeg[] {
  return route.slice(1).map((to, i) => {
    const from = route[i];
    const leg = legs.find((l) => l.fromPortId === from && l.toPortId === to);
    if (!leg) throw new Error(`no route leg ${from} -> ${to}`);
    return leg;
  });
}

export const totalNm = (path: VoyagePath): number =>
  path.legs.reduce((s, l) => s + l.distanceNm, 0);

/** Distance (nm) from the origin to each port on the route, origin first (0). */
export function cumulativeNm(path: VoyagePath): number[] {
  const out = [0];
  for (const leg of path.legs) out.push((out[out.length - 1] ?? 0) + leg.distanceNm);
  return out;
}

/** Distance sailed at time `t` at the planned speed, clamped to [0, route length]. */
export function sailedNmAt(path: VoyagePath, t: Date): number {
  const hours = (t.getTime() - path.departAt.getTime()) / HOUR_MS;
  return Math.min(totalNm(path), Math.max(0, hours * path.voyage.plannedSpeedKn));
}

/** Position `nm` along the route; past the last leg it is the destination port. */
export function positionAt(path: VoyagePath, nm: number): LatLon {
  let rest = nm;
  for (const leg of path.legs) {
    if (rest <= leg.distanceNm) return pointAlongPolyline(leg.waypoints, rest);
    rest -= leg.distanceNm;
  }
  return { lat: path.destination.lat, lon: path.destination.lon };
}

/** Legs still to sail from `sailedNm`: the rest of the current leg, then the following legs. */
export function remainingFobLegs(path: VoyagePath, sailedNm: number): FobLeg[] {
  const out: FobLeg[] = [];
  let start = 0;
  for (const leg of path.legs) {
    const end = start + leg.distanceNm;
    if (end > sailedNm) {
      out.push({ distanceNm: end - Math.max(start, sailedNm), grade: leg.requiredGrade });
    }
    start = end;
  }
  return out;
}

/** Fuel burned per grade between t0 and t1: aux in port before departure / after arrival, steaming in between. */
export function fuelBetween(path: VoyagePath, t0: Date, t1: Date): GradeAmounts {
  const burned: GradeAmounts = { LSMGO: 0, VLSFO: 0, HSFO: 0 };
  const speed = path.voyage.plannedSpeedKn;
  const dep = path.departAt.getTime();
  const arr = dep + (totalNm(path) / speed) * HOUR_MS;
  const a = t0.getTime();
  const b = t1.getTime();
  const before = Math.max(0, Math.min(b, dep) - a) / HOUR_MS;
  const after = Math.max(0, b - Math.max(a, arr)) / HOUR_MS;
  burned[portGrade(path.origin)] += portStayFuelMt(path.curve, before);
  burned[portGrade(path.destination)] += portStayFuelMt(path.curve, after);

  const nm0 = sailedNmAt(path, t0);
  const nm1 = sailedNmAt(path, t1);
  let start = 0;
  for (const leg of path.legs) {
    const end = start + leg.distanceNm;
    const piece = Math.max(0, Math.min(end, nm1) - Math.max(start, nm0));
    if (piece > 0) burned[leg.requiredGrade] += legFuel(path.curve, piece, speed).fuelMt;
    start = end;
  }
  return burned;
}

/** Free tank space (mt) for one grade: capacity − ROB. ROB above capacity is a data error. */
export function tankFreeMt(capacityMt: number, robMt: number): number {
  if (!(capacityMt >= 0) || !Number.isFinite(capacityMt)) {
    throw new RangeError("capacityMt must be finite and >= 0");
  }
  if (!(robMt >= 0) || !Number.isFinite(robMt))
    throw new RangeError("robMt must be finite and >= 0");
  if (robMt > capacityMt) throw new RangeError("robMt must not exceed capacityMt");
  return capacityMt - robMt;
}

/** Signed hours from `a` to `b` (negative when `b` is earlier). */
export function hoursBetween(a: Date, b: Date): number {
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    throw new RangeError("dates must be valid");
  }
  return (b.getTime() - a.getTime()) / HOUR_MS;
}

/**
 * Points still to sail from `sailedNm`: the position there, then every later waypoint of the
 * current and following legs, ending at the destination port.
 */
export function remainingRoutePoints(path: VoyagePath, sailedNm: number): LatLon[] {
  const out: LatLon[] = [positionAt(path, sailedNm)];
  let rest = Math.max(0, sailedNm);
  let found = false;
  for (const leg of path.legs) {
    if (!found && rest > leg.distanceNm) {
      rest -= leg.distanceNm;
      continue;
    }
    const later = found;
    let along = 0;
    leg.waypoints.forEach((w, i) => {
      const prev = leg.waypoints[i - 1];
      if (prev) along += greatCircleNm(prev, w);
      // Later legs start where the previous one ended; skip that duplicate point.
      if (later ? i > 0 : along > rest) out.push({ lat: w.lat, lon: w.lon });
    });
    found = true;
  }
  if (!found) out.push({ lat: path.destination.lat, lon: path.destination.lon });
  return out;
}
