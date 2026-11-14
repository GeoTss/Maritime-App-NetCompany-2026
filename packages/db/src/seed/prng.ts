/** Seeded PRNG for the synthetic world (mulberry32). Never use Math.random() in seed code. */
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
