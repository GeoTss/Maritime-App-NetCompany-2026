import { runMigrations } from "../migrate.js";
import { seedDatabase } from "../seed/seed.js";
import { createSql } from "../sql.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (expected a postgres:// connection string)");
  process.exit(1);
}
const rawSeed = process.env.WORLD_SEED?.trim();
const seed = rawSeed ? Number(rawSeed) : 20261114;
if (!Number.isInteger(seed) || seed < 0) {
  console.error("WORLD_SEED must be a non-negative integer");
  process.exit(1);
}

const sql = createSql(url, { max: 1 });
try {
  await runMigrations(sql);
  const { anchor } = await seedDatabase(sql, { seed, anchor: new Date(), mode: "reset" });
  console.log(`seeded world (seed ${seed}) anchored at ${anchor.toISOString()}`);
} catch (error) {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
