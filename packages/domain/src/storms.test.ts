import type { RouteCandidate, RouteSpeedInput, WeatherGrid } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { evaluateRoute, optimiseRouteSpeed } from "./route-optimiser.js";
import { stormAreas, stormCells } from "./storms.js";
import { subSteps, walkSteps } from "./track.js";

const START = "2026-11-14T00:00:00.000Z";
const A: RouteCandidate = {
  id: "A",
  label: "Direct",
  points: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 10 },
  ],
};

/** Calm 1 m seas every 0.5° along the equator; 8 m at 4.5–5.5° E for the steps at 27–33 h. */
function passingStorm(): WeatherGrid {
  const steps = 30;
  const points = [];
  for (let lon = 0; lon <= 10; lon += 0.5) {
    const storm = lon >= 4.5 && lon <= 5.5;
    points.push({
      lat: 0,
      lon,
      waveHeightM: Array.from({ length: steps }, (_, k) => (storm && k >= 9 && k <= 11 ? 8 : 1)),
      waveDirDeg: Array.from({ length: steps }, () => 90),
      windSpeedKn: Array.from({ length: steps }, () => 0),
      windDirDeg: Array.from({ length: steps }, () => 0),
      currentSpeedKn: Array.from({ length: steps }, () => 0),
      currentDirDeg: Array.from({ length: steps }, () => 0),
    });
  }
  return { startAt: START, stepHours: 3, points };
}

const input = (weather: WeatherGrid | null): RouteSpeedInput => ({
  startAt: START,
  candidates: [A],
  baseline: { candidateId: "A", speedKn: 12 },
  curve: { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 9, maxSpeedKn: 14.5 },
  speedStepKn: 0.5,
  stepNm: 20,
  arriveBy: null,
  notBefore: null,
  dailyCostUsd: 16_000,
  fuelPriceUsdPerMt: { LSMGO: 820, VLSFO: 610, HSFO: 480 },
  etsCoverage: 0,
  market: { euaPriceEur: 75, eurUsd: 1.08, year: 2026 },
  weather,
  hazards: [],
  fuel: null,
  stops: [],
});

describe("heavy weather", () => {
  it("heavy weather by speed: 12 kn meets the storm, 14.5 kn passes before it", () => {
    const i = input(passingStorm());
    expect(evaluateRoute(i, A, 12).reasons).toContain("heavy_weather");
    expect(evaluateRoute(i, A, 14.5).reasons).not.toContain("heavy_weather");
    const best = optimiseRouteSpeed(i).options[0];
    expect(best?.reasons).not.toContain("heavy_weather");
    expect(best?.feasible).toBe(true);
  });

  it("stormCells finds the cells the baseline meets, with their worst wave", () => {
    const w = passingStorm();
    const walked = walkSteps(subSteps(A.points, 20).steps, new Date(START), 12, w);
    const cells = stormCells(w, walked);
    expect(cells.map((c) => c.id)).toEqual(["storm:0,4.5", "storm:0,5", "storm:0,5.5"]);
    expect(cells[1]?.maxWaveHeightM).toBe(8);
    expect(cells[1]?.from).toBe("2026-11-15T03:00:00.000Z");
  });

  it("gives each cell the grid square it stands for, from the grid's own spacing", () => {
    const w = passingStorm();
    const walked = walkSteps(subSteps(A.points, 20).steps, new Date(START), 12, w);
    // One row of points 0.5° apart: half a step each way; one latitude, so the lon step is used.
    expect(stormCells(w, walked)[1]?.box).toEqual({
      minLat: -0.25,
      maxLat: 0.25,
      minLon: 4.75,
      maxLon: 5.25,
    });
  });

  it("no weather, no storm", () => {
    const walked = walkSteps(subSteps(A.points, 20).steps, new Date(START), 12, null);
    expect(stormCells(null, walked)).toEqual([]);
    expect(evaluateRoute(input(null), A, 12).reasons).not.toContain("heavy_weather");
  });
});

describe("synthetic storm cells", () => {
  it("carry the synthetic flag of their grid point", () => {
    const w = passingStorm();
    const synthetic = {
      ...w,
      points: w.points.map((p) => (p.lon === 5 ? { ...p, synthetic: true as const } : p)),
    };
    const walked = walkSteps(subSteps(A.points, 20).steps, new Date(START), 12, synthetic);
    const cells = stormCells(synthetic, walked);
    expect(cells.find((c) => c.id === "storm:0,5")?.synthetic).toBe(true);
    expect(cells.find((c) => c.id === "storm:0,4.5")?.synthetic).toBeUndefined();
  });
});

describe("scenario storms have a window", () => {
  /** The passing storm's grid with a scenario 8 m storm at 5° E, from `from` until `until`. */
  const held = (from: string | null, until: string | null): WeatherGrid => {
    const g = passingStorm();
    return {
      ...g,
      points: g.points.map((pt) =>
        pt.lon === 5
          ? {
              ...pt,
              synthetic: true as const,
              scenario: {
                from,
                until,
                waveHeightM: 8,
                waveDirDeg: 90,
                windSpeedKn: 40,
                windDirDeg: 90,
              },
            }
          : pt,
      ),
    };
  };
  const late = (weather: WeatherGrid) => ({
    ...input(weather),
    startAt: "2026-12-14T00:00:00.000Z",
  });
  const walk = (i: ReturnType<typeof late>) =>
    walkSteps(subSteps(A.points, 20).steps, new Date(i.startAt), 12, i.weather);

  it("a route that meets it inside its window, after the forecast, meets a storm", () => {
    const i = late(held("2026-12-10T00:00:00.000Z", "2026-12-20T00:00:00.000Z"));
    const cells = stormCells(i.weather, walk(i));
    expect(cells.map((c) => c.id)).toEqual(["storm:0,5"]);
    expect(cells[0]?.scenario).toBe(true);
    expect(cells[0]?.from).toBe("2026-12-10T00:00:00.000Z");
    expect(evaluateRoute(i, A, 12).reasons).toContain("heavy_weather");
  });

  it("after its window it is gone", () => {
    const i = late(held("2026-11-20T00:00:00.000Z", "2026-11-25T00:00:00.000Z"));
    expect(stormCells(i.weather, walk(i))).toEqual([]);
    expect(evaluateRoute(i, A, 12).reasons).not.toContain("heavy_weather");
  });

  it("every storm area, with when it is on", () => {
    const areas = stormAreas(held("2026-12-10T00:00:00.000Z", null));
    const scenario = areas.find((a) => a.id === "storm:0,5");
    expect(scenario?.from).toBe("2026-12-10T00:00:00.000Z");
    expect(scenario?.until).toBeNull();
    // The forecast's own 8 m storm (4.5 and 5.5° E, steps 9-11) is on from 27 h to 33 h.
    const forecast = areas.find((a) => a.id === "storm:0,4.5");
    expect(forecast?.from).toBe("2026-11-15T03:00:00.000Z");
    expect(forecast?.until).toBe("2026-11-15T09:00:00.000Z");
    expect(stormAreas(null)).toEqual([]);
  });
});
