import { NoonReport, Port, Vessel, Voyage } from "@pharos/shared";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.js";
import * as schema from "../schema.js";
import { connectTestDb, testDbLabel } from "../testing.js";
import { seedDatabase } from "./seed.js";
import { generateWorld } from "./world.js";

const SEED = 20261114;
const ANCHOR = new Date("2026-11-14T08:00:00.000Z");

const sql = await connectTestDb("seed");

if (!sql) {
  describe("seedDatabase (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("seed")}`, () => {});
  });
}

describe.skipIf(!sql)("seedDatabase (Postgres)", () => {
  if (!sql) return; // body still runs under skipIf; register nothing
  const db = createDb(sql);
  const world = generateWorld({ seed: SEED, anchor: ANCHOR });
  const count = async (table: PgTable): Promise<number> => (await db.select().from(table)).length;

  beforeAll(async () => {
    await seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("migrates and seeds; counts match the world", async () => {
    const expected: [PgTable, readonly unknown[]][] = [
      [schema.ports, world.ports],
      [schema.routeLegs, world.routeLegs],
      [schema.suppliers, world.suppliers],
      [schema.vessels, world.vessels],
      [schema.voyages, world.voyages],
      [schema.portCalls, world.portCalls],
      [schema.noonReports, world.noonReports],
      [schema.vesselPositions, world.vesselPositions],
      [schema.portFuelPrices, world.portFuelPrices],
      [schema.portCongestion, world.portCongestion],
      [schema.bunkerRequirements, world.bunkerRequirements],
      [schema.quotes, world.quotes],
      [schema.quoteLines, world.quoteLines],
      [schema.purchaseOrders, world.purchaseOrders],
      [schema.orderLines, world.orderLines],
      [schema.referenceRates, world.referenceRates],
    ];
    for (const [table, rows] of expected) {
      expect(await count(table), getTableName(table)).toBe(rows.length);
    }
    const [meta] = await db.select().from(schema.worldMeta);
    expect(meta?.seed).toBe(SEED);
    expect(meta?.anchor.getTime()).toBe(ANCHOR.getTime());
  });

  it("rows read back parse with the shared schemas", async () => {
    for (const row of await db.select().from(schema.ports)) Port.parse(row);
    for (const row of await db.select().from(schema.vessels)) Vessel.parse(row);
    for (const row of await db.select().from(schema.noonReports)) NoonReport.parse(row);
    for (const row of await db.select().from(schema.voyages)) Voyage.parse(row);
  });

  it("reset also empties ais_traffic, weather_snapshots and source_status", async () => {
    await db.insert(schema.aisTraffic).values({ mmsi: "1", lat: 1, lon: 1, updatedAt: ANCHOR });
    await db
      .insert(schema.weatherSnapshots)
      .values({ source: "t", modelRun: ANCHOR, fetchedAt: ANCHOR, grid: null });
    await db
      .insert(schema.sourceStatus)
      .values({ source: "ais", mode: "recorded", detail: null, updatedAt: ANCHOR });
    await seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
    expect(await count(schema.aisTraffic)).toBe(0);
    expect(await count(schema.weatherSnapshots)).toBe(0);
    expect(await count(schema.sourceStatus)).toBe(0);
  });

  it("reseed is repeatable and sequences continue after seeded ids", async () => {
    const before = await count(schema.quotes);
    await seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
    await seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
    expect(await count(schema.quotes)).toBe(before);

    const maxId = Math.max(...world.quotes.map((q) => q.id));
    const template = world.quotes[0];
    if (!template) throw new Error("world has no quotes");
    const { id: _id, ...withoutId } = template;
    const [inserted] = await db.insert(schema.quotes).values(withoutId).returning();
    expect(inserted?.id).toBe(maxId + 1);
  });

  it("if-empty leaves a seeded database untouched", async () => {
    await db.insert(schema.documents).values({
      kind: "email",
      source: "upload",
      sha256: "if-empty-test",
      bodyText: "hello",
      receivedAt: ANCHOR,
    });
    const result = await seedDatabase(sql, {
      seed: SEED,
      anchor: new Date("2030-01-01T00:00:00Z"),
      mode: "if-empty",
    });
    expect(result.seeded).toBe(false);
    expect(result.anchor.getTime()).toBe(ANCHOR.getTime());
    expect(await count(schema.documents)).toBe(1);
  });

  it("if-empty refuses to wipe data when world_meta is missing", async () => {
    await db.delete(schema.worldMeta);
    const quotes = await count(schema.quotes);
    const documents = await count(schema.documents);
    expect(quotes).toBeGreaterThan(0);
    await expect(
      seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "if-empty" }),
    ).rejects.toThrow(/SEED_ON_BOOT=reset/);
    expect(await count(schema.quotes)).toBe(quotes);
    expect(await count(schema.documents)).toBe(documents);
    expect(await count(schema.worldMeta)).toBe(0);
  });

  it("if-empty seeds a truly empty database", async () => {
    const names = Object.values<unknown>(schema)
      .filter((t): t is PgTable => is(t, PgTable))
      .map((t) => `"${getTableName(t)}"`)
      .join(", ");
    await sql.unsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
    const result = await seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "if-empty" });
    expect(result.seeded).toBe(true);
    expect(await count(schema.quotes)).toBe(world.quotes.length);
    expect(await count(schema.worldMeta)).toBe(1);
  });
});
