import postgres from "postgres";

export type Sql = postgres.Sql;

/** Open a Postgres connection pool. The caller owns its lifetime (call `sql.end()`). */
export function createSql(databaseUrl: string, options: { max?: number } = {}): Sql {
  return postgres(databaseUrl, { max: options.max ?? 10, onnotice: () => {} });
}

/** Resolves true when the database answers `select 1` within `timeoutMs`. */
export async function pingDb(sql: Sql, timeoutMs = 2000): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const probe = sql`select 1 as ok`.then(() => true).catch(() => false);
  return Promise.race([probe, timeout]);
}
