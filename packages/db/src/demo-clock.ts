/**
 * The demo's two constants, defined once here because this package anchors the world: the seed of
 * the synthetic world's PRNG, and how far after the anchor a pinned clock stands.
 */

/** Seed of the synthetic world's PRNG when WORLD_SEED is unset. */
export const DEFAULT_WORLD_SEED = 20261114;

/** How far after the anchor a pinned clock stands (the same offset as the demo-ask fixture). */
export const PINNED_NOW_OFFSET_MS = 5 * 60_000;

/** The frozen `now` of a clock pinned at `anchor`. */
export const pinnedNow = (anchor: Date): Date => new Date(anchor.getTime() + PINNED_NOW_OFFSET_MS);
