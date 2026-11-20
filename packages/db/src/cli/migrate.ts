import { runMigrations } from "../migrate.js";
import { createSql } from "../sql.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (expected a postgres:// connection string)");
  process.exit(1);
}

const sql = createSql(url, { max: 1 });
try {
  await runMigrations(sql);
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
