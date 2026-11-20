/**
 * Storm cells: forecast grid points over the heavy-weather limit around the time a walked track
 * passes them, and demo scenario storms the track meets while they are on (past the forecast too). They seed a detour candidate and the map; feasibility is decided per option from
 * its own sampled waves (`heavy_weather`). Pure.
 */
import type { Box, LatLon, StormCell, WeatherGrid } from "@pharos/shared";
import { HEAVY_WEATHER_MAX_WAVE_M, STORM_CELL_RADIUS_NM, STORM_WINDOW_HOURS } from "./constants.js";
import { greatCircleNm } from "./geo.js";
import { forecastStepAt, scenarioOn } from "./weather-effect.js";

const HOUR_MS = 3_600_000;

/** Half the smallest gap between the grid's distinct values; null with fewer than two. */
function halfStep(values: number[]): number | null {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i++)
    gap = Math.min(gap, (sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
  return Number.isFinite(gap) ? gap / 2 : null;
}

/**
 * Half a grid step in latitude and longitude, from the grid's own points. A grid with one row (or
 * one column) uses the other direction's step for both.
 */
function gridHalfSteps(weather: WeatherGrid): { lat: number; lon: number } {
  const lat = halfStep(weather.points.map((p) => p.lat));
  const lon = halfStep(weather.points.map((p) => p.lon));
  return { lat: lat ?? lon ?? 0, lon: lon ?? lat ?? 0 };
}

const squareOf = (p: LatLon, half: { lat: number; lon: number }): Box => ({
  minLat: p.lat - half.lat,
  maxLat: p.lat + half.lat,
  minLon: p.lon - half.lon,
  maxLon: p.lon + half.lon,
});

/**
 * Each grid point within `STORM_CELL_RADIUS_NM` of a walked midpoint whose wave height exceeds
 * `HEAVY_WEATHER_MAX_WAVE_M` at a forecast step within ± `STORM_WINDOW_HOURS` of the time the walk
 * is there. `maxWaveHeightM`, `from` and `to` cover those steps. Sorted by id; [] without weather.
 */
export function stormCells(
  weather: WeatherGrid | null,
  walked: { mid: LatLon; startAt: Date }[],
): StormCell[] {
  if (!weather || walked.length === 0) return [];
  const windowMs = STORM_WINDOW_HOURS * HOUR_MS;
  const half = gridHalfSteps(weather);
  const cells: StormCell[] = [];
  for (const pt of weather.points) {
    let first = -1;
    let last = -1;
    let max = 0;
    for (const w of walked) {
      if (greatCircleNm(w.mid, pt) > STORM_CELL_RADIUS_NM) continue;
      const t = w.startAt.getTime();
      pt.waveHeightM.forEach((h, k) => {
        if (h === null || h <= HEAVY_WEATHER_MAX_WAVE_M) return;
        if (Math.abs(forecastStepAt(weather, k).getTime() - t) > windowMs) return;
        if (first < 0 || k < first) first = k;
        if (k > last) last = k;
        if (h > max) max = h;
      });
    }
    // A demo scenario storm: met when the walk is near while it is on, past the forecast too.
    const sc = pt.scenario;
    if (sc && sc.waveHeightM > HEAVY_WEATHER_MAX_WAVE_M) {
      const met = walked.filter(
        (w) => greatCircleNm(w.mid, pt) <= STORM_CELL_RADIUS_NM && scenarioOn(sc, w.startAt),
      );
      const firstMet = met[0];
      const lastMet = met[met.length - 1];
      if (firstMet && lastMet) {
        cells.push({
          id: `storm:${pt.lat},${pt.lon}`,
          center: { lat: pt.lat, lon: pt.lon },
          radiusNm: STORM_CELL_RADIUS_NM,
          maxWaveHeightM: Math.max(max, sc.waveHeightM),
          from: sc.from ?? firstMet.startAt.toISOString(),
          to: sc.until ?? lastMet.startAt.toISOString(),
          box: squareOf(pt, half),
          ...(pt.synthetic ? { synthetic: true as const } : {}),
          scenario: true,
        });
        continue;
      }
    }
    if (first < 0) continue;
    cells.push({
      id: `storm:${pt.lat},${pt.lon}`,
      center: { lat: pt.lat, lon: pt.lon },
      radiusNm: STORM_CELL_RADIUS_NM,
      maxWaveHeightM: max,
      from: forecastStepAt(weather, first).toISOString(),
      to: forecastStepAt(weather, last).toISOString(),
      box: squareOf(pt, half),
      ...(pt.synthetic ? { synthetic: true as const } : {}),
    });
  }
  return cells.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A storm on the grid wherever a route goes: where, how heavy, and when it is over the limit. */
export interface StormArea {
  id: string;
  center: LatLon;
  radiusNm: number;
  maxWaveHeightM: number;
  from: string;
  /** Null: a scenario storm with no end set. */
  until: string | null;
  synthetic: boolean;
}

/**
 * Every grid point over the heavy-weather limit at some time: a forecast storm is on from its first
 * to its last step over the limit; a demo scenario storm through its window (an open start is the
 * forecast's start). For the voyage timeline, which says whether a route passes while it is on.
 */
export function stormAreas(weather: WeatherGrid | null): StormArea[] {
  if (!weather) return [];
  const areas: StormArea[] = [];
  for (const pt of weather.points) {
    const base = {
      id: `storm:${pt.lat},${pt.lon}`,
      center: { lat: pt.lat, lon: pt.lon },
      radiusNm: STORM_CELL_RADIUS_NM,
      synthetic: pt.synthetic === true,
    };
    const sc = pt.scenario;
    if (sc && sc.waveHeightM > HEAVY_WEATHER_MAX_WAVE_M) {
      areas.push({
        ...base,
        maxWaveHeightM: sc.waveHeightM,
        from: sc.from ?? weather.startAt,
        until: sc.until,
      });
      continue;
    }
    let first = -1;
    let last = -1;
    let max = 0;
    pt.waveHeightM.forEach((h, k) => {
      if (h === null || h <= HEAVY_WEATHER_MAX_WAVE_M) return;
      if (first < 0) first = k;
      last = k;
      max = Math.max(max, h);
    });
    if (first < 0) continue;
    areas.push({
      ...base,
      maxWaveHeightM: max,
      from: forecastStepAt(weather, first).toISOString(),
      until: forecastStepAt(weather, last).toISOString(),
    });
  }
  return areas.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
