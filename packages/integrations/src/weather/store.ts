import type { Sql } from "@pharos/db";
import { type Id, WeatherGrid } from "@pharos/shared";

/**
 * The grid goes in as JSON text cast to jsonb (`::text::jsonb`): a bare `::jsonb` parameter is
 * serialised by postgres.js itself, which double-encodes a JSON string (a jsonb string, not an
 * object) on any client drizzle has not patched, such as the worker's.
 */
export async function insertWeatherSnapshot(
  sql: Sql,
  s: { grid: WeatherGrid; source: string; fetchedAt: Date },
): Promise<Id> {
  const rows = await sql<{ id: number }[]>`
    insert into weather_snapshots (source, model_run, fetched_at, grid)
    values (${s.source}, ${new Date(s.grid.startAt).toISOString()}::timestamptz, ${s.fetchedAt.toISOString()}::timestamptz, ${JSON.stringify(s.grid)}::text::jsonb)
    returning id`;
  return rows[0]!.id;
}

export async function latestWeatherSnapshot(
  sql: Sql,
): Promise<{ id: Id; source: string; modelRun: Date; fetchedAt: Date; grid: WeatherGrid } | null> {
  const rows = await sql<
    {
      id: number;
      source: string;
      model_run: string | Date;
      fetched_at: string | Date;
      grid: unknown;
    }[]
  >`select id, source, model_run, fetched_at, grid from weather_snapshots order by id desc limit 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    source: r.source,
    modelRun: new Date(r.model_run),
    fetchedAt: new Date(r.fetched_at),
    grid: WeatherGrid.parse(r.grid),
  };
}
