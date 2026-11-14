import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import type { Sql } from "./sql.js";

export type Db = ReturnType<typeof createDb>;

/** Drizzle instance over an open connection; camelCase keys map to snake_case columns. */
export function createDb(sql: Sql) {
  return drizzle(sql, { schema, casing: "snake_case" });
}
