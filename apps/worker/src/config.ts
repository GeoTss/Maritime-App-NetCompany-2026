import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  AIS_MODE: z.enum(["live", "replay", "off"]).default("replay"),
  WEATHER_MODE: z.enum(["live", "recorded"]).default("recorded"),
  AISSTREAM_API_KEY: z.string().optional(),
  DEMO_HAZARDS: z.enum(["on", "off"]).default("off"),
});

export interface WorkerConfig {
  databaseUrl: string;
  aisMode: "live" | "replay" | "off";
  weatherMode: "live" | "recorded";
  aisApiKey: string | undefined;
  /** Load the labelled synthetic demo hazard at start: always in replay mode, in live mode only when DEMO_HAZARDS=on. */
  loadSyntheticHazards: boolean;
}

/** Validate the worker's environment. Errors name the variable, never its value. */
export function loadWorkerConfig(
  env: Record<string, string | undefined>,
  log: (line: string) => void = (l) => console.warn(l),
): WorkerConfig {
  // Empty strings (docker-compose passes `VAR: ${VAR:-}`) count as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`worker: invalid environment: ${names}`);
  }
  const e = parsed.data;
  let aisMode = e.AIS_MODE;
  if (aisMode === "live" && !e.AISSTREAM_API_KEY) {
    log("worker: AIS_MODE=live but AISSTREAM_API_KEY is not set; using the recorded replay");
    aisMode = "replay";
  }
  return {
    databaseUrl: e.DATABASE_URL,
    aisMode,
    weatherMode: e.WEATHER_MODE,
    aisApiKey: e.AISSTREAM_API_KEY,
    loadSyntheticHazards: aisMode === "replay" || e.DEMO_HAZARDS === "on",
  };
}
