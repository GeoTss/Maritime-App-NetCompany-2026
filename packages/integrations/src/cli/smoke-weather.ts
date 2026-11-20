import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WeatherGrid } from "@pharos/shared";
import { fetchWeatherGrid } from "../weather/open-meteo.js";
import { DEFAULT_SNAPSHOT_PATH } from "../weather/provider.js";

const POINTS = [
  { lat: 40, lon: 0 },
  { lat: 36, lon: -6 },
  { lat: 50, lon: 0 },
  { lat: 54, lon: 6 },
];

const at = new Date();
const summary: Record<string, unknown> = { at: at.toISOString(), requestedPoints: POINTS.length };

/** Writes evals/reports/<ts>-smoke-weather/summary.json, as smoke:ais does. */
function writeSummary() {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const dir = join("evals", "reports", `${stamp}-smoke-weather`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

try {
  const grid = await fetchWeatherGrid({ points: POINTS, now: at });
  Object.assign(summary, {
    livePoints: grid.points.length,
    steps: grid.points[0]?.waveHeightM.length ?? 0,
    startAt: grid.startAt,
  });
  console.log(
    `live: ${grid.points.length} of ${POINTS.length} points, ${grid.points[0]?.waveHeightM.length} steps from ${grid.startAt}`,
  );
  if (grid.points.length === 0) throw new Error("live fetch returned no sea points");
  if (existsSync(DEFAULT_SNAPSHOT_PATH)) {
    const snap = WeatherGrid.parse(
      JSON.parse(readFileSync(DEFAULT_SNAPSHOT_PATH, "utf8")) as unknown,
    );
    Object.assign(summary, { snapshotPoints: snap.points.length, snapshotStartAt: snap.startAt });
    console.log(`snapshot: ${snap.points.length} points from ${snap.startAt}`);
  } else {
    Object.assign(summary, { snapshotPoints: null, snapshotStartAt: null });
    console.log("snapshot: not recorded yet");
  }
  writeSummary();
} catch (err) {
  summary.error = (err as Error).message;
  writeSummary();
  console.error(`smoke:weather failed: ${(err as Error).message}`);
  process.exit(1);
}
