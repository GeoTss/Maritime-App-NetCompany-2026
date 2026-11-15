/**
 * The clock every request path reads (ask agent and its tools, live routes, inbox and review,
 * approvals and the executor). Pinned to a demo anchor (DEMO_ANCHOR), `now()` is frozen at
 * anchor + 5 min, so tool results, stored rows and therefore model request bodies are the same on
 * every run and recorded model replies replay. Unpinned, it is the wall clock.
 */

/** How far after the anchor a pinned clock stands (the same offset as the demo-ask fixture). */
export const PINNED_NOW_OFFSET_MS = 5 * 60_000;

export interface Clock {
  /** The pinned demo anchor, or null when the clock is the wall clock. */
  anchor: () => Date | null;
  now: () => Date;
  pinned: boolean;
}

/** The frozen `now` of a clock pinned at `anchor`. */
export const pinnedNow = (anchor: Date): Date => new Date(anchor.getTime() + PINNED_NOW_OFFSET_MS);

export function createClock(demoAnchor: Date | null): Clock {
  if (demoAnchor === null) {
    return { anchor: () => null, now: () => new Date(), pinned: false };
  }
  const anchorMs = demoAnchor.getTime();
  const nowMs = pinnedNow(demoAnchor).getTime();
  // Fresh Date objects each call: a caller mutating one cannot move the clock.
  return { anchor: () => new Date(anchorMs), now: () => new Date(nowMs), pinned: true };
}
