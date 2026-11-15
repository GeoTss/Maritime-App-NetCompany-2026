export interface AisProvider {
  mode: "live" | "replay" | "simulator";
  /** Emit raw messages until `signal` aborts. Resolves on abort (or at the end of a non-looping source). */
  run(onMessage: (raw: unknown) => void, signal: AbortSignal): Promise<void>;
}

/** Sleep that ends early (without throwing) when the signal aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
