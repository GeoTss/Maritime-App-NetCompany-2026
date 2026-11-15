import { createSql } from "@pharos/db";
import { connectTestDb } from "@pharos/db/testing";
import type { WeatherGrid } from "@pharos/shared";
import { afterAll, describe, expect, it } from "vitest";
import { insertWeatherSnapshot, latestWeatherSnapshot } from "./store.js";

const sql = await connectTestDb("integrations_weather");
if (!sql) throw new Error("Postgres is not reachable; the DB test must run, not skip");
afterAll(async () => {
  await sql.end();
});

const grid: WeatherGrid = {
  startAt: "2026-11-15T09:00:00.000Z",
  stepHours: 3,
  points: [
    {
      lat: 40,
      lon: 0,
      waveHeightM: [0.4, null],
      waveDirDeg: [200, 210],
      windSpeedKn: [4.4, 5.2],
      windDirDeg: [100, 110],
      currentSpeedKn: [0.1, 0.1],
      currentDirDeg: [90, 95],
    },
  ],
};

describe("weather store", () => {
  it("round-trips the latest snapshot", async () => {
    await sql`truncate weather_snapshots restart identity cascade`;
    expect(await latestWeatherSnapshot(sql)).toBeNull();
    const fetchedAt = new Date("2026-11-15T10:42:00.000Z");
    await insertWeatherSnapshot(sql, {
      grid: { ...grid, startAt: "2026-11-14T00:00:00.000Z" },
      source: "old",
      fetchedAt,
    });
    const id = await insertWeatherSnapshot(sql, { grid, source: "open-meteo", fetchedAt });
    const latest = await latestWeatherSnapshot(sql);
    expect(latest).toEqual({
      id,
      source: "open-meteo",
      modelRun: new Date("2026-11-15T09:00:00.000Z"),
      fetchedAt,
      grid,
    });
  });

  it("stores the grid as a JSON object from a client drizzle never touched (the worker's)", async () => {
    // connectTestDb's client ran the migrations through drizzle, which makes jsonb parameters
    // pass through as-is; the worker's plain postgres.js client serialises them itself.
    const url = new URL(
      process.env.TEST_DATABASE_URL ?? "postgres://pharos:pharos@localhost:5432/pharos_test",
    );
    url.pathname = "/pharos_test_integrations_weather";
    const plain = createSql(url.toString(), { max: 1 });
    try {
      await plain`truncate weather_snapshots restart identity cascade`;
      const fetchedAt = new Date("2026-11-15T10:42:00.000Z");
      const id = await insertWeatherSnapshot(plain, { grid, source: "open-meteo", fetchedAt });
      const [row] = await plain<{ t: string }[]>`
        select jsonb_typeof(grid) as t from weather_snapshots where id = ${id}`;
      expect(row?.t).toBe("object");
      expect((await latestWeatherSnapshot(plain))?.grid).toEqual(grid);
      expect((await latestWeatherSnapshot(sql))?.grid).toEqual(grid);
    } finally {
      await plain.end();
    }
  });
});
