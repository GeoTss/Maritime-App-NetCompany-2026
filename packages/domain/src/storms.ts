/**
 * Storm cells: forecast grid points over the heavy-weather limit around the time a walked track
 * passes them. They seed a detour candidate and the map; feasibility is decided per option from
 * its own sampled waves (`heavy_weather`). Pure.
 */
import type { LatLon, StormCell, WeatherGrid } from "@pharos/shared";
import { HEAVY_WEATHER_MAX_WAVE_M, STORM_CELL_RADIUS_NM, STORM_WINDOW_HOURS } from "./constants.js";
import { greatCircleNm } from "./geo.js";
import { forecastStepAt } from "./weather-effect.js";

const HOUR_MS = 3_600_000;

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
    if (first < 0) continue;
    cells.push({
      id: `storm:${pt.lat},${pt.lon}`,
      center: { lat: pt.lat, lon: pt.lon },
      radiusNm: STORM_CELL_RADIUS_NM,
      maxWaveHeightM: max,
      from: forecastStepAt(weather, first).toISOString(),
      to: forecastStepAt(weather, last).toISOString(),
    });
  }
  return cells.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
