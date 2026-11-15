import type { Sql } from "@pharos/db";

type SourceStatus = {
  source: "ais" | "weather";
  mode: "live" | "recorded";
  detail: string | null;
  at: Date;
};

/** Writes the source's row only when it has none (a fresher row is kept as it is). */
export async function insertSourceStatusIfMissing(sql: Sql, s: SourceStatus): Promise<void> {
  await sql`insert into source_status (source, mode, detail, updated_at)
    values (${s.source}, ${s.mode}, ${s.detail}, ${s.at.toISOString()}::timestamptz)
    on conflict (source) do nothing`;
}

export async function upsertSourceStatus(sql: Sql, s: SourceStatus): Promise<void> {
  await sql`insert into source_status (source, mode, detail, updated_at)
    values (${s.source}, ${s.mode}, ${s.detail}, ${s.at.toISOString()}::timestamptz)
    on conflict (source) do update set
      mode = excluded.mode, detail = excluded.detail, updated_at = excluded.updated_at`;
}
