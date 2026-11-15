import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld, seedDatabase } from "@pharos/db";
import { connectTestDb } from "@pharos/db/testing";
import type { WeatherGrid } from "@pharos/shared";
import { afterAll, describe, expect, it } from "vitest";
import { aton, position, safety, sar, staticData } from "./ais/__helpers.js";
import { loadRecordedSources, recordedLiveData } from "./recorded.js";

const sql = await connectTestDb("integrations_recorded");
if (!sql) throw new Error("Postgres is not reachable; the DB test must run, not skip");
afterAll(async () => {
  await sql.end();
});

const ANCHOR = new Date("2026-11-14T08:00:00.000Z");
const grid: WeatherGrid = {
  startAt: "2026-11-01T00:00:00.000Z",
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

const world = await (async () => {
  await seedDatabase(sql, { seed: 20261114, anchor: ANCHOR, mode: "reset" });
  return loadWorld(sql);
})();
const port = world.ports[0]!;

const withoutName = (m: ReturnType<typeof position>) => {
  const { ShipName: _omit, ...meta } = m.MetaData;
  return { ...m, MetaData: meta };
};

function writeFixtures(extraLines = 0): string {
  const dir = mkdtempSync(join(tmpdir(), "pharos-recorded-"));
  const lines = [
    {
      offsetMs: 0,
      message: staticData(211000002, { Name: "SECOND SHIP", Type: 71, MaximumStaticDraught: 9.4 }),
    },
    {
      offsetMs: 500,
      message: position(211000001, port.lat + 0.05, port.lon, { NavigationalStatus: 1 }),
    },
    {
      offsetMs: 1000,
      message: withoutName(
        position(211000001, port.lat + 0.06, port.lon, { NavigationalStatus: 1, Sog: 0.3 }),
      ),
    },
    { offsetMs: 1500, message: staticData(211000001) },
    {
      offsetMs: 2000,
      message: position(211000002, port.lat, port.lon + 0.05, { NavigationalStatus: 0, Sog: 11 }),
    },
    { offsetMs: 3000, message: position(211000003, 0, -30) },
    { offsetMs: 4000, message: { MessageType: "Other", MetaData: {}, Message: {} } },
    { offsetMs: 4100, message: position(970123456, 36.5, -5.5) },
    { offsetMs: 4200, message: sar(111232001, 36.6, -5.4) },
    { offsetMs: 4300, message: aton(992111001, 36.1, -5.4, true, "NEW WRECK") },
    { offsetMs: 4400, message: aton(992111002, 36.2, -5.4, false, "BUOY") },
    { offsetMs: 4500, message: safety(211000001, "ROCKS ADRIFT") },
    { offsetMs: 4600, message: safety(211000099, "UNKNOWN SENDER") },
  ];
  for (let i = 0; i < extraLines; i++) {
    lines.push({
      offsetMs: 5000 + i,
      message: position(220000000 + (i % 500), 0, -30 + (i % 50) / 10),
    });
  }
  writeFileSync(
    join(dir, "ais-capture.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
  writeFileSync(join(dir, "weather-snapshot.json"), JSON.stringify(grid));
  writeFileSync(
    join(dir, "synthetic-hazards.json"),
    JSON.stringify([
      { id: "synthetic:1", label: "SYNTHETIC TEST", lat: 38, lon: 12, radiusNm: 25 },
    ]),
  );
  return dir;
}

const dump = async () => {
  return {
    traffic: await sql`select * from ais_traffic order by mmsi`,
    hazards: await sql`select * from nav_hazards order by id`,
    congestion: await sql`select * from port_congestion where source = 'ais' order by id`,
    weather: await sql`select * from weather_snapshots order by id`,
    status: await sql`select source, mode, detail, updated_at from source_status order by source`,
  };
};

describe("recorded sources", () => {
  it("loadRecordedSources fills the tables and gives identical rows on a second run", async () => {
    const dir = writeFixtures();
    const runOnce = async () => {
      await seedDatabase(sql, { seed: 20261114, anchor: ANCHOR, mode: "reset" });
      const r = await loadRecordedSources(sql, { anchor: ANCHOR, dir });
      return { r, db: await dump() };
    };
    const first = await runOnce();
    expect(first.r).toMatchObject({ vessels: 3, congestionRows: 1 });
    expect(first.db.traffic).toHaveLength(3);
    expect(first.db.congestion).toHaveLength(1);
    expect(first.db.congestion[0]).toMatchObject({
      port_id: port.id,
      anchored_count: 1,
      source: "ais",
    });
    expect(first.db.weather).toHaveLength(1);
    expect(first.db.status.map((s) => [s.source, s.mode])).toEqual([
      ["ais", "recorded"],
      ["weather", "recorded"],
    ]);
    const [named] = first.db.traffic.filter((t) => t.mmsi === "211000001");
    expect(named).toMatchObject({ ship_type: "tanker", destination: "PIRAEUS" });

    const second = await runOnce();
    expect(second.r).toEqual(first.r);
    expect(second.db).toEqual(first.db);
  });

  it("recordedLiveData matches what the database holds", async () => {
    const dir = writeFixtures();
    await seedDatabase(sql, { seed: 20261114, anchor: ANCHOR, mode: "reset" });
    await loadRecordedSources(sql, { anchor: ANCHOR, dir });
    const live = recordedLiveData({ anchor: ANCHOR, ports: world.ports, dir });
    expect(live.traffic.map((t) => t.mmsi)).toEqual(["211000001", "211000002", "211000003"]);
    expect(live.traffic.at(-1)?.updatedAt).toEqual(new Date(ANCHOR.getTime() - 1600)); // last traffic message (offset 3000 of 4600)
    expect(live.congestion).toEqual([
      { portId: port.id, anchoredCount: 1, waitingHours: 1.5, observedAt: ANCHOR },
    ]);
    expect(live.weather.startAt).toBe("2026-11-14T08:00:00.000Z");
    const rows = await sql`select * from ais_traffic order by mmsi`;
    expect(
      rows.map((r) => ({
        mmsi: r.mmsi,
        name: r.name,
        shipType: r.ship_type,
        lat: r.lat,
        lon: r.lon,
        sogKn: r.sog_kn,
        navStatus: r.nav_status,
        destination: r.destination,
        draughtM: r.draught_m,
        cogDeg: r.cog_deg,
        updatedAt: new Date(r.updated_at),
      })),
    ).toEqual(live.traffic);
    // a nameless later position keeps the earlier name; static data after a position applies;
    // static data before a position is applied to it
    expect(live.traffic[0]).toMatchObject({
      mmsi: "211000001",
      name: "STATIC NAME",
      shipType: "tanker",
      lat: port.lat + 0.06,
      sogKn: 0.3,
    });
    expect(live.traffic[1]).toMatchObject({
      mmsi: "211000002",
      name: "TEST ONE",
      shipType: "cargo",
      destination: "PIRAEUS",
      draughtM: 9.4,
      cogDeg: 90,
    });
    const hz = await sql`select * from nav_hazards order by id`;
    expect(live.hazards.map((h) => h.id)).toEqual(
      [
        "ais:distress_beacon:970123456",
        "ais:safety_message:211000001",
        "ais:sar_aircraft:111232001",
        "ais:aton:992111001",
        "synthetic:1",
      ].sort((a, b) => a.localeCompare(b)),
    );
    expect(
      hz.map((r) => ({
        id: r.id,
        kind: r.kind,
        source: r.source,
        mmsi: r.mmsi,
        lat: r.lat,
        lon: r.lon,
        label: r.label,
        radiusNm: r.radius_nm,
        observedAt: new Date(r.observed_at),
      })),
    ).toEqual(live.hazards);
    expect(live.hazards.find((h) => h.id === "synthetic:1")).toMatchObject({
      kind: "synthetic",
      source: "synthetic",
      mmsi: null,
      radiusNm: 25,
      observedAt: ANCHOR,
    });
    const cong = await sql`select * from port_congestion where source = 'ais' order by id`;
    expect(
      cong.map((r) => ({
        portId: r.port_id,
        anchoredCount: r.anchored_count,
        waitingHours: r.waiting_hours,
        observedAt: new Date(r.observed_at),
      })),
    ).toEqual(live.congestion);
  });

  it("loads a few thousand lines in well under a second", async () => {
    const dir = writeFixtures(4000);
    await seedDatabase(sql, { seed: 20261114, anchor: ANCHOR, mode: "reset" });
    const t0 = performance.now();
    await loadRecordedSources(sql, { anchor: ANCHOR, dir });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("a missing capture names npm run record:ais", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pharos-empty-"));
    await expect(loadRecordedSources(sql, { anchor: ANCHOR, dir })).rejects.toThrow(/record:ais/);
  });
});
