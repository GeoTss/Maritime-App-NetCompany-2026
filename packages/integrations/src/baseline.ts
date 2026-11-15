import type { Sql } from "@pharos/db";
import { upsertHazards } from "./ais/ingest.js";
import { RECORDED_DIR, syntheticHazards } from "./recorded.js";
import { insertSourceStatusIfMissing } from "./source-status.js";
import type { WeatherProvider } from "./weather/provider.js";
import { insertWeatherSnapshot, latestWeatherSnapshot } from "./weather/store.js";

/**
 * Puts back what the live tables need after a reseed (`SEED_ON_BOOT=reset` truncates every table,
 * the live ones included): a weather snapshot when there is none, the labelled synthetic hazard
 * (when enabled) when its row is missing, and the `ais` and `weather` source rows when missing.
 * Rows that exist are left alone, so the worker can call it on every tick: a second call writes
 * nothing. `ais` is the AIS row to write when it is missing (the worker knows its own mode).
 */
export async function ensureLiveBaseline(
  sql: Sql,
  opts: {
    now: Date;
    weather: WeatherProvider;
    loadSyntheticHazards: boolean;
    dir?: string;
    ais?: { mode: "live" | "recorded"; detail: string };
  },
): Promise<{ weatherInserted: boolean; hazardsUpserted: number }> {
  let snapshot: { id: number; source: string } | null = await latestWeatherSnapshot(sql);
  const weatherInserted = snapshot === null;
  if (snapshot === null) {
    const load = await opts.weather.load(opts.now);
    const id = await insertWeatherSnapshot(sql, {
      grid: load.grid,
      source: load.source,
      fetchedAt: opts.now,
    });
    snapshot = { id, source: load.source };
  }
  // The provider names a live fetch "open-meteo"; anything else is the recorded snapshot.
  await insertSourceStatusIfMissing(sql, {
    source: "weather",
    mode: snapshot.source === "open-meteo" ? "live" : "recorded",
    detail: `snapshot ${snapshot.id} from ${snapshot.source}`,
    at: opts.now,
  });

  let hazardsUpserted = 0;
  if (opts.loadSyntheticHazards) {
    const wanted = syntheticHazards(opts.dir ?? RECORDED_DIR, opts.now);
    const ids = wanted.map((h) => h.id);
    const present = new Set(
      ids.length === 0
        ? []
        : (await sql<{ id: string }[]>`select id from nav_hazards where id in ${sql(ids)}`).map(
            (r) => r.id,
          ),
    );
    const missing = wanted.filter((h) => !present.has(h.id));
    await upsertHazards(sql, missing);
    hazardsUpserted = missing.length;
  }

  if (opts.ais) {
    await insertSourceStatusIfMissing(sql, { source: "ais", ...opts.ais, at: opts.now });
  }
  return { weatherInserted, hazardsUpserted };
}
