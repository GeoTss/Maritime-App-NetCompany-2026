import { useMemo, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function store(query: string, fallback: boolean) {
  const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";
  return {
    subscribe(onChange: () => void) {
      if (!supported()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    snapshot: () => (supported() ? window.matchMedia(query).matches : fallback),
    server: () => fallback,
  };
}

/** True while the media query matches, e.g. `(min-width: 768px)`; follows changes live. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const s = useMemo(() => store(query, fallback), [query, fallback]);
  return useSyncExternalStore(s.subscribe, s.snapshot, s.server);
}

/** True while the operator asks for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION, false);
}
