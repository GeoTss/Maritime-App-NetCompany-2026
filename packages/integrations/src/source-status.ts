import type { Sql } from "@pharos/db";

export async function upsertSourceStatus(
  sql: Sql,
  s: { source: "ais" | "weather"; mode: "live" | "recorded"; detail: string | null; at: Date },
): Promise<void> {
  await sql`insert into source_status (source, mode, detail, updated_at)
    values (${s.source}, ${s.mode}, ${s.detail}, ${s.at.toISOString()}::timestamptz)
    on conflict (source) do update set
      mode = excluded.mode, detail = excluded.detail, updated_at = excluded.updated_at`;
}
