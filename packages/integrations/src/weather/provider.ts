import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { shiftWeatherGrid } from "@pharos/domain";
import { WeatherGrid } from "@pharos/shared";
import { gridPoints } from "./grid-points.js";
import { fetchWeatherGrid, WeatherFetchError } from "./open-meteo.js";

export type WeatherMode = "live" | "recorded";
export interface WeatherLoad {
  grid: WeatherGrid;
  source: string;
  mode: WeatherMode;
}
export interface WeatherProvider {
  mode: WeatherMode;
  load(now: Date): Promise<WeatherLoad>;
}

export const DEFAULT_SNAPSHOT_PATH = fileURLToPath(
  new URL("../../../../fixtures/recorded/weather-snapshot.json", import.meta.url),
);

const floorToHour = (d: Date): Date => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);

export function createWeatherProvider(opts: {
  mode: WeatherMode;
  snapshotPath?: string;
  fetch?: typeof fetch;
}): WeatherProvider {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;

  const recorded = async (now: Date): Promise<WeatherLoad> => {
    let text: string;
    try {
      text = await readFile(snapshotPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `recorded weather snapshot not found at ${snapshotPath}; run npm run record:weather`,
        );
      }
      throw err;
    }
    const grid = WeatherGrid.parse(JSON.parse(text) as unknown);
    return {
      grid: shiftWeatherGrid(grid, floorToHour(now)),
      source: "open-meteo-recorded",
      mode: "recorded",
    };
  };

  return {
    mode: opts.mode,
    async load(now) {
      if (opts.mode === "recorded") return recorded(now);
      try {
        const grid = await fetchWeatherGrid({ points: gridPoints(), fetch: opts.fetch, now });
        return { grid, source: "open-meteo", mode: "live" };
      } catch (err) {
        if (!(err instanceof WeatherFetchError)) throw err;
        console.warn(`weather: live fetch failed (${err.message}); using recorded snapshot`);
        return recorded(now);
      }
    },
  };
}
