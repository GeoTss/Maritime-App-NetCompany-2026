/**
 * One-command switch to the fully live demo: recreates the api, erp, worker and web containers
 * with the clock unpinned (wall clock), live AIS, live weather and the live model, reseeds, and
 * waits until each source is proven live. Run: npm run demo:live
 *
 * `LLM_MODE=replay npm run demo:live` is the free rehearsal: live AIS and weather, recorded model
 * replies. `npm run demo:reset` switches back to the recorded, pinned demo.
 *
 * It never reads the env file: compose reads the environment as it already does (ANTHROPIC_API_KEY
 * and AISSTREAM_API_KEY pass through untouched). Messages name a variable, never a value.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_URL, getJson, SERVICES, WEB_URL, waitReady } from "./demo-reset.js";

/** The compose environment: the caller's, with a live world (a mode already set wins). */
export function liveEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    DEMO_ANCHOR: "", // explicitly empty: compose passes it through and the stack uses the wall clock
    SEED_ON_BOOT: "reset",
    DEMO_HAZARDS: "on",
    LLM_MODE: base.LLM_MODE || "live",
    AIS_MODE: base.AIS_MODE || "live",
    WEATHER_MODE: base.WEATHER_MODE || "live",
  };
}

export interface LiveSnapshot {
  health: unknown;
  clock: unknown;
  sources: unknown;
  traffic: unknown;
  vessels: unknown;
  webUp: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const itemsOf = (v: unknown): unknown[] => (isRecord(v) && Array.isArray(v.items) ? v.items : []);

/** Named ships in `traffic` whose MMSI is not a fleet MMSI (the fleet simulator writes the rest). */
export function namedNonFleet(traffic: unknown, vessels: unknown): unknown[] {
  const fleet = new Set(itemsOf(vessels).map((v) => (isRecord(v) ? String(v.mmsi) : "")));
  return itemsOf(traffic).filter(
    (t) =>
      isRecord(t) &&
      typeof t.name === "string" &&
      t.name.trim() !== "" &&
      !fleet.has(String(t.mmsi)),
  );
}

/** What still proves the stack is not fully live, in plain words; empty when it is. */
export function missingLive(
  s: LiveSnapshot,
  want: { llm: string; ais: string; weather: string },
): string[] {
  const out: string[] = [];
  if (!(isRecord(s.health) && s.health.status === "ok")) {
    out.push("api /api/health is not ok (for a live model check ANTHROPIC_API_KEY is set)");
  } else if (s.health.llmMode !== want.llm) {
    out.push(`api /api/health llmMode is "${String(s.health.llmMode)}", wanted "${want.llm}"`);
  }
  if (!(isRecord(s.clock) && s.clock.pinned === false)) {
    out.push("api /api/clock is pinned: DEMO_ANCHOR must be empty for a live stack");
  }
  const rows = itemsOf(s.sources);
  for (const [source, mode] of [
    ["ais", want.ais],
    ["weather", want.weather],
  ] as const) {
    const row = rows.find((i) => isRecord(i) && i.source === source);
    if (!(isRecord(row) && row.mode === mode)) {
      const got = isRecord(row) ? String(row.mode) : "missing";
      const hint = source === "ais" ? " (check AISSTREAM_API_KEY)" : " (Open-Meteo may be down)";
      out.push(`api /api/sources ${source} is "${got}", wanted "${mode}"${hint}`);
    } else if (source === "ais" && mode === "live" && /socket down/i.test(String(row.detail))) {
      out.push("api /api/sources ais detail says socket down (check AISSTREAM_API_KEY)");
    }
  }
  if (itemsOf(s.vessels).length === 0) {
    out.push("api /api/vessels returned no fleet vessels");
  } else if (want.ais === "live" && namedNonFleet(s.traffic, s.vessels).length === 0) {
    out.push("api /api/traffic has no named ship outside the fleet (AIS is not delivering)");
  }
  if (!s.webUp) out.push(`web is not answering on ${WEB_URL}`);
  return out;
}

async function liveSnapshot(): Promise<LiveSnapshot> {
  const [health, clock, sources, traffic, vessels, webUp] = await Promise.all([
    getJson(`${API_URL}/api/health`),
    getJson(`${API_URL}/api/clock`),
    getJson(`${API_URL}/api/sources`),
    getJson(`${API_URL}/api/traffic`),
    getJson(`${API_URL}/api/vessels`),
    fetch(WEB_URL, { signal: AbortSignal.timeout(5_000) }).then(
      (r) => r.ok,
      () => false,
    ),
  ]);
  return { health, clock, sources, traffic, vessels, webUp };
}

async function main(): Promise<void> {
  const env = liveEnv(process.env);
  const want = {
    llm: env.LLM_MODE ?? "live",
    ais: env.AIS_MODE ?? "live",
    weather: env.WEATHER_MODE ?? "live",
  };
  console.log(
    `demo:live (LLM_MODE=${want.llm}, AIS_MODE=${want.ais}, WEATHER_MODE=${want.weather}, wall clock): recreating ${SERVICES.join(", ")}`,
  );
  const r = spawnSync("docker", ["compose", "up", "-d", "--force-recreate", ...SERVICES], {
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`docker compose exited with status ${r.status ?? "none"}`);
  const started = Date.now();
  await waitReady(async () => missingLive(await liveSnapshot(), want));
  const snap = await liveSnapshot();
  const rows = itemsOf(snap.sources).filter(isRecord);
  const src = (n: string) => {
    const row = rows.find((i) => i.source === n);
    return row ? `${String(row.mode)} (${String(row.detail ?? "")})` : "missing";
  };
  console.log(
    `live stack ready in ${Math.round((Date.now() - started) / 1000)} s: llmMode ${String(isRecord(snap.health) ? snap.health.llmMode : "?")}, ais ${src("ais")}, weather ${src("weather")}, ${namedNonFleet(snap.traffic, snap.vessels).length} named non-fleet ships; web ${WEB_URL}, api ${API_URL}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`demo:live FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
}
