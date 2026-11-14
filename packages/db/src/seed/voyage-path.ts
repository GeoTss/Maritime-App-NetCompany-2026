/** Where a vessel is along its planned route at a given time, and what it burned getting there. */
import { legFuel, pointAlongPolyline, portStayFuelMt } from "@pharos/domain";
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

export const portGrade = (p: Port): FuelGrade => (p.inEca ? "LSMGO" : "VLSFO");

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

export function sailedNmAt(path: VoyagePath, t: Date): number {
  const hours = (t.getTime() - path.departAt.getTime()) / HOUR_MS;
  return Math.min(totalNm(path), Math.max(0, hours * path.voyage.plannedSpeedKn));
}

export function positionAt(path: VoyagePath, nm: number): LatLon {
  let rest = nm;
  for (const leg of path.legs) {
    if (rest <= leg.distanceNm) return pointAlongPolyline(leg.waypoints, rest);
    rest -= leg.distanceNm;
  }
  return { lat: path.destination.lat, lon: path.destination.lon };
}

/** Initial great-circle bearing a -> b, degrees in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  const deg = Math.atan2(y, x) / rad;
  return (deg + 360) % 360;
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
