import { NoonReport, Port, Vessel, Voyage } from "@pharos/shared";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.js";
import { runMigrations } from "../migrate.js";
import * as schema from "../schema.js";
import { createSql, pingDb, type Sql } from "../sql.js";
import { seedDatabase } from "./seed.js";
import { generateWorld } from "./world.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pharos:pharos@localhost:5432/pharos_test";
const SEED = 20261114;
const ANCHOR = new Date("2026-11-14T08:00:00.000Z");

/** Connect to the test database, creating it first if Postgres is up but the database is missing. */
async function connect(): Promise<Sql | null> {
  const url = new URL(TEST_URL);
  const dbName = url.pathname.slice(1);
  const admin = createSql(Object.assign(new URL(TEST_URL), { pathname: "/postgres" }).toString(), {
    max: 1,
  });
  try {
    if (!(await pingDb(admin))) return null;
    const found = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (found.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
  return createSql(TEST_URL, { max: 2 });
}

const sql = await connect().catch(() => null);
if (!sql) {
  console.warn(`seed.db.test skipped: Postgres is unreachable at ${new URL(TEST_URL).host}`);
}

describe.skipIf(!sql)("seedDatabase (Postgres)", () => {
  const db = createDb(sql as Sql);
  const world = generateWorld({ seed: SEED, anchor: ANCHOR });
  const count = async (table: PgTable): Promise<number> => (await db.select().from(table)).length;

  beforeAll(async () => {
    await runMigrations(sql as Sql);
    await seedDatabase(sql as Sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
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

  it("reseed is repeatable and sequences continue after seeded ids", async () => {
    const before = await count(schema.quotes);
    await seedDatabase(sql as Sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
    await seedDatabase(sql as Sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
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
    const result = await seedDatabase(sql as Sql, {
      seed: SEED,
      anchor: new Date("2030-01-01T00:00:00Z"),
      mode: "if-empty",
    });
    expect(result.seeded).toBe(false);
    expect(result.anchor.getTime()).toBe(ANCHOR.getTime());
    expect(await count(schema.documents)).toBe(1);
  });
});
