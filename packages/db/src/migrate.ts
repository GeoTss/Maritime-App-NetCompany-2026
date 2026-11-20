import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";
import type { Sql } from "./sql.js";

/** `packages/db/drizzle`, resolved from this file so it works on the host and in the container. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Apply every pending migration. Idempotent. */
export async function runMigrations(sql: Sql): Promise<void> {
  await migrate(createDb(sql), { migrationsFolder: MIGRATIONS_FOLDER });
}
