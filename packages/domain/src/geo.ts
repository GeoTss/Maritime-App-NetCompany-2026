import type { LatLon } from "@pharos/shared";
import { EARTH_RADIUS_NM } from "./constants.js";

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Haversine great-circle distance in nautical miles. */
export function greatCircleNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline in nautical miles (0 for fewer than two points). */
export function polylineNm(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += greatCircleNm(a, b);
  }
  return total;
}

/**
 * Position `nm` along the polyline, clamped to its ends. Within a segment the
 * position is linear in lat/lon by the share of that segment's great-circle length.
 */
export function pointAlongPolyline(points: LatLon[], nm: number): LatLon {
  if (points.length === 0) throw new RangeError("points must not be empty");
  if (Number.isNaN(nm)) throw new RangeError("nm must not be NaN");
  const first = points[0];
  if (!first) throw new RangeError("points must not be empty");
  if (nm <= 0 || points.length === 1) return { lat: first.lat, lon: first.lon };
  let remaining = nm;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const len = greatCircleNm(a, b);
    if (remaining <= len && len > 0) {
      const t = remaining / len;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
    remaining -= len;
  }
  const last = points[points.length - 1] ?? first;
  return { lat: last.lat, lon: last.lon };
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

/** Arrival time after steaming `distanceNm` at `speedKn` from `start`, to the nearest millisecond. */
export function etaAfter(start: Date, distanceNm: number, speedKn: number): Date {
  if (!(speedKn > 0)) throw new RangeError("speedKn must be > 0");
  if (!(distanceNm >= 0) || !Number.isFinite(distanceNm)) {
    throw new RangeError("distanceNm must be finite and >= 0");
  }
  if (Number.isNaN(start.getTime())) throw new RangeError("start must be a valid Date");
  const ms = (distanceNm / speedKn) * 3_600_000;
  return new Date(start.getTime() + Math.round(ms));
}

/**
 * The point of a polyline nearest to `p`: its distance along the polyline from the start and how far
 * `p` is from it. Each segment is projected in a local plane (longitude scaled by cos(latitude)),
 * which is accurate enough for the short off-track distances it is used for.
 */
export function nearestAlongNm(points: LatLon[], p: LatLon): { nm: number; offNm: number } {
  let best = { nm: 0, offNm: Number.POSITIVE_INFINITY };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LatLon;
    const b = points[i] as LatLon;
    const len = greatCircleNm(a, b);
    const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    const dx = (b.lon - a.lon) * k;
    const dy = b.lat - a.lat;
    const sq = dx * dx + dy * dy;
    const t =
      sq > 0 ? Math.min(1, Math.max(0, ((p.lon - a.lon) * k * dx + (p.lat - a.lat) * dy) / sq)) : 0;
    const q = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    const offNm = greatCircleNm(p, q);
    if (offNm < best.offNm) best = { nm: walked + t * len, offNm };
    walked += len;
  }
  if (points.length === 1) best = { nm: 0, offNm: greatCircleNm(p, points[0] as LatLon) };
  return best;
}
