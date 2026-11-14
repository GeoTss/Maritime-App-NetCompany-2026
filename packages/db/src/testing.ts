/** Test helper: one isolated Postgres database per test file (vitest runs files in parallel). */
import { runMigrations } from "./migrate.js";
import { createSql, pingDb, type Sql } from "./sql.js";

const DEFAULT_TEST_URL = "postgres://pharos:pharos@localhost:5432/pharos_test";

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
    if (!(await pingDb(admin))) return null;
    const found = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (found.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } catch {
    return null;
  } finally {
    await admin.end().catch(() => {});
  }
  const sql = createSql(target.toString(), { max: 2 });
  await runMigrations(sql);
  return sql;
}
