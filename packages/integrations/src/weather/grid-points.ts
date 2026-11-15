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
