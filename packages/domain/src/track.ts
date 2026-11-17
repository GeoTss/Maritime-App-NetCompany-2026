/**
 * The one walk along a polyline that the route optimiser and the fuel projection share: the track
 * cut into sub-steps of at most `stepNm`, each walked at the speed over ground the weather allows.
 */
import type { FuelGrade, LatLon, WeatherGrid } from "@pharos/shared";
import { gradeAt } from "./eca.js";
import { bearingDeg, greatCircleNm } from "./geo.js";
import { effectiveSpeedKn, sampleWeather } from "./weather-effect.js";

const HOUR_MS = 3_600_000;

export interface SubStep {
  mid: LatLon;
  /** Where the sub-step starts and ends. */
  start: LatLon;
  end: LatLon;
  headingDeg: number;
  nm: number;
  grade: FuelGrade;
  /** Index in the polyline of the point that ends this sub-step's segment. */
  pointIndexAfter: number;
}

/** Linear in lat/lon between a and b (as `pointAlongPolyline` does within a segment). */
export const lerp = (a: LatLon, b: LatLon, t: number): LatLon => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t,
});

/**
 * The polyline cut into sub-steps: each segment is split into equal pieces no longer than `stepNm`.
 * Zero-length segments (repeated points) are skipped. Speed-independent, so computed once per route.
 */
export function subSteps(
  points: LatLon[],
  stepNm: number,
): { steps: SubStep[]; distanceNm: number } {
  const steps: SubStep[] = [];
  let distanceNm = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LatLon;
    const b = points[i] as LatLon;
    const len = greatCircleNm(a, b);
    if (!(len > 0)) continue;
    distanceNm += len;
    const n = Math.max(1, Math.ceil(len / stepNm));
    for (let j = 0; j < n; j++) {
      const mid = lerp(a, b, (j + 0.5) / n);
      const start = lerp(a, b, j / n);
      const end = lerp(a, b, (j + 1) / n);
      steps.push({
        mid,
        start,
        end,
        headingDeg: bearingDeg(start, end),
        nm: len / n,
        grade: gradeAt(mid),
        pointIndexAfter: i,
      });
    }
  }
  return { steps, distanceNm };
}

export interface WalkedStep extends SubStep {
  startAt: Date;
  hours: number;
  sogKn: number;
  /** Wave height sampled for the sub-step; null when the weather had no sample there. */
  waveHeightM: number | null;
}

/** A pause in the walk at a polyline point: `hours` gets the arrival time and returns the stay. */
export interface WalkPause {
  pointIndex: number;
  hours: (arriveAt: Date) => number;
}

/**
 * Walks the sub-steps at `speedKn` through the water: each takes the weather at its midpoint at the
 * time the vessel starts it, and the speed over ground from `effectiveSpeedKn` on its heading. With
 * `pause`, the walk stops before the first sub-step past `pause.pointIndex` for the hours it returns.
 */
export function walkSteps(
  steps: SubStep[],
  startAt: Date,
  speedKn: number,
  weather: WeatherGrid | null,
  pause?: WalkPause,
): WalkedStep[] {
  const startMs = startAt.getTime();
  const out: WalkedStep[] = [];
  let elapsed = 0;
  let paused = pause === undefined;
  for (const step of steps) {
    if (!paused && pause && step.pointIndexAfter > pause.pointIndex) {
      elapsed += pause.hours(new Date(startMs + elapsed * HOUR_MS));
      paused = true;
    }
    const sample = weather
      ? sampleWeather(weather, step.mid, new Date(startMs + elapsed * HOUR_MS))
      : null;
    const sogKn = effectiveSpeedKn(speedKn, sample, step.headingDeg);
    const hours = step.nm / sogKn;
    out.push({
      ...step,
      startAt: new Date(startMs + elapsed * HOUR_MS),
      hours,
      sogKn,
      waveHeightM: sample ? sample.waveHeightM : null,
    });
    elapsed += hours;
  }
  return out;
}
