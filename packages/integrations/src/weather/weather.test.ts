import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WeatherGrid } from "@pharos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeatherGrid, WeatherFetchError } from "./open-meteo.js";
import { createWeatherProvider } from "./provider.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const POINTS = [
  { lat: 40, lon: 0 },
  { lat: 40, lon: -3 },
];

const okFetch: typeof fetch = async (input) => {
  const url = String(input);
  const body = url.includes("marine-api")
    ? fixture("marine-2pt.json")
    : fixture("forecast-2pt.json");
  return new Response(body, { status: 200 });
};

afterEach(() => vi.restoreAllMocks());

describe("fetchWeatherGrid", () => {
  it("turns a marine and a forecast payload into a WeatherGrid in knots with 3-hour steps", async () => {
    const grid = await fetchWeatherGrid({ points: POINTS, fetch: okFetch, now: new Date() });
    expect(WeatherGrid.safeParse(grid).success).toBe(true);
    expect(grid.stepHours).toBe(3);
    expect(grid.startAt).toBe("2026-11-15T00:00:00.000Z");
    const p = grid.points[0]!;
    expect(p.waveHeightM).toHaveLength(4); // 12 hourly values -> every third
    expect(p.waveHeightM[0]).toBe(0.4);
    expect(p.windSpeedKn[0]).toBe(4.4);
    expect(p.currentSpeedKn[0]).toBe(0.1); // 0.2 km/h -> 0.108 kn -> 0.1
  });

  it("drops a land point whose wave heights are all null", async () => {
    const grid = await fetchWeatherGrid({ points: POINTS, fetch: okFetch, now: new Date() });
    expect(grid.points.map((p) => p.lon)).toEqual([0]);
  });

  it("throws WeatherFetchError on a non-200 answer", async () => {
    const f: typeof fetch = async () => new Response("slow down", { status: 429 });
    await expect(fetchWeatherGrid({ points: POINTS, fetch: f, now: new Date() })).rejects.toThrow(
      WeatherFetchError,
    );
  });

  it("throws WeatherFetchError on a payload that fails validation", async () => {
    const f: typeof fetch = async () => new Response('{"nope":1}', { status: 200 });
    await expect(fetchWeatherGrid({ points: POINTS, fetch: f, now: new Date() })).rejects.toThrow(
      WeatherFetchError,
    );
  });
});

describe("createWeatherProvider", () => {
  const snapshotDir = mkdtempSync(join(tmpdir(), "wx-"));
  const snapshotPath = join(snapshotDir, "snap.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      startAt: "2026-01-01T00:00:00.000Z",
      stepHours: 3,
      points: [
        {
          lat: 40,
          lon: 0,
          waveHeightM: [1, 1],
          waveDirDeg: [10, 10],
          windSpeedKn: [5, 5],
          windDirDeg: [20, 20],
          currentSpeedKn: [0.1, 0.1],
          currentDirDeg: [30, 30],
        },
      ],
    }),
  );

  it("recorded mode shifts the snapshot to now floored to the hour", async () => {
    const p = createWeatherProvider({ mode: "recorded", snapshotPath });
    const r = await p.load(new Date("2026-11-15T10:40:00.000Z"));
    expect(r.mode).toBe("recorded");
    expect(r.source).toBe("open-meteo-recorded");
    expect(r.grid.startAt).toBe("2026-11-15T10:00:00.000Z");
  });

  it("a failed fetch falls back to the snapshot and logs once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f: typeof fetch = async () => new Response("", { status: 429 });
    const p = createWeatherProvider({ mode: "live", snapshotPath, fetch: f });
    const r = await p.load(new Date("2026-11-15T10:40:00.000Z"));
    expect(r.mode).toBe("recorded");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/key/i);
  });
});
