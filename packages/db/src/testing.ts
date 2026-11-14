/** Test helper: one isolated Postgres database per test file (vitest runs files in parallel). */
import { runMigrations } from "./migrate.js";
import { createSql, type Sql } from "./sql.js";

const DEFAULT_TEST_URL = "postgres://pharos:pharos@localhost:5432/pharos_test";

const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ECONNRESET",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
]);

/** True if the server answers; false on connection-level errors; rethrows everything else. */
async function isReachable(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    // An AggregateError (localhost resolving to several addresses) carries the code on its members.
    const inner = (err as { errors?: { code?: unknown }[] } | null)?.errors ?? [];
    const codes = [code, ...inner.map((e) => e.code)];
    if (codes.length > 0 && codes.every((c) => typeof c === "string" && UNREACHABLE.has(c)))
      return false;
    throw err;
  }
}

/**
 * Connect to `pharos_test_<name>`, derived from TEST_DATABASE_URL (same host and credentials).
 * Creates the database if Postgres is up but it is missing, runs migrations, and returns null when
 * Postgres is unreachable so the caller can skip visibly. Caller owns `sql.end()`.
 */
export async function connectTestDb(name: string): Promise<Sql | null> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`connectTestDb: invalid name "${name}"`);
  const base = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL);
  const dbName = `pharos_test_${name}`;
  const target = Object.assign(new URL(base), { pathname: `/${dbName}` });
  const admin = createSql(Object.assign(new URL(base), { pathname: "/postgres" }).toString(), {
    max: 1,
  });
  try {
    // Only an unreachable server skips; anything else (auth, permissions, bad URL) throws.
    if (!(await isReachable(admin))) return null;
    const found = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (found.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end().catch(() => {});
  }
  const sql = createSql(target.toString(), { max: 2 });
  await runMigrations(sql);
  return sql;
}

/** "host:port/database" of the test database, for skip messages. */
export function testDbLabel(name: string): string {
  const base = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL);
  return `${base.host}/pharos_test_${name}`;
}
