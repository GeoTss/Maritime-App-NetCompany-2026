/**
 * Navigational hazards as keep-out circles. Pure: the clock comes in as `now`.
 * Radii and lifetimes are illustrative planning parameters (see constants.ts).
 */
import type { HazardZone, LatLon, NavHazard } from "@pharos/shared";
import {
  HAZARD_DEFAULT_RADIUS_NM,
  HAZARD_LIFETIME_HOURS,
  HAZARD_SYNTHETIC_RADIUS_NM,
} from "./constants.js";
import { greatCircleNm } from "./geo.js";

const HOUR_MS = 3_600_000;

/**
 * The hazards still active at `now` as zones, sorted by id. A hazard is active while
 * `now − observedAt` is under its kind's lifetime (synthetic never expires; one observed after
 * `now` is active). Its own `radiusNm`, when set and positive, wins over the kind's default.
 */
export function activeHazardZones(hazards: NavHazard[], now: Date): HazardZone[] {
  const zones: HazardZone[] = [];
  for (const h of hazards) {
    if (h.kind !== "synthetic") {
      const ageMs = now.getTime() - h.observedAt.getTime();
      if (!(ageMs < HAZARD_LIFETIME_HOURS[h.kind] * HOUR_MS)) continue;
    }
    const own = h.radiusNm !== null && h.radiusNm > 0 ? h.radiusNm : null;
    const radiusNm =
      own ??
      (h.kind === "synthetic" ? HAZARD_SYNTHETIC_RADIUS_NM : HAZARD_DEFAULT_RADIUS_NM[h.kind]);
    zones.push({ id: h.id, center: { lat: h.lat, lon: h.lon }, radiusNm });
  }
  return zones.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Ids (in zone order) of the zones whose centre is within `radiusNm` great-circle nm of `p`. */
export function zonesContaining(p: LatLon, zones: HazardZone[]): string[] {
  return zones.filter((z) => greatCircleNm(p, z.center) <= z.radiusNm).map((z) => z.id);
}
