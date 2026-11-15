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
  ensureLiveBaseline,
  insertWeatherSnapshot,
  RECORDED_DIR,
  refreshCongestion,
  upsertSourceStatus,
} from "@pharos/integrations";
import { loadWorkerConfig } from "./config.js";

const SIMULATOR_INTERVAL_MS = 60_000;
const CONGESTION_INTERVAL_MS = 5 * 60_000;
const WEATHER_INTERVAL_MS = 6 * 3_600_000;
const RESTART_DELAY_MS = 30_000;

const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run `fn` now (or after `firstDelayMs`) and then every `everyMs` until aborted; a failure is
 * logged, never fatal.
 */
async function every(
  name: string,
  everyMs: number,
  signal: AbortSignal,
  fn: () => Promise<void>,
  firstDelayMs = 0,
) {
  if (firstDelayMs > 0) await abortableSleep(firstDelayMs, signal);
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

  const weather = createWeatherProvider({ mode: cfg.weatherMode });
  const aisMode = cfg.aisMode === "live" ? "live" : "recorded";
  let socketDown = false;
  const aisDetail = (rows: number | null) =>
    cfg.aisMode === "off"
      ? "AIS ingestion is off"
      : socketDown
        ? "socket down, showing last data"
        : rows === null
          ? cfg.aisMode
          : `${cfg.aisMode}; ${rows} congestion rows`;
  /**
   * The API reseeds on boot (SEED_ON_BOOT=reset truncates the live tables too): put back a weather
   * snapshot, the labelled synthetic demo hazard and the source rows whenever they are missing.
   */
  const baseline = async (now: Date) => {
    const r = await ensureLiveBaseline(sql, {
      now,
      weather,
      loadSyntheticHazards: cfg.loadSyntheticHazards,
      ais: { mode: aisMode, detail: aisDetail(null) },
    });
    if (r.weatherInserted || r.hazardsUpserted > 0) {
      log(
        `worker: baseline restored (weather ${r.weatherInserted ? "inserted" : "present"}, ${r.hazardsUpserted} synthetic hazard(s))`,
      );
    }
    return r;
  };
  let weatherAtStart = false;
  try {
    weatherAtStart = (await baseline(new Date())).weatherInserted;
  } catch (e) {
    log(`baseline: ${errText(e)}`);
  }

  const ingester = createAisIngester(sql, { now: () => new Date() });
  // A provider error must never reach the process: log and keep going.
  const onMessage = (raw: unknown) => {
    ingester.ingest(raw).catch((e) => log(`ingest: ${errText(e)}`));
  };

  const tasks: Promise<unknown>[] = [];
  const aisProvider: AisProvider | null =
    cfg.aisMode === "live" && cfg.aisApiKey
      ? createLiveAis({
          apiKey: cfg.aisApiKey,
          boxes: AIS_BOXES.demo ?? [],
          log,
          onSocket: (state) => {
            const down = state === "down";
            if (down === socketDown) return;
            socketDown = down;
            upsertSourceStatus(sql, {
              source: "ais",
              mode: aisMode,
              detail: aisDetail(null),
              at: new Date(),
            }).catch((e) => log(`source status: ${errText(e)}`));
          },
        })
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
        mode: aisMode,
        detail: aisDetail(rows),
        at: now,
      });
    }),
  );

  // The baseline again every 5 minutes (it ran at start), so a reseed while the worker runs heals.
  tasks.push(
    every(
      "baseline",
      CONGESTION_INTERVAL_MS,
      signal,
      async () => {
        await baseline(new Date());
      },
      CONGESTION_INTERVAL_MS,
    ),
  );

  // The weather refresh: at start (unless the baseline just stored a snapshot) and every 6 hours.
  tasks.push(
    every(
      "weather",
      WEATHER_INTERVAL_MS,
      signal,
      async () => {
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
      },
      weatherAtStart ? WEATHER_INTERVAL_MS : 0,
    ),
  );

  await Promise.all(tasks);
  await sql.end({ timeout: 5 });
  log("worker: stopped");
}

main().catch((e) => {
  console.error(`worker: fatal: ${errText(e)}`);
  process.exit(1);
});
