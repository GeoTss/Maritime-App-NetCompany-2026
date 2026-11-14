import { sql as dsql, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { createDb } from "../client.js";
import * as schema from "../schema.js";
import type { Sql } from "../sql.js";
import { generateWorld } from "./world.js";

export interface SeedOptions {
  seed: number;
  anchor: Date;
  /**
   * `reset` wipes every table and reseeds; `if-empty` seeds only when no world is stored and every
   * table is empty (it throws rather than delete existing rows).
   */
  mode: "reset" | "if-empty";
}

/** Postgres allows 65535 bind parameters per statement; chunk well below that. */
const CHUNK_ROWS = 1000;

const ALL_TABLES: PgTable[] = Object.values<unknown>(schema).filter((t): t is PgTable =>
  is(t, PgTable),
);

/** Tables whose rows carry explicit ids from the world, in foreign-key order. */
function worldInserts(world: ReturnType<typeof generateWorld>): [PgTable, object[]][] {
  return [
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
}

/** Name of the first table (other than world_meta) that holds any row, or null. */
async function firstNonEmptyTable(sql: Sql): Promise<string | null> {
  for (const table of ALL_TABLES) {
    const name = getTableName(table);
    if (name === getTableName(schema.worldMeta)) continue;
    const rows = await sql.unsafe(`SELECT 1 FROM "${name}" LIMIT 1`);
    if (rows.length > 0) return name;
  }
  return null;
}

/**
 * Seed the deterministic synthetic world in one transaction. After inserting rows with explicit
 * ids, every identity sequence is advanced to max(id) so later inserts continue after the seed.
 */
export async function seedDatabase(
  sql: Sql,
  opts: SeedOptions,
): Promise<{ seeded: boolean; anchor: Date }> {
  const db = createDb(sql);

  if (opts.mode === "if-empty") {
    const [existing] = await db.select().from(schema.worldMeta);
    if (existing) return { seeded: false, anchor: existing.anchor };
    // No world is recorded, but rows may still exist (e.g. world_meta was cleared by hand).
    // if-empty never deletes data: refuse rather than truncate.
    const occupied = await firstNonEmptyTable(sql);
    if (occupied) {
      throw new Error(
        `seed if-empty: world_meta is empty but table "${occupied}" has rows; refusing to wipe data. ` +
          "Set SEED_ON_BOOT=reset (or run npm run db:seed) to wipe and reseed.",
      );
    }
  }

  const world = generateWorld({ seed: opts.seed, anchor: opts.anchor });

  await db.transaction(async (tx) => {
    const names = ALL_TABLES.map((t) => `"${getTableName(t)}"`).join(", ");
    await tx.execute(dsql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));

    for (const [table, rows] of worldInserts(world)) {
      for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
        await tx.insert(table).values(rows.slice(i, i + CHUNK_ROWS));
      }
    }

    // Identity sequences still sit at 1; move each past its seeded ids. Empty tables are untouched.
    for (const table of ALL_TABLES) {
      if (!("id" in getTableColumns(table))) continue;
      const name = getTableName(table);
      await tx.execute(
        dsql.raw(
          `SELECT setval(pg_get_serial_sequence('"${name}"', 'id'), (SELECT max(id) FROM "${name}")) ` +
            `WHERE EXISTS (SELECT 1 FROM "${name}") AND pg_get_serial_sequence('"${name}"', 'id') IS NOT NULL`,
        ),
      );
    }

    await tx.insert(schema.worldMeta).values({
      id: 1,
      seed: world.meta.seed,
      anchor: world.meta.anchor,
      seedVersion: world.meta.seedVersion,
      seededAt: new Date(),
    });
  });

  return { seeded: true, anchor: world.meta.anchor };
}
