import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectTestDb } from "@pharos/db/testing";
import type { WeatherGrid } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureLiveBaseline } from "./baseline.js";
import type { WeatherProvider } from "./weather/provider.js";

const sql = await connectTestDb("integrations_baseline");
if (!sql) throw new Error("Postgres is not reachable; the DB test must run, not skip");
afterAll(async () => {
  await sql.end();
});

const NOW = new Date("2026-11-15T10:00:00.000Z");
const grid: WeatherGrid = {
  startAt: "2026-11-15T09:00:00.000Z",
  stepHours: 3,
  points: [
    {
      lat: 40,
      lon: 0,
      waveHeightM: [0.4, 0.5],
      waveDirDeg: [200, 210],
      windSpeedKn: [4.4, 5.2],
      windDirDeg: [100, 110],
      currentSpeedKn: [0.1, 0.1],
      currentDirDeg: [90, 95],
    },
  ],
};

/** A recorded-mode provider that counts its loads. */
const provider = () => {
  const p = {
    loads: 0,
    mode: "recorded" as const,
    async load() {
      p.loads++;
      return { grid, source: "open-meteo-recorded", mode: "recorded" as const };
    },
  };
  return p satisfies WeatherProvider & { loads: number };
};

const dir = (() => {
  const d = mkdtempSync(join(tmpdir(), "pharos-baseline-"));
  writeFileSync(
    join(d, "synthetic-hazards.json"),
    JSON.stringify([
      { id: "synthetic:1", label: "SYNTHETIC TEST", lat: 38, lon: 12, radiusNm: 25 },
    ]),
  );
  return d;
})();

const AIS = { mode: "recorded" as const, detail: "replay" };

/** What a reseed (SEED_ON_BOOT=reset) leaves of the live tables: nothing. */
const truncateLive = () =>
  sql`truncate weather_snapshots, nav_hazards, source_status restart identity cascade`;

const dump = async () => ({
  weather: await sql`select id, source, model_run from weather_snapshots order by id`,
  hazards: await sql`select id, kind, label, observed_at from nav_hazards order by id`,
  status: await sql`select source, mode, detail, updated_at from source_status order by source`,
});

describe("ensureLiveBaseline", () => {
  beforeEach(truncateLive);

  it("restores weather, the synthetic hazard and both source rows after a reseed, once", async () => {
    const weather = provider();
    const first = await ensureLiveBaseline(sql, {
      now: NOW,
      weather,
      loadSyntheticHazards: true,
      dir,
      ais: AIS,
    });
    expect(first).toEqual({ weatherInserted: true, hazardsUpserted: 1 });
    const db = await dump();
    expect(db.weather).toHaveLength(1);
    expect(db.weather[0]).toMatchObject({ source: "open-meteo-recorded" });
    expect(db.hazards).toMatchObject([{ id: "synthetic:1", kind: "synthetic" }]);
    expect(db.status.map((s) => [s.source, s.mode])).toEqual([
      ["ais", "recorded"],
      ["weather", "recorded"],
    ]);

    const later = new Date(NOW.getTime() + 5 * 60_000);
    const second = await ensureLiveBaseline(sql, {
      now: later,
      weather,
      loadSyntheticHazards: true,
      dir,
      ais: AIS,
    });
    expect(second).toEqual({ weatherInserted: false, hazardsUpserted: 0 });
    expect(weather.loads).toBe(1);
    expect(await dump()).toEqual(db);
  });

  it("leaves hazards alone when synthetic hazards are off, and keeps fresher source rows", async () => {
    await sql`insert into source_status (source, mode, detail, updated_at)
      values ('ais', 'live', 'live; 4 congestion rows', ${NOW.toISOString()}::timestamptz)`;
    const r = await ensureLiveBaseline(sql, {
      now: NOW,
      weather: provider(),
      loadSyntheticHazards: false,
      dir,
      ais: AIS,
    });
    expect(r).toEqual({ weatherInserted: true, hazardsUpserted: 0 });
    const db = await dump();
    expect(db.hazards).toEqual([]);
    expect(db.status.map((s) => [s.source, s.mode, s.detail])).toEqual([
      ["ais", "live", "live; 4 congestion rows"],
      ["weather", "recorded", `snapshot ${db.weather[0]?.id} from open-meteo-recorded`],
    ]);
  });

  it("restores a missing synthetic row next to AIS hazards without touching them", async () => {
    await sql`insert into nav_hazards (id, kind, source, mmsi, lat, lon, label, radius_nm, observed_at)
      values ('ais:sar_aircraft:111232001', 'sar_aircraft', 'ais', '111232001', 36.6, -5.4, 'SAR',
              null, ${NOW.toISOString()}::timestamptz)`;
    const r = await ensureLiveBaseline(sql, {
      now: NOW,
      weather: provider(),
      loadSyntheticHazards: true,
      dir,
      ais: AIS,
    });
    expect(r.hazardsUpserted).toBe(1);
    expect((await dump()).hazards.map((h) => h.id)).toEqual([
      "ais:sar_aircraft:111232001",
      "synthetic:1",
    ]);
  });
});
