import { join } from "node:path";
import { createSql, type Sql } from "@pharos/db";
import {
  AIS_BOXES,
  type AisProvider,
  abortableSleep,
  createAisIngester,
  createLiveAis,
  createReplayAis,
  createSimulatorAis,
  createWeatherProvider,
  insertWeatherSnapshot,
  RECORDED_DIR,
  refreshCongestion,
  syntheticHazards,
  upsertHazards,
  upsertSourceStatus,
} from "@pharos/integrations";
import { loadWorkerConfig } from "./config.js";

const SIMULATOR_INTERVAL_MS = 60_000;
const CONGESTION_INTERVAL_MS = 5 * 60_000;
const WEATHER_INTERVAL_MS = 6 * 3_600_000;
const RESTART_DELAY_MS = 30_000;

const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run `fn` now and then every `everyMs` until aborted; a failure is logged, never fatal. */
async function every(name: string, everyMs: number, signal: AbortSignal, fn: () => Promise<void>) {
  while (!signal.aborted) {
    try {
      await fn();
    } catch (e) {
      log(`${name}: ${errText(e)}`);
    }
    await abortableSleep(everyMs, signal);
  }
}

/** Keep a provider running; if it throws or ends unexpectedly, wait and start it again. */
async function supervise(
  name: string,
  provider: AisProvider,
  onMessage: (m: unknown) => void,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    try {
      await provider.run(onMessage, signal);
    } catch (e) {
      log(`${name}: stopped (${errText(e)}); restarting in ${RESTART_DELAY_MS / 1000} s`);
    }
    if (!signal.aborted) await abortableSleep(RESTART_DELAY_MS, signal);
  }
}

async function main() {
  const cfg = loadWorkerConfig(process.env);
  const sql: Sql = createSql(cfg.databaseUrl, { max: 4 });
  const ctrl = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ctrl.abort());
  const { signal } = ctrl;

  if (cfg.loadSyntheticHazards) {
    // The labelled synthetic hazard the demo routes around; real AIS hazards need no such help.
    const hazards = syntheticHazards(RECORDED_DIR, new Date());
    await upsertHazards(sql, hazards);
    log(`worker: loaded ${hazards.length} synthetic demo hazard(s)`);
  }

  const ingester = createAisIngester(sql, { now: () => new Date() });
  // A provider error must never reach the process: log and keep going.
  const onMessage = (raw: unknown) => {
    ingester.ingest(raw).catch((e) => log(`ingest: ${errText(e)}`));
  };

  const tasks: Promise<unknown>[] = [];
  const aisProvider: AisProvider | null =
    cfg.aisMode === "live" && cfg.aisApiKey
      ? createLiveAis({ apiKey: cfg.aisApiKey, boxes: AIS_BOXES.demo ?? [], log })
      : cfg.aisMode === "replay"
        ? createReplayAis({ path: join(RECORDED_DIR, "ais-capture.jsonl"), loop: true })
        : null;
  log(`worker: AIS ${cfg.aisMode}, weather ${cfg.weatherMode}`);

  if (aisProvider) tasks.push(supervise(`ais-${aisProvider.mode}`, aisProvider, onMessage, signal));
  tasks.push(
    supervise(
      "simulator",
      createSimulatorAis({ sql, now: () => new Date(), intervalMs: SIMULATOR_INTERVAL_MS }),
      onMessage,
      signal,
    ),
  );

  tasks.push(
    every("congestion", CONGESTION_INTERVAL_MS, signal, async () => {
      const now = new Date();
      const rows = await refreshCongestion(sql, now);
      await upsertSourceStatus(sql, {
        source: "ais",
        mode: cfg.aisMode === "live" ? "live" : "recorded",
        detail:
          cfg.aisMode === "off"
            ? "AIS ingestion is off"
            : `${cfg.aisMode}; ${rows} congestion rows`,
        at: now,
      });
    }),
  );

  const weather = createWeatherProvider({ mode: cfg.weatherMode });
  tasks.push(
    every("weather", WEATHER_INTERVAL_MS, signal, async () => {
      const now = new Date();
      const load = await weather.load(now);
      const id = await insertWeatherSnapshot(sql, {
        grid: load.grid,
        source: load.source,
        fetchedAt: now,
      });
      await upsertSourceStatus(sql, {
        source: "weather",
        mode: load.mode,
        detail: `snapshot ${id} from ${load.source}`,
        at: now,
      });
      log(`weather: stored snapshot ${id} (${load.mode})`);
    }),
  );

  await Promise.all(tasks);
  await sql.end({ timeout: 5 });
  log("worker: stopped");
}

main().catch((e) => {
  console.error(`worker: fatal: ${errText(e)}`);
  process.exit(1);
});
