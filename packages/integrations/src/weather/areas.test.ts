import type { ScenarioWeatherArea, WeatherGrid } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { pointsInArea, withWeatherAreas } from "./areas.js";

const series = (v: number) => [v, v, v];
const point = (lat: number, lon: number) => ({
  lat,
  lon,
  waveHeightM: series(1),
  waveDirDeg: series(300),
  windSpeedKn: series(10),
  windDirDeg: series(310),
  currentSpeedKn: series(0.2),
  currentDirDeg: series(90),
});
const grid: WeatherGrid = {
  startAt: "2026-11-14T06:00:00Z",
  stepHours: 3,
  points: [point(34, 20), point(34, 22), point(36, 20)],
};
const area = (over: Partial<ScenarioWeatherArea> = {}): ScenarioWeatherArea => ({
  id: 1,
  from: null,
  until: null,
  label: "Gale",
  center: { lat: 34, lon: 21 },
  radiusNm: 60,
  waveHeightM: 8,
  waveDirDeg: 270,
  windSpeedKn: 45,
  windDirDeg: 280,
  ...over,
});

describe("withWeatherAreas", () => {
  it("lays the area's weather on every step of the points inside, marked synthetic", () => {
    const out = withWeatherAreas(grid, [area()]);
    const [a, b, c] = out.points;
    for (const p of [a, b]) {
      expect(p?.waveHeightM).toEqual([8, 8, 8]);
      expect(p?.windDirDeg).toEqual([280, 280, 280]);
      expect(p?.currentSpeedKn).toEqual([0.2, 0.2, 0.2]);
      expect(p?.synthetic).toBe(true);
      // It holds through its window, past the forecast too.
      expect(p?.scenario).toMatchObject({
        waveHeightM: 8,
        windSpeedKn: 45,
        from: null,
        until: null,
      });
    }
    expect(c).toEqual(grid.points[2]);
  });

  it("a later area wins where two overlap; none leaves the grid as it is", () => {
    const out = withWeatherAreas(grid, [
      area(),
      area({ id: 2, waveHeightM: 3, radiusNm: 30, center: { lat: 34, lon: 22 } }),
    ]);
    expect(out.points[0]?.waveHeightM[0]).toBe(8);
    expect(out.points[1]?.waveHeightM[0]).toBe(3);
    expect(withWeatherAreas(grid, [])).toBe(grid);
  });

  it("counts the points an area holds", () => {
    expect(pointsInArea(grid, area())).toBe(2);
    expect(pointsInArea(grid, area({ center: { lat: 30, lon: 10 }, radiusNm: 30 }))).toBe(0);
  });

  it("only the steps inside its window change; the window rides along for later", () => {
    // Steps at 06:00, 09:00, 12:00: a window from 08:00 to 10:00 holds the 09:00 step only.
    const out = withWeatherAreas(grid, [
      area({ from: "2026-11-14T08:00:00Z", until: "2026-11-14T10:00:00Z" }),
    ]);
    expect(out.points[0]?.waveHeightM).toEqual([1, 8, 1]);
    expect(out.points[0]?.scenario?.until).toBe("2026-11-14T10:00:00Z");
  });
});
