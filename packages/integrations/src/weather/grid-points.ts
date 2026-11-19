import type { LatLon } from "@pharos/shared";

export const DEMO_REGION = { minLat: 30, maxLat: 56, minLon: -12, maxLon: 34 } as const;

/** Regular lat/lon grid over the demo region (14 x 24 = 336 points at 2 degrees). */
export function gridPoints(stepDeg = 2): LatLon[] {
  const pts: LatLon[] = [];
  for (let lat = DEMO_REGION.minLat; lat <= DEMO_REGION.maxLat; lat += stepDeg) {
    for (let lon = DEMO_REGION.minLon; lon <= DEMO_REGION.maxLon; lon += stepDeg) {
      pts.push({ lat, lon });
    }
  }
  return pts;
}

/**
 * The region the map and sea lanes gained for Track 3 (the Red Sea, the Arabian Sea, Africa to the
 * Cape and the Gulf of Guinea), as 2° points outside `DEMO_REGION`. Only the recorder uses it:
 * `npm run record:weather -- --region added` merges these into the recorded snapshot.
 */
export const ADDED_REGION = { minLat: -38, maxLat: 56, minLon: -24, maxLon: 70 } as const;

export function addedRegionPoints(stepDeg = 2): LatLon[] {
  const inDemo = (p: LatLon) =>
    p.lat >= DEMO_REGION.minLat &&
    p.lat <= DEMO_REGION.maxLat &&
    p.lon >= DEMO_REGION.minLon &&
    p.lon <= DEMO_REGION.maxLon;
  const pts: LatLon[] = [];
  for (let lat = ADDED_REGION.minLat; lat <= ADDED_REGION.maxLat; lat += stepDeg) {
    for (let lon = ADDED_REGION.minLon; lon <= ADDED_REGION.maxLon; lon += stepDeg) {
      if (!inDemo({ lat, lon })) pts.push({ lat, lon });
    }
  }
  return pts;
}
