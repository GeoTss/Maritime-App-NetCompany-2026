import type { LatLon, WeatherGrid } from "@pharos/shared";
import {
  MAX_SPEED_LOSS,
  MIN_SOG_KN,
  WAVE_LOSS_PCT_PER_M2,
  WEATHER_MAX_NM,
  WIND_LOSS_PCT_PER_KN,
  WIND_LOSS_THRESHOLD_KN,
} from "./constants.js";
import { greatCircleNm } from "./geo.js";

const HOUR_MS = 3_600_000;
const rad = (deg: number): number => (deg * Math.PI) / 180;

export interface WeatherSample {
  waveHeightM: number;
  /** Degrees true the waves come from. */
  waveDirDeg: number;
  windSpeedKn: number;
  /** Degrees true the wind comes from. */
  windDirDeg: number;
  currentSpeedKn: number;
  /** Degrees true the current flows to. */
  currentDirDeg: number;
}

/** Smallest angle between two bearings, degrees in [0, 180]. */
const angleBetween = (a: number, b: number): number =>
  Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** The time of forecast step `step`: startAt + step x stepHours. */
export const forecastStepAt = (grid: { startAt: string; stepHours: number }, step: number): Date =>
  new Date(new Date(grid.startAt).getTime() + step * grid.stepHours * HOUR_MS);

/**
 * Nearest grid point (great-circle) at the nearest time step (startAt + k x stepHours).
 * Null when no step lies within half a step of `at`, or the nearest point is over WEATHER_MAX_NM away.
 * A null field reads as 0.
 */
export function sampleWeather(grid: WeatherGrid, p: LatLon, at: Date): WeatherSample | null {
  let best: WeatherGrid["points"][number] | null = null;
  let bestNm = Number.POSITIVE_INFINITY;
  for (const pt of grid.points) {
    const nm = greatCircleNm(p, pt);
    if (nm < bestNm) {
      bestNm = nm;
      best = pt;
    }
  }
  if (!best || bestNm > WEATHER_MAX_NM) return null;
  const stepMs = grid.stepHours * HOUR_MS;
  const offset = at.getTime() - new Date(grid.startAt).getTime();
  const last = best.waveHeightM.length - 1;
  let k = Math.round(offset / stepMs);
  if (!Number.isFinite(k) || k < 0) return null;
  // A stationary point (a demo scenario weather area) holds its last step for the whole voyage.
  if (best.stationary && k > last) k = last;
  else if (k > last || Math.abs(offset - k * stepMs) > stepMs / 2) return null;
  const at0 = (s: (number | null)[]): number => s[k] ?? 0;
  return {
    waveHeightM: at0(best.waveHeightM),
    waveDirDeg: at0(best.waveDirDeg),
    windSpeedKn: at0(best.windSpeedKn),
    windDirDeg: at0(best.windDirDeg),
    currentSpeedKn: at0(best.currentSpeedKn),
    currentDirDeg: at0(best.currentDirDeg),
  };
}

/** Weight of the wave loss by the angle between the heading and where the waves come from. */
function waveWeight(angle: number): number {
  if (angle < 45) return 1;
  if (angle < 90) return 0.7;
  if (angle < 135) return 0.4;
  return 0.1;
}

/** Fraction of speed lost to waves and headwind, capped at MAX_SPEED_LOSS. */
export function speedLossFraction(s: WeatherSample, headingDeg: number): number {
  const wavePct =
    WAVE_LOSS_PCT_PER_M2 * s.waveHeightM ** 2 * waveWeight(angleBetween(headingDeg, s.waveDirDeg));
  const headwind = s.windSpeedKn * Math.cos(rad(angleBetween(headingDeg, s.windDirDeg)));
  const windPct = WIND_LOSS_PCT_PER_KN * Math.max(0, headwind - WIND_LOSS_THRESHOLD_KN);
  return Math.min(MAX_SPEED_LOSS, (wavePct + windPct) / 100);
}

/** Speed over ground: through-water speed less weather loss, plus the current along the heading; at least MIN_SOG_KN. */
export function effectiveSpeedKn(
  speedKn: number,
  s: WeatherSample | null,
  headingDeg: number,
): number {
  if (!s) return speedKn;
  const current = s.currentSpeedKn * Math.cos(rad(angleBetween(headingDeg, s.currentDirDeg)));
  return Math.max(MIN_SOG_KN, speedKn * (1 - speedLossFraction(s, headingDeg)) + current);
}

/** The same series, starting at a new time. */
export const shiftWeatherGrid = (grid: WeatherGrid, startAt: Date): WeatherGrid => ({
  ...grid,
  startAt: startAt.toISOString(),
});
