import { DEFAULT_WORLD_SEED } from "../demo-clock.js";

/** Largest seed accepted: the world_meta.seed column is a Postgres integer. */
export const MAX_WORLD_SEED = 2_147_483_647;

/**
 * Parses WORLD_SEED: decimal digits only (no sign, hex, exponent or fraction), 0..2147483647.
 * The error names the variable, never its value.
 */
export function parseWorldSeed(raw: string | undefined): number {
  const text = raw?.trim();
  if (!text) return DEFAULT_WORLD_SEED;
  const seed = /^\d{1,10}$/.test(text) ? Number(text) : Number.NaN;
  if (!(seed <= MAX_WORLD_SEED)) {
    throw new RangeError(
      `WORLD_SEED must be a whole number from 0 to ${MAX_WORLD_SEED}, written in decimal digits`,
    );
  }
  return seed;
}
