/** Open-Meteo marine + forecast clients: raw hourly observations only; all maths stays in the domain. */
import { kmhToKn } from "@pharos/domain";
import {
  type LatLon,
  OpenMeteoForecastResponse,
  OpenMeteoMarineResponse,
  WeatherGrid,
  type WeatherPoint,
} from "@pharos/shared";

export class WeatherFetchError extends Error {
  override name = "WeatherFetchError";
}

const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CHUNK = 50;
const FORECAST_DAYS = 10;
const STEP_HOURS = 3;
const CHUNK_DELAY_MS = 250;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const asList = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

const REQUEST_TIMEOUT_MS = 15_000;

async function getJson(f: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new WeatherFetchError(`Open-Meteo request failed: ${(err as Error).message}`);
  }
  if (res.status !== 200) throw new WeatherFetchError(`Open-Meteo answered HTTP ${res.status}`);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new WeatherFetchError("Open-Meteo answered with invalid JSON");
  }
}

const query = (chunk: LatLon[], hourly: string, extra = ""): string =>
  `latitude=${chunk.map((p) => p.lat).join(",")}&longitude=${chunk.map((p) => p.lon).join(",")}` +
  `&hourly=${hourly}${extra}&forecast_days=${FORECAST_DAYS}&timezone=GMT`;

const every3 = (s: (number | null)[] | undefined, n: number, conv: (v: number) => number) =>
  Array.from({ length: n }, (_, i) => {
    const v = s?.[i * STEP_HOURS];
    return v == null ? null : round1(conv(v));
  });

export async function fetchWeatherGrid(opts: {
  points: LatLon[];
  fetch?: typeof fetch;
  now: Date;
  /** Per-request timeout; a hung connection becomes a WeatherFetchError. */
  timeoutMs?: number;
}): Promise<WeatherGrid> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const f = opts.fetch ?? fetch;
  const points: WeatherPoint[] = [];
  let startAt: string | null = null;
  let seriesLen = 0;

  for (let i = 0; i < opts.points.length; i += CHUNK) {
    if (i > 0) await sleep(CHUNK_DELAY_MS);
    const chunk = opts.points.slice(i, i + CHUNK);
    const marineRaw = await getJson(
      f,
      `${MARINE_URL}?${query(chunk, "wave_height,wave_direction,ocean_current_velocity,ocean_current_direction")}`,
      timeoutMs,
    );
    const forecastRaw = await getJson(
      f,
      `${FORECAST_URL}?${query(chunk, "wind_speed_10m,wind_direction_10m", "&wind_speed_unit=kn")}`,
      timeoutMs,
    );
    const marineP = OpenMeteoMarineResponse.safeParse(marineRaw);
    const forecastP = OpenMeteoForecastResponse.safeParse(forecastRaw);
    if (!marineP.success || !forecastP.success) {
      throw new WeatherFetchError("Open-Meteo payload failed validation");
    }
    const marine = asList(marineP.data);
    const forecast = asList(forecastP.data);
    if (marine.length !== chunk.length || forecast.length !== chunk.length) {
      throw new WeatherFetchError("Open-Meteo returned a different number of locations");
    }

    chunk.forEach((p, k) => {
      const m = marine[k]!.hourly;
      const w = forecast[k]!.hourly;
      const first = m.time[0];
      if (!first || m.time.length !== w.time.length || first !== w.time[0]) {
        throw new WeatherFetchError("Open-Meteo marine and forecast times do not line up");
      }
      const n = Math.ceil(m.time.length / STEP_HOURS);
      const start = new Date(`${first}:00Z`).toISOString();
      startAt ??= start;
      seriesLen = n;
      const wave = every3(m.wave_height, n, (v) => v);
      if (wave.every((v) => v === null)) return; // land
      points.push({
        lat: p.lat,
        lon: p.lon,
        waveHeightM: wave,
        waveDirDeg: every3(m.wave_direction, n, (v) => v),
        windSpeedKn: every3(w.wind_speed_10m, n, (v) => v),
        windDirDeg: every3(w.wind_direction_10m, n, (v) => v),
        currentSpeedKn: every3(m.ocean_current_velocity, n, kmhToKn),
        currentDirDeg: every3(m.ocean_current_direction, n, (v) => v),
      });
    });
  }

  if (!startAt || seriesLen === 0) {
    throw new WeatherFetchError("Open-Meteo returned no hourly data");
  }
  const grid = WeatherGrid.safeParse({ startAt, stepHours: STEP_HOURS, points });
  if (!grid.success) throw new WeatherFetchError("assembled weather grid failed validation");
  return grid.data;
}
