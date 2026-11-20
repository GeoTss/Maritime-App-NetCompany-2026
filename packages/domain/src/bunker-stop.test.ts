import type { WeatherGrid } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { stopTimeline } from "./bunker-stop.js";

const START = "2026-11-14T08:00:00.000Z";
const HOUR_MS = 3_600_000;
const PORT = { lat: 35.82, lon: 14.54 };
const at = (h: number) => new Date(Date.parse(START) + h * HOUR_MS);

const gridWith = (waves: number[], lat = PORT.lat, lon = PORT.lon): WeatherGrid => ({
  startAt: START,
  stepHours: 3,
  points: [
    {
      lat,
      lon,
      waveHeightM: waves,
      waveDirDeg: waves.map(() => 0),
      windSpeedKn: waves.map(() => 0),
      windDirDeg: waves.map(() => 0),
      currentSpeedKn: waves.map(() => 0),
      currentDirDeg: waves.map(() => 0),
    },
  ],
});

describe("stopTimeline", () => {
  it("waits, then bunkers, with no weather", () => {
    const t = stopTimeline({
      arriveAt: at(0),
      position: PORT,
      waitingHours: 4,
      bunkeringHours: 6,
      weather: null,
    });
    expect(t.weatherDelayHours).toBe(0);
    expect(t.arriveAt).toBe(at(0).toISOString());
    expect(t.departAt).toBe(at(10).toISOString());
    expect(t.beyondForecast).toBe(true);
  });

  it("waits for the wave height to fall to 2.0 m", () => {
    const t = stopTimeline({
      arriveAt: at(0),
      position: PORT,
      waitingHours: 0,
      bunkeringHours: 6,
      weather: gridWith([3.0, 2.5, 1.8, 1.0]),
    });
    expect(t.weatherDelayHours).toBe(6);
    expect(t.beyondForecast).toBe(false);
    expect(t.departAt).toBe(at(12).toISOString());
  });

  it("starts at once when the weather is workable", () => {
    const t = stopTimeline({
      arriveAt: at(0),
      position: PORT,
      waitingHours: 4,
      bunkeringHours: 6,
      weather: gridWith([1.5, 1.5, 1.5, 1.5]),
    });
    expect(t.weatherDelayHours).toBe(0);
    expect(t.beyondForecast).toBe(false);
  });

  it("counts weather past the forecast as workable", () => {
    // Steps at 0, 3, 6, 9 h; the sample stops 1.5 h after the last step.
    const t = stopTimeline({
      arriveAt: at(0),
      position: PORT,
      waitingHours: 0,
      bunkeringHours: 6,
      weather: gridWith([3.0, 3.0, 3.0, 3.0]),
    });
    expect(t.beyondForecast).toBe(true);
    expect(t.weatherDelayHours).toBe(12);
  });

  it("treats a port outside the grid as workable", () => {
    const t = stopTimeline({
      arriveAt: at(0),
      position: PORT,
      waitingHours: 4,
      bunkeringHours: 6,
      weather: gridWith([3.0, 3.0, 3.0, 3.0], 45, -20),
    });
    expect(t.weatherDelayHours).toBe(0);
    expect(t.beyondForecast).toBe(true);
  });
});
