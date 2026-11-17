import type { WeatherGrid } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import {
  effectiveSpeedKn,
  forecastStepAt,
  sampleWeather,
  shiftWeatherGrid,
  speedLossFraction,
  type WeatherSample,
} from "./weather-effect.js";

const calm: WeatherSample = {
  waveHeightM: 0,
  waveDirDeg: 0,
  windSpeedKn: 0,
  windDirDeg: 0,
  currentSpeedKn: 0,
  currentDirDeg: 0,
};

describe("effectiveSpeedKn", () => {
  it("3 m sea dead ahead at 12 kn: loss 1.0 x 3^2 x 1.0 = 9 % -> 12 x 0.91 = 10.92", () => {
    const s = { ...calm, waveHeightM: 3, waveDirDeg: 90 }; // waves from 090, heading 090
    expect(effectiveSpeedKn(12, s, 90)).toBeCloseTo(10.92, 9);
  });
  it("same sea on the beam: 9 x 0.4 = 3.6 % -> 12 x 0.964 = 11.568", () => {
    const s = { ...calm, waveHeightM: 3, waveDirDeg: 0 };
    expect(effectiveSpeedKn(12, s, 90)).toBeCloseTo(11.568, 9);
  });
  it("following sea weight 0.1: 9 x 0.1 = 0.9 % -> 11.892", () => {
    const s = { ...calm, waveHeightM: 3, waveDirDeg: 270 };
    expect(effectiveSpeedKn(12, s, 90)).toBeCloseTo(11.892, 9);
  });
  it("bow-quarter weight 0.7: 9 x 0.7 = 6.3 % -> 11.244", () => {
    const s = { ...calm, waveHeightM: 3, waveDirDeg: 45 };
    expect(effectiveSpeedKn(12, s, 90)).toBeCloseTo(11.244, 9);
  });
  it("1 kn current along the heading adds 1 kn", () => {
    expect(effectiveSpeedKn(12, { ...calm, currentSpeedKn: 1, currentDirDeg: 90 }, 90)).toBeCloseTo(
      13,
      9,
    );
    expect(
      effectiveSpeedKn(12, { ...calm, currentSpeedKn: 1, currentDirDeg: 270 }, 90),
    ).toBeCloseTo(11, 9);
  });
  it("headwind adds 0.1 % per kn above 10 kn: 30 kn -> 2 % -> 11.76", () => {
    const s = { ...calm, windSpeedKn: 30, windDirDeg: 90 };
    expect(effectiveSpeedKn(12, s, 90)).toBeCloseTo(11.76, 9);
    expect(speedLossFraction({ ...calm, windSpeedKn: 8, windDirDeg: 90 }, 90)).toBe(0);
  });
  it("never goes below 1 kn", () => {
    const s = { ...calm, currentSpeedKn: 5, currentDirDeg: 270 };
    expect(effectiveSpeedKn(2, s, 90)).toBe(1);
  });
  it("a 12 m sea is capped at a 0.4 loss", () => {
    const s = { ...calm, waveHeightM: 12, waveDirDeg: 90 };
    expect(speedLossFraction(s, 90)).toBe(0.4);
    expect(effectiveSpeedKn(10, s, 90)).toBeCloseTo(6, 9);
  });
  it("is deterministic", () => {
    const s = { ...calm, waveHeightM: 2.2, waveDirDeg: 33, windSpeedKn: 22, windDirDeg: 200 };
    expect(effectiveSpeedKn(13, s, 77)).toBe(effectiveSpeedKn(13, s, 77));
  });
});

const grid: WeatherGrid = {
  startAt: "2026-11-15T00:00:00.000Z",
  stepHours: 3,
  points: [
    {
      lat: 36,
      lon: -5,
      waveHeightM: [1, 2, null],
      waveDirDeg: [10, 20, 30],
      windSpeedKn: [5, 15, 25],
      windDirDeg: [100, 110, 120],
      currentSpeedKn: [0.1, 0.2, 0.3],
      currentDirDeg: [200, 210, 220],
    },
    {
      lat: 40,
      lon: 5,
      waveHeightM: [9, 9, 9],
      waveDirDeg: [0, 0, 0],
      windSpeedKn: [0, 0, 0],
      windDirDeg: [0, 0, 0],
      currentSpeedKn: [0, 0, 0],
      currentDirDeg: [0, 0, 0],
    },
  ],
};

describe("sampleWeather", () => {
  const p = { lat: 36.1, lon: -5.1 };
  it("takes the nearest point and nearest time step", () => {
    const s = sampleWeather(grid, p, new Date("2026-11-15T03:50:00.000Z")); // step 1 (3 h) is nearest
    expect(s).toEqual({
      waveHeightM: 2,
      waveDirDeg: 20,
      windSpeedKn: 15,
      windDirDeg: 110,
      currentSpeedKn: 0.2,
      currentDirDeg: 210,
    });
  });
  it("reads a null field as 0", () => {
    const s = sampleWeather(grid, p, new Date("2026-11-15T06:00:00.000Z"));
    expect(s?.waveHeightM).toBe(0);
    expect(s?.windSpeedKn).toBe(25);
  });
  it("returns null past the last step (+ half a step), before the first, and for no points", () => {
    expect(sampleWeather(grid, p, new Date("2026-11-15T07:31:00.000Z"))).toBeNull();
    expect(sampleWeather(grid, p, new Date("2026-11-14T22:00:00.000Z"))).toBeNull();
    expect(sampleWeather({ ...grid, points: [] }, p, new Date(grid.startAt))).toBeNull();
  });
  it("returns null when the nearest point is over 120 nm away", () => {
    expect(sampleWeather(grid, { lat: 36, lon: 0 }, new Date(grid.startAt))).toBeNull();
  });
});

describe("no data means calm", () => {
  it("null sample, far point and time past the last step return the input speed", () => {
    const far = sampleWeather(grid, { lat: 20, lon: 60 }, new Date(grid.startAt));
    const late = sampleWeather(grid, { lat: 36, lon: -5 }, new Date("2026-12-01T00:00:00.000Z"));
    for (const s of [null, far, late]) {
      const v = effectiveSpeedKn(12, s, 45);
      expect(v).toBe(12);
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe("shiftWeatherGrid", () => {
  it("changes only startAt", () => {
    const g = shiftWeatherGrid(grid, new Date("2026-11-20T06:00:00.000Z"));
    expect(g.startAt).toBe("2026-11-20T06:00:00.000Z");
    expect(g.points).toBe(grid.points);
    expect(g.stepHours).toBe(3);
    expect(grid.startAt).toBe("2026-11-15T00:00:00.000Z");
  });
});

describe("forecastStepAt", () => {
  it("step 0 is startAt and step k is startAt plus k x stepHours", () => {
    const grid = { startAt: "2026-11-14T06:00:00Z", stepHours: 3 };
    expect(forecastStepAt(grid, 0).toISOString()).toBe("2026-11-14T06:00:00.000Z");
    expect(forecastStepAt(grid, 2).toISOString()).toBe("2026-11-14T12:00:00.000Z");
  });
});
