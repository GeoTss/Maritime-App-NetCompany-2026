import type { WeatherView } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { dartFeatures } from "./weather-darts";

const view = (points: WeatherView["points"]): WeatherView => ({
  snapshotId: 1,
  source: "test",
  forecastStart: null,
  fetchedAt: "2026-11-14T08:00:00.000Z",
  startAt: "2026-11-14T08:00:00.000Z",
  stepHours: 3,
  steps: 1,
  step: 0,
  validAt: "2026-11-14T08:00:00.000Z",
  stepTimes: ["2026-11-14T08:00:00.000Z"],
  heavyWeatherWaveM: 6,
  points,
});

const point = (p: Partial<WeatherView["points"][number]>) => ({
  lat: 36,
  lon: 20,
  waveHeightM: null,
  waveDirDeg: null,
  windSpeedKn: null,
  windDirDeg: null,
  ...p,
});

describe("dartFeatures", () => {
  it("dart points where waves travel", () => {
    const fc = dartFeatures(view([point({ waveHeightM: 2.5, waveDirDeg: 270 })]), "waves");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties).toMatchObject({ v: 2.5, dir: 90 });
    expect(fc.features[0]?.geometry.coordinates).toEqual([20, 36]);
  });

  it("null direction draws no dart", () => {
    const fc = dartFeatures(view([point({ waveHeightM: 3, waveDirDeg: null })]), "waves");
    expect(fc.features).toHaveLength(0);
  });

  it("wind uses wind fields", () => {
    const fc = dartFeatures(
      view([point({ waveHeightM: 1, waveDirDeg: 0, windSpeedKn: 34, windDirDeg: 10 })]),
      "wind",
    );
    expect(fc.features[0]?.properties).toMatchObject({ v: 34, dir: 190 });
  });

  it("zoomed out, every other point is kept, in a checkerboard of the grid", () => {
    const grid = [];
    for (const lat of [30, 32, 34])
      for (const lon of [10, 12, 14]) grid.push(point({ lat, lon, waveHeightM: 1, waveDirDeg: 0 }));
    const kept = dartFeatures(view(grid), "waves").features.filter((f) => f.properties.keep);
    expect(kept.map((f) => f.geometry.coordinates)).toEqual([
      [10, 30],
      [14, 30],
      [12, 32],
      [10, 34],
      [14, 34],
    ]);
  });
});
