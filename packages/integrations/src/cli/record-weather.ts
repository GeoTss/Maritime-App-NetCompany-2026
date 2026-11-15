import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gridPoints } from "../weather/grid-points.js";
import { fetchWeatherGrid } from "../weather/open-meteo.js";
import { DEFAULT_SNAPSHOT_PATH } from "../weather/provider.js";

const points = gridPoints();
console.log(`fetching ${points.length} points from Open-Meteo...`);
const grid = await fetchWeatherGrid({ points, now: new Date() });
mkdirSync(dirname(DEFAULT_SNAPSHOT_PATH), { recursive: true });
writeFileSync(DEFAULT_SNAPSHOT_PATH, `${JSON.stringify(grid)}\n`);
console.log(
  `wrote ${DEFAULT_SNAPSHOT_PATH}: ${grid.points.length} sea points, ${grid.points[0]?.waveHeightM.length ?? 0} steps of ${grid.stepHours} h from ${grid.startAt}`,
);
