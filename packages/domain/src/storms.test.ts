import type { RouteCandidate, RouteSpeedInput, WeatherGrid } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { evaluateRoute, optimiseRouteSpeed } from "./route-optimiser.js";
import { stormCells } from "./storms.js";
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

  it("no weather, no storm", () => {
    const walked = walkSteps(subSteps(A.points, 20).steps, new Date(START), 12, null);
    expect(stormCells(null, walked)).toEqual([]);
    expect(evaluateRoute(input(null), A, 12).reasons).not.toContain("heavy_weather");
  });
});
