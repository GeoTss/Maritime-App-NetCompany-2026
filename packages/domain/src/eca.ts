import type { FuelGrade, LatLon } from "@pharos/shared";

/**
 * Planning-grade sulphur-emission-control boxes. Source: MARPOL Annex VI Reg. 14 / Appendix VII
 * (Mediterranean SOx ECA from 1 May 2025; Baltic Sea, North Sea and English Channel). Rectangles
 * only; not legal boundaries.
 */
export function inSulphurEca(p: LatLon): boolean {
  const med = p.lat >= 30 && p.lat <= 46 && p.lon >= -5.6 && p.lon <= 36.5;
  const biscay = p.lon < 0 && p.lat > 42;
  if (med && !biscay) return true;
  return p.lat >= 48.5 && p.lat <= 66 && p.lon >= -5 && p.lon <= 30;
}

/** Fuel grade to burn at a position: LSMGO inside a sulphur ECA, else VLSFO. */
export const gradeAt = (p: LatLon): FuelGrade => (inSulphurEca(p) ? "LSMGO" : "VLSFO");
