import { runMigrations } from "../migrate.js";
import { seedDatabase } from "../seed/seed.js";
import { createSql } from "../sql.js";
import { parseWorldSeed } from "./world-seed.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (expected a postgres:// connection string)");
  process.exit(1);
}
let seed: number;
try {
  seed = parseWorldSeed(process.env.WORLD_SEED);
} catch (error) {
  console.error(error instanceof Error ? error.message : "WORLD_SEED is invalid");
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
