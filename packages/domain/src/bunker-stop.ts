/**
 * The timeline of a bunker stop: waiting for a berth or the barge, then waiting for workable
 * weather (significant wave height at most BUNKERING_MAX_WAVE_M), then bunkering. Pure.
 */
import type { LatLon, StopTimeline, WeatherGrid } from "@pharos/shared";
import { BUNKERING_MAX_WAVE_M } from "./constants.js";
import { forecastStepAt, sampleWeather } from "./weather-effect.js";

const HOUR_MS = 3_600_000;
const MAX_STEPS = 10_000;

/**
 * Bunkering may start at `ready` = arrival + waiting. It starts at `ready` when the sample there is
 * workable, else at the first forecast step after `ready` whose sample is. A missing sample (outside
 * the grid or past the forecast) counts as workable and sets `beyondForecast`.
 */
export function stopTimeline(args: {
  arriveAt: Date;
  position: LatLon;
  waitingHours: number;
  bunkeringHours: number;
  weather: WeatherGrid | null;
}): StopTimeline {
  const { arriveAt, position, waitingHours, bunkeringHours, weather } = args;
  const readyMs = arriveAt.getTime() + waitingHours * HOUR_MS;
  let startMs = readyMs;
  let beyondForecast = true;
  if (weather) {
    const first = sampleWeather(weather, position, new Date(readyMs));
    if (first !== null) {
      beyondForecast = false;
      if (first.waveHeightM > BUNKERING_MAX_WAVE_M) {
        const stepMs = weather.stepHours * HOUR_MS;
        let k = Math.max(0, Math.ceil((readyMs - Date.parse(weather.startAt)) / stepMs));
        for (let i = 0; i < MAX_STEPS; i++, k++) {
          const t = forecastStepAt(weather, k);
          if (t.getTime() < readyMs) continue;
          const s = sampleWeather(weather, position, t);
          if (s === null || s.waveHeightM <= BUNKERING_MAX_WAVE_M) {
            startMs = t.getTime();
            beyondForecast = s === null;
            break;
          }
        }
      }
    }
  }
  return {
    arriveAt: arriveAt.toISOString(),
    waitingHours,
    weatherDelayHours: (startMs - readyMs) / HOUR_MS,
    bunkeringHours,
    departAt: new Date(startMs + bunkeringHours * HOUR_MS).toISOString(),
    beyondForecast,
  };
}
