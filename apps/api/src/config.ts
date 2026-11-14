import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmMode } from "@pharos/shared";
import { z } from "zod";
import { isPricedModel } from "./ai/pricing.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface AppConfig {
  databaseUrl: string;
  llmMode: LlmMode;
  anthropicApiKey: string | undefined;
  port: number;
  /** What the API does with the synthetic world at boot. */
  seedOnBoot: SeedOnBoot;
  worldSeed: number;
  /** Model per prompt; env EXTRACT_MODEL / AGENT_MODEL switch either without code changes. */
  extractModel: string;
  agentModel: string;
  /** `output_config.effort` per prompt. */
  extractEffort: Effort;
  agentEffort: Effort;
  /** Server-side refusal fallbacks (env LLM_FALLBACKS=on|off). */
  llmFallbacks: boolean;
  /** Absolute directory of LLM request/response recordings. */
  recordingsDir: string;
  /** Base URL of the ERP that approved purchase orders are pushed to (the simulator by default). */
  erpBaseUrl: string;
}

export const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof Effort>;

export const DEFAULT_MODEL = "claude-haiku-5-5";

/** Repo root, from this file's location (apps/api/src/config.ts), not from the process cwd. */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const DEFAULT_RECORDINGS_DIR = resolve(REPO_ROOT, "fixtures", "llm-recordings");

export const SeedOnBoot = z.enum(["reset", "if-empty", "off"]);
export type SeedOnBoot = z.infer<typeof SeedOnBoot>;

/** Seed of the synthetic world's PRNG (the world is also anchored to boot time). */
export const DEFAULT_WORLD_SEED = 20261114;
/** world_meta.seed is a Postgres integer. */
export const MAX_WORLD_SEED = 2_147_483_647;

export const DEFAULT_ERP_BASE_URL = "http://localhost:4100";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const Model = z
  .string()
  .trim()
  .refine(isPricedModel, "model has no pricing entry in apps/api/src/ai/pricing.ts")
  .default(DEFAULT_MODEL);

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LLM_MODE: z.preprocess(blankToUndefined, LlmMode.default("live")),
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  API_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(4000)),
  SEED_ON_BOOT: z.preprocess(blankToUndefined, SeedOnBoot.default("if-empty")),
  WORLD_SEED: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().nonnegative().max(MAX_WORLD_SEED).default(DEFAULT_WORLD_SEED),
  ),
  EXTRACT_MODEL: z.preprocess(blankToUndefined, Model),
  AGENT_MODEL: z.preprocess(blankToUndefined, Model),
  EXTRACT_EFFORT: z.preprocess(blankToUndefined, Effort.default("medium")),
  AGENT_EFFORT: z.preprocess(blankToUndefined, Effort.default("medium")),
  LLM_FALLBACKS: z.preprocess(blankToUndefined, z.enum(["on", "off"]).default("off")),
  RECORDINGS_DIR: z.preprocess(blankToUndefined, z.string().optional()),
  ERP_BASE_URL: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine((v) => URL.canParse(v) && /^https?:$/.test(new URL(v).protocol), "an http(s) URL")
      .default(DEFAULT_ERP_BASE_URL),
  ),
});

/**
 * Reads and validates process configuration. Live and record modes call the model,
 * so they refuse to start without ANTHROPIC_API_KEY. Error messages name variables, never values.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.code}`);
    const names = parsed.error.issues.map((i) => String(i.path[0] ?? ""));
    const hint = names.includes("DATABASE_URL") ? " DATABASE_URL is required." : "";
    throw new ConfigError(`Invalid configuration (${problems.join("; ")}).${hint}`);
  }
  const e = parsed.data;
  if ((e.LLM_MODE === "live" || e.LLM_MODE === "record") && !e.ANTHROPIC_API_KEY) {
    throw new ConfigError(
      `LLM_MODE=${e.LLM_MODE} needs ANTHROPIC_API_KEY. Add it to .env, or set LLM_MODE=replay to run without the model.`,
    );
  }
  return {
    databaseUrl: e.DATABASE_URL,
    llmMode: e.LLM_MODE,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    port: e.API_PORT,
    seedOnBoot: e.SEED_ON_BOOT,
    worldSeed: e.WORLD_SEED,
    extractModel: e.EXTRACT_MODEL,
    agentModel: e.AGENT_MODEL,
    extractEffort: e.EXTRACT_EFFORT,
    agentEffort: e.AGENT_EFFORT,
    llmFallbacks: e.LLM_FALLBACKS === "on",
    // A relative RECORDINGS_DIR is taken from the repo root, like the default.
    recordingsDir: e.RECORDINGS_DIR
      ? isAbsolute(e.RECORDINGS_DIR)
        ? e.RECORDINGS_DIR
        : resolve(REPO_ROOT, e.RECORDINGS_DIR)
      : DEFAULT_RECORDINGS_DIR,
    erpBaseUrl: e.ERP_BASE_URL,
  };
}
