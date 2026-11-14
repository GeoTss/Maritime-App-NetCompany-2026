import type Anthropic from "@anthropic-ai/sdk";

/**
 * Token usage as the Messages API reports it (the fields cost depends on). Accepts both the
 * stable and the beta usage shapes; absent or null counts are zero.
 */
export type LlmUsage = Pick<Anthropic.Messages.Usage, "input_tokens" | "output_tokens"> &
  Partial<
    Pick<
      Anthropic.Messages.Usage,
      "cache_read_input_tokens" | "cache_creation_input_tokens" | "cache_creation"
    >
  >;

/** USD per million tokens. */
interface Rates {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

interface ModelPricing {
  base: Rates;
  /** Rates for prompts above `promptTokens` (input + cache reads + cache writes). */
  longContext?: { aboveTokens: number; rates: Rates };
}

/**
 * Per-model rates from https://platform.claude.com/docs/en/about-claude/pricing (fetched
 * 2026-11-14). Every model the config accepts must have an entry.
 */
const PRICING: Record<string, ModelPricing> = {
  "claude-haiku-5-5": {
    base: { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
    longContext: {
      aboveTokens: 100_000,
      rates: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 },
    },
  },
  "claude-opus-5-5": {
    base: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  },
  "claude-sonnet-5-5": {
    base: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  },
};

/** Exact id, or the id followed by a dated snapshot suffix (`-YYYYMMDD`). */
function pricingFor(model: string): ModelPricing | undefined {
  const exact = PRICING[model];
  if (exact) return exact;
  const dated = /^(.+)-\d{8}$/.exec(model);
  return dated?.[1] ? PRICING[dated[1]] : undefined;
}

export function isPricedModel(model: string): boolean {
  return pricingFor(model) !== undefined;
}

/** Input tokens + cache reads + cache writes: what selects a long-context tier. */
export function promptTokensOf(usage: LlmUsage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

/** Cache writes split by TTL; without the split every write is priced as 5-minute. */
function cacheWrites(usage: LlmUsage): { m5: number; h1: number } {
  const split = usage.cache_creation;
  if (split) return { m5: split.ephemeral_5m_input_tokens, h1: split.ephemeral_1h_input_tokens };
  return { m5: usage.cache_creation_input_tokens ?? 0, h1: 0 };
}

/** Cost in USD of one call. Throws for a model with no pricing entry. */
export function costUsd(model: string, usage: LlmUsage, promptTokens: number): number {
  const pricing = pricingFor(model);
  if (!pricing) throw new Error(`No pricing entry for model "${model}" (see ai/pricing.ts)`);
  const rates =
    pricing.longContext && promptTokens > pricing.longContext.aboveTokens
      ? pricing.longContext.rates
      : pricing.base;
  const writes = cacheWrites(usage);
  const perMTok =
    usage.input_tokens * rates.input +
    (usage.cache_read_input_tokens ?? 0) * rates.cacheRead +
    writes.m5 * rates.cacheWrite5m +
    writes.h1 * rates.cacheWrite1h +
    usage.output_tokens * rates.output;
  return perMTok / 1_000_000;
}
