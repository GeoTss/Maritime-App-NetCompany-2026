/**
 * Where a route enters sea areas drawn as lat/lon boxes (chart and publication coverage now;
 * piracy areas and canals later). Pure.
 */
import type { AreaSpan, Box, LatLon } from "@pharos/shared";
import { subSteps } from "./track.js";

export interface Area {
  id: string;
  boxes: Box[];
}

/** Where a route enters an area (the first sub-step midpoint inside). */
export interface AreaPass {
  areaId: string;
  /** Distance along the polyline (nm) to the end of the first sub-step whose midpoint is inside. */
  enterNm: number;
}

export const inBox = (p: LatLon, b: Box): boolean =>
  p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;

export const inArea = (p: LatLon, boxes: Box[]): boolean => boxes.some((b) => inBox(p, b));

/**
 * The areas the route enters, each with the distance at which it first does (sub-steps of at most
 * `stepNm`, tested at their midpoints). Sorted by distance, then id.
 */
export function areaPasses(points: LatLon[], stepNm: number, areas: Area[]): AreaPass[] {
  const { steps } = subSteps(points, stepNm);
  const out: AreaPass[] = [];
  for (const area of areas) {
    let nm = 0;
    for (const step of steps) {
      nm += step.nm;
      if (inArea(step.mid, area.boxes)) {
        out.push({ areaId: area.id, enterNm: nm });
        break;
      }
    }
  }
  return out.sort(
    (a, b) => a.enterNm - b.enterNm || (a.areaId < b.areaId ? -1 : a.areaId > b.areaId ? 1 : 0),
  );
}

/**
 * Where a walked track is inside each area: from the start of the first sub-step whose midpoint is
 * inside to the end of the last, and the hours of the sub-steps inside. Sorted by entry, then id.
 */
export function areaSpansOfSteps(
  steps: { mid: LatLon; nm: number; hours: number }[],
  areas: Area[],
): AreaSpan[] {
  const out: AreaSpan[] = [];
  for (const area of areas) {
    let nm = 0;
    let enterNm = -1;
    let exitNm = 0;
    let hoursInside = 0;
    for (const step of steps) {
      if (inArea(step.mid, area.boxes)) {
        if (enterNm < 0) enterNm = nm;
        exitNm = nm + step.nm;
        hoursInside += step.hours;
      }
      nm += step.nm;
    }
    if (enterNm >= 0) out.push({ areaId: area.id, enterNm, exitNm, hoursInside });
  }
  return out.sort(
    (a, b) => a.enterNm - b.enterNm || (a.areaId < b.areaId ? -1 : a.areaId > b.areaId ? 1 : 0),
  );
}
