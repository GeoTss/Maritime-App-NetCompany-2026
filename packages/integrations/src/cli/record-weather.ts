import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { WeatherGrid } from "@pharos/shared";
import { loadSeaNetwork } from "../routes/network.js";
import { addedRegionPoints, gridPoints } from "../weather/grid-points.js";
import { fetchWeatherGrid } from "../weather/open-meteo.js";
import { DEFAULT_SNAPSHOT_PATH } from "../weather/provider.js";

/**
 * Records the Open-Meteo forecast into the snapshot. Default: the demo region, replacing the file.
 * `--region added`: only the Track 3 region's points, merged in. Existing points stay byte-identical;
 * the new series are laid on the snapshot's own timeline (same start, step and length), and the
 * capture date is noted in the console output and the commit, not in the file.
 */
const added = process.argv.includes("--region") && process.argv.includes("added");
/** Only points a route could sample: within the sampling radius (120 nm) of a sea-lane point. */
function nearLanes(pts: { lat: number; lon: number }[]): { lat: number; lon: number }[] {
  const lane = loadSeaNetwork().segments.flat();
  const R = Math.PI / 180;
  const nm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    3440.065 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(((b.lat - a.lat) * R) / 2) ** 2 +
          Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(((b.lon - a.lon) * R) / 2) ** 2,
      ),
    );
  return pts.filter((p) =>
    lane.some(
      (q) => Math.abs(q.lat - p.lat) < 2.5 && Math.abs(q.lon - p.lon) < 3 && nm(q, p) <= 120,
    ),
  );
}
const points = added ? nearLanes(addedRegionPoints()) : gridPoints();
console.log(`fetching ${points.length} points from Open-Meteo...`);
// The added region is large: pace the batches under Open-Meteo's per-minute limit.
const grid = await fetchWeatherGrid({
  points,
  now: new Date(),
  ...(added ? { chunkDelayMs: 12_000 } : {}),
});
mkdirSync(dirname(DEFAULT_SNAPSHOT_PATH), { recursive: true });
if (!added) {
  writeFileSync(DEFAULT_SNAPSHOT_PATH, `${JSON.stringify(grid)}\n`);
} else {
  const base = WeatherGrid.parse(JSON.parse(readFileSync(DEFAULT_SNAPSHOT_PATH, "utf8")));
  const steps = base.points[0]?.waveHeightM.length ?? 0;
  if (grid.stepHours !== base.stepHours) {
    throw new Error(`step mismatch: snapshot ${base.stepHours} h, fetched ${grid.stepHours} h`);
  }
  const fit = (s: (number | null)[]) =>
    Array.from({ length: steps }, (_, k) => (k < s.length ? (s[k] ?? null) : null));
  const known = new Set(base.points.map((p) => `${p.lat},${p.lon}`));
  const extra = grid.points
    .filter((p) => !known.has(`${p.lat},${p.lon}`))
    .map((p) => ({
      ...p,
      waveHeightM: fit(p.waveHeightM),
      waveDirDeg: fit(p.waveDirDeg),
      windSpeedKn: fit(p.windSpeedKn),
      windDirDeg: fit(p.windDirDeg),
      currentSpeedKn: fit(p.currentSpeedKn),
      currentDirDeg: fit(p.currentDirDeg),
    }));
  const merged = WeatherGrid.parse({ ...base, points: [...base.points, ...extra] });
  writeFileSync(DEFAULT_SNAPSHOT_PATH, `${JSON.stringify(merged)}\n`);
  console.log(`merged ${extra.length} added-region sea points (fetched from ${grid.startAt})`);
}
console.log(
  `wrote ${DEFAULT_SNAPSHOT_PATH}: ${grid.points.length} sea points fetched, ${grid.points[0]?.waveHeightM.length ?? 0} steps of ${grid.stepHours} h from ${grid.startAt}`,
);
