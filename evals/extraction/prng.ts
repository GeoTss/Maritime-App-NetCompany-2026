/**
 * Seeded randomness for the golden-set generator. mulberry32, the same algorithm as
 * packages/db/src/seed/prng.ts (copied: that module is not exported from @pharos/db).
 * Never use Math.random() or the clock in generator code.
 */
import { createHash } from "node:crypto";

export type Prng = () => number;

/** mulberry32: a 32-bit seeded generator returning floats in [0, 1). */
export function createPrng(seed: number): Prng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive. */
export function prngInt(prng: Prng, min: number, max: number): number {
  return min + Math.floor(prng() * (max - min + 1));
}

export function prngPick<T>(prng: Prng, items: readonly T[]): T {
  const item = items[Math.floor(prng() * items.length)];
  if (item === undefined) throw new RangeError("cannot pick from an empty list");
  return item;
}

/** True with probability p. */
export function prngChance(prng: Prng, p: number): boolean {
  return prng() < p;
}

/** Hex sha256 of a string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * One independent stream per case, from sha256("case:<seed>:<id>"), so changing one case's
 * template never shifts the draws of another case.
 */
export function casePrng(seed: number, id: string): Prng {
  return createPrng(Number.parseInt(sha256Hex(`case:${seed}:${id}`).slice(0, 8), 16));
}
