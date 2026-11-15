import { currentVoyage, loadWorld, seedDatabase, voyageState } from "@pharos/db";
import { connectTestDb } from "@pharos/db/testing";
import { positionAt, sailedNmAt } from "@pharos/domain";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { position, staticData } from "./__helpers.js";
import { createAisIngester, refreshCongestion } from "./ingest.js";
import { normaliseAisMessage } from "./normalise.js";
import { createSimulatorAis } from "./simulator.js";

const sql = await connectTestDb("integrations_ais");
if (!sql) throw new Error("Postgres is not reachable; the DB test must run, not skip");
afterAll(async () => {
  await sql.end();
});

const ANCHOR = new Date("2026-11-14T08:00:00.000Z");
let world: Awaited<ReturnType<typeof loadWorld>>;

beforeEach(async () => {
  await seedDatabase(sql, { seed: 20261114, anchor: ANCHOR, mode: "reset" });
  world = await loadWorld(sql);
});

describe("AIS ingester", () => {
  it("bad messages are dropped, not fatal", async () => {
    const ing = createAisIngester(sql, { now: () => ANCHOR });
    await ing.ingest({ MessageType: "Other", MetaData: {}, Message: {} });
    await ing.ingest(position(211000001, 91, 0));
    await ing.ingest('{"Message":{"Pos');
    await ing.ingest({});
    await ing.ingest(position(211000002, 36, -5.5, { Sog: 102.3 }));
    expect(ing.stats()).toEqual({ accepted: 1, dropped: 4 });
    const rows = await sql`select mmsi, sog_kn from ais_traffic`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mmsi: "211000002", sog_kn: null });
  });

  it("throttles to one write per MMSI per throttleMs", async () => {
    let t = ANCHOR.getTime();
    const ing = createAisIngester(sql, { now: () => new Date(t), throttleMs: 30_000 });
    await ing.ingest(position(211000003, 36, -5.5));
    t += 5_000;
    await ing.ingest(position(211000003, 36.01, -5.5));
    const [row] = await sql`select lat, updated_at from ais_traffic where mmsi = '211000003'`;
    expect(row?.lat).toBe(36);
    expect(new Date(row?.updated_at).toISOString()).toBe(ANCHOR.toISOString());
    t += 30_000;
    await ing.ingest(position(211000003, 36.02, -5.5));
    const [after] = await sql`select lat from ais_traffic where mmsi = '211000003'`;
    expect(after?.lat).toBe(36.02);
  });

  it("applies static data that arrived before the position", async () => {
    const ing = createAisIngester(sql, { now: () => ANCHOR, throttleMs: 0 });
    await ing.ingest(staticData(211000004));
    expect(await sql`select 1 from ais_traffic where mmsi = '211000004'`).toHaveLength(0);
    await ing.ingest(position(211000004, 36, -5.5));
    const [row] =
      await sql`select name, ship_type, destination from ais_traffic where mmsi = '211000004'`;
    expect(row).toEqual({ name: "TEST ONE", ship_type: "tanker", destination: "PIRAEUS" });
    // static data for an existing row updates it
    await ing.ingest(staticData(211000004, { Destination: "MALTA" }));
    const [upd] = await sql`select destination from ais_traffic where mmsi = '211000004'`;
    expect(upd?.destination).toBe("MALTA");
  });

  it("writes vessel_positions for a fleet MMSI, at most once per fleetIntervalMs", async () => {
    const vessel = world.vessels[0]!;
    let t = ANCHOR.getTime();
    const ing = createAisIngester(sql, {
      now: () => new Date(t),
      throttleMs: 0,
      fleetIntervalMs: 600_000,
    });
    const count = async () =>
      (await sql<{ n: number }[]>`select count(*)::int as n from vessel_positions`)[0]!.n;
    const before = await count();
    await ing.ingest(position(Number(vessel.mmsi), 36, -5.5));
    t += 60_000;
    await ing.ingest(position(Number(vessel.mmsi), 36.1, -5.5));
    expect(await count()).toBe(before + 1);
    const [last] = await sql`select source from vessel_positions order by id desc limit 1`;
    expect(last?.source).toBe(vessel.trackingSource);
  });
});

describe("refreshCongestion", () => {
  it("writes a row for a port with vessels and none for a port without", async () => {
    const port = world.ports[0]!;
    const ing = createAisIngester(sql, { now: () => ANCHOR, throttleMs: 0 });
    await ing.ingest(position(211000010, port.lat + 0.05, port.lon, { NavigationalStatus: 1 }));
    await ing.ingest(
      position(211000011, port.lat, port.lon + 0.05, { NavigationalStatus: 0, Sog: 12 }),
    );
    await ing.ingest(position(211000012, 0, -30)); // mid-Atlantic
    const written = await refreshCongestion(sql, ANCHOR);
    expect(written).toBe(1);
    const rows =
      await sql`select port_id, anchored_count, waiting_hours, source from port_congestion where source = 'ais'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      port_id: port.id,
      anchored_count: 1,
      waiting_hours: 1.5,
      source: "ais",
    });
  });

  it("ignores traffic older than 30 minutes", async () => {
    const p = world.ports[0]!;
    const ing = createAisIngester(sql, { now: () => new Date(ANCHOR.getTime() - 3_600_000) });
    await ing.ingest(position(211000020, p.lat, p.lon));
    expect(await refreshCongestion(sql, ANCHOR)).toBe(0);
  });
});

describe("simulator", () => {
  it("emits a message that normalises to the vessel's positionAt", async () => {
    const now = new Date(ANCHOR.getTime() + 3_600_000);
    const msgs: unknown[] = [];
    const ctrl = new AbortController();
    await createSimulatorAis({ sql, now: () => now, intervalMs: 60_000 }).run((m) => {
      msgs.push(m);
      ctrl.abort();
    }, ctrl.signal);
    expect(msgs.length).toBeGreaterThan(0);
    const obs = normaliseAisMessage(msgs[0]);
    const vessel = world.vessels.find((v) => v.mmsi === obs?.mmsi)!;
    const voyage = currentVoyage(world, vessel.id)!;
    const { path } = voyageState(world, voyage.id);
    const expected = positionAt(path, sailedNmAt(path, now));
    expect(obs).toMatchObject({ kind: "position", lat: expected.lat, lon: expected.lon });
  });
});
