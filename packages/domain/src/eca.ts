import type { FuelGrade, LatLon } from "@pharos/shared";

/**
 * Planning-grade sulphur-emission-control areas following the MARPOL Annex VI Reg. 14 and
 * Appendix VII reference lines (rectangles approximating them; not legal boundaries):
 * - Mediterranean SOx ECA, MEPC.361(79), in force 1 May 2025: bounded west by the meridian
 *   5 deg 36' W and from the Black Sea by the parallel 41 deg N. Approximated as lat 30-46 and
 *   lon -5.6 to 36.5, minus the Bay of Biscay (lon < 0, lat > 42) and the Black Sea (lat > 41,
 *   lon > 26).
 * - North Sea: south of 62 deg N and east of 4 deg W (to the Baltic's western limit, 9.5 deg E);
 *   English Channel: east of 5 deg W and north of 48 deg 30' N.
 * - Baltic Sea: lat 53.5-66, lon 9.5-30.
 */
export function inSulphurEca(p: LatLon): boolean {
  const med = p.lat >= 30 && p.lat <= 46 && p.lon >= -5.6 && p.lon <= 36.5;
  const biscay = p.lon < 0 && p.lat > 42;
  const blackSea = p.lat > 41 && p.lon > 26;
  if (med && !biscay && !blackSea) return true;
  const northSea = p.lat >= 48.5 && p.lat <= 62 && p.lon >= -4 && p.lon < 9.5;
  const channel = p.lat >= 48.5 && p.lat <= 51.5 && p.lon >= -5 && p.lon < 9.5;
  const baltic = p.lat >= 53.5 && p.lat <= 66 && p.lon >= 9.5 && p.lon <= 30;
  return northSea || channel || baltic;
}

/** Fuel grade to burn at a position: LSMGO inside a sulphur ECA, else VLSFO. */
export const gradeAt = (p: LatLon): FuelGrade => (inSulphurEca(p) ? "LSMGO" : "VLSFO");
