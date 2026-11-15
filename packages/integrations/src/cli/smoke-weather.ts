import { existsSync, readFileSync } from "node:fs";
import { WeatherGrid } from "@pharos/shared";
import { fetchWeatherGrid } from "../weather/open-meteo.js";
import { DEFAULT_SNAPSHOT_PATH } from "../weather/provider.js";

try {
  const grid = await fetchWeatherGrid({
    points: [
      { lat: 40, lon: 0 },
      { lat: 36, lon: -6 },
      { lat: 50, lon: 0 },
      { lat: 54, lon: 6 },
    ],
    now: new Date(),
  });
  console.log(
    `live: ${grid.points.length} of 4 points, ${grid.points[0]?.waveHeightM.length} steps from ${grid.startAt}`,
  );
  if (grid.points.length === 0) throw new Error("live fetch returned no sea points");
  if (existsSync(DEFAULT_SNAPSHOT_PATH)) {
    const snap = WeatherGrid.parse(
      JSON.parse(readFileSync(DEFAULT_SNAPSHOT_PATH, "utf8")) as unknown,
    );
    console.log(`snapshot: ${snap.points.length} points from ${snap.startAt}`);
  } else {
    console.log("snapshot: not recorded yet");
  }
} catch (err) {
  console.error(`smoke:weather failed: ${(err as Error).message}`);
  process.exit(1);
}
