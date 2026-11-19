/**
 * One-command demo reset: recreates the api, erp, worker and web containers on the pinned demo
 * world (DEMO_ANCHOR, SEED_ON_BOOT=reset, recorded AIS and weather, hazards on), then waits for the
 * stack to be ready. Run: npm run demo:reset  (LLM_MODE=record|live|replay, default replay).
 *
 * It never reads .env: compose reads the environment as it already does (ANTHROPIC_API_KEY passes
 * through untouched).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const API_URL = "http://localhost:4000";
export const WEB_URL = "http://localhost:5173";
export const DEMO_ANCHOR = "2026-11-14T08:00:00Z";
export const WAIT_TIMEOUT_MS = 180_000;
export const SERVICES = ["api", "erp", "worker", "web"] as const;

/** The compose environment: the caller's, with the demo world pinned (an LLM_MODE already set wins). */
export function composeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    DEMO_ANCHOR,
    SEED_ON_BOOT: "reset",
    LLM_MODE: base.LLM_MODE || "replay",
    AIS_MODE: "replay",
    WEATHER_MODE: "recorded",
    DEMO_HAZARDS: "on",
    DEMO_STORM: "on",
  };
}

export interface Snapshot {
  health: unknown;
  clock: unknown;
  sources: unknown;
  traffic: unknown;
  webUp: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** What is still missing, in plain words; empty when the stack is ready. */
export function missing(s: Snapshot): string[] {
  const out: string[] = [];
  if (!(isRecord(s.health) && s.health.status === "ok")) out.push("api /api/health is not ok");
  if (!(isRecord(s.clock) && s.clock.pinned === true)) out.push("api /api/clock is not pinned");
  const items = isRecord(s.sources) && Array.isArray(s.sources.items) ? s.sources.items : [];
  for (const source of ["ais", "weather"]) {
    const row = items.find((i) => isRecord(i) && i.source === source);
    if (!(isRecord(row) && row.mode === "recorded")) {
      out.push(`api /api/sources ${source} is not recorded`);
    }
  }
  const traffic = isRecord(s.traffic) && Array.isArray(s.traffic.items) ? s.traffic.items : [];
  if (traffic.length === 0) out.push("api /api/traffic has no items");
  if (!s.webUp) out.push(`web is not answering on ${WEB_URL}`);
  return out;
}

async function snapshot(): Promise<Snapshot> {
  const [health, clock, sources, traffic, webUp] = await Promise.all([
    getJson(`${API_URL}/api/health`),
    getJson(`${API_URL}/api/clock`),
    getJson(`${API_URL}/api/sources`),
    getJson(`${API_URL}/api/traffic`),
    fetch(WEB_URL, { signal: AbortSignal.timeout(5_000) }).then(
      (r) => r.ok,
      () => false,
    ),
  ]);
  return { health, clock, sources, traffic, webUp };
}

export async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Polls `check` (what is still missing; empty = ready) until it is empty or the timeout passes. */
export async function waitReady(
  check: () => Promise<string[]> = async () => missing(await snapshot()),
  timeoutMs = WAIT_TIMEOUT_MS,
  intervalMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: string[] = [];
  for (;;) {
    last = await check();
    if (last.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `demo stack not ready after ${Math.round(timeoutMs / 1000)} s; still missing: ${last.join("; ")}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main(): Promise<void> {
  const env = composeEnv(process.env);
  console.log(
    `demo:reset (LLM_MODE=${env.LLM_MODE}, anchor ${DEMO_ANCHOR}): recreating ${SERVICES.join(", ")}`,
  );
  const r = spawnSync("docker", ["compose", "up", "-d", "--force-recreate", ...SERVICES], {
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`docker compose exited with status ${r.status ?? "none"}`);
  await waitReady();
  console.log(`demo stack ready: web ${WEB_URL}, api ${API_URL}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`demo:reset FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
}
