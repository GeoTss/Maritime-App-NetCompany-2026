import { LlmMode } from "@pharos/shared";
import { z } from "zod";

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
}

export const SeedOnBoot = z.enum(["reset", "if-empty", "off"]);
export type SeedOnBoot = z.infer<typeof SeedOnBoot>;

/** Seed of the synthetic world's PRNG (the world is also anchored to boot time). */
export const DEFAULT_WORLD_SEED = 20261114;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LLM_MODE: z.preprocess(blankToUndefined, LlmMode.default("live")),
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  API_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(4000)),
  SEED_ON_BOOT: z.preprocess(blankToUndefined, SeedOnBoot.default("if-empty")),
  WORLD_SEED: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().nonnegative().default(DEFAULT_WORLD_SEED),
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
  };
}
