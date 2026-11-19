/**
 * Distance from land, for where holding-tank sewage may go overboard. The coastline arrives as
 * rings (from the bundled Natural Earth land, loaded outside the domain); the index buckets each
 * segment into the lat/lon cells its box touches, so a query looks at a few cells only. Distances
 * are planning-grade: a local equirectangular projection, 1° of latitude = 60 nm. Pure.
 */
import type { LatLon } from "@pharos/shared";
import { COAST_CELL_DEG } from "./constants.js";

type Segment = readonly [LatLon, LatLon];

export interface CoastIndex {
  cellDeg: number;
  cells: Map<string, Segment[]>;
}

const key = (i: number, j: number) => `${i}:${j}`;

export function buildCoastIndex(rings: LatLon[][], cellDeg: number = COAST_CELL_DEG): CoastIndex {
  const cells = new Map<string, Segment[]>();
  for (const ring of rings) {
    for (let k = 1; k < ring.length; k++) {
      const a = ring[k - 1] as LatLon;
      const b = ring[k] as LatLon;
      const seg: Segment = [a, b];
      const i0 = Math.floor(Math.min(a.lat, b.lat) / cellDeg);
      const i1 = Math.floor(Math.max(a.lat, b.lat) / cellDeg);
      const j0 = Math.floor(Math.min(a.lon, b.lon) / cellDeg);
      const j1 = Math.floor(Math.max(a.lon, b.lon) / cellDeg);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = cells.get(key(i, j));
          if (list) list.push(seg);
          else cells.set(key(i, j), [seg]);
        }
      }
    }
  }
  return { cellDeg, cells };
}

/** Point-to-segment distance (nm) in a projection local to `p`. */
function segmentNm(p: LatLon, [a, b]: Segment): number {
  const kx = 60 * Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * 60;
  const bx = (b.lon - p.lon) * kx;
  const by = (b.lat - p.lat) * 60;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Whether any coastline segment lies within `nm` of `p`. */
export function withinNmOfLand(p: LatLon, index: CoastIndex, nm: number): boolean {
  const { cellDeg, cells } = index;
  const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.01);
  const di = Math.ceil(nm / 60 / cellDeg) + 1;
  const dj = Math.ceil(nm / 60 / cosLat / cellDeg) + 1;
  const i0 = Math.floor(p.lat / cellDeg);
  const j0 = Math.floor(p.lon / cellDeg);
  for (let i = i0 - di; i <= i0 + di; i++) {
    for (let j = j0 - dj; j <= j0 + dj; j++) {
      for (const seg of cells.get(key(i, j)) ?? []) if (segmentNm(p, seg) <= nm) return true;
    }
  }
  return false;
}
