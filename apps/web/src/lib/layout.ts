/**
 * Which parts of the console are open: the Needs you column, the assistant dock, the map's layer
 * controls, the folded side-column sections, and focus mode (all of them out of the way at once).
 * One small store so the top bar can open what the map page draws. Panels are remembered per
 * browser (a viewer's convenience: storage may be off, so every read and write is guarded); focus
 * mode is not, so a reload never opens a console with everything hidden.
 */
import { useSyncExternalStore } from "react";

export interface Layout {
  needs: boolean;
  dock: boolean;
  controls: boolean;
  focus: boolean;
  /** The "Fuel on board" section of the Needs you column is open. */
  fuel: boolean;
  /** The "Danger areas" section of the Needs you column is open. */
  danger: boolean;
}

export const LAYOUT_KEY = "pharos.layout.v1";

const DEFAULT: Layout = {
  needs: true,
  dock: true,
  controls: true,
  focus: false,
  fuel: false,
  danger: false,
};
const REMEMBERED = ["needs", "dock", "controls", "fuel", "danger"] as const;

function load(): Layout {
  const out = { ...DEFAULT };
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Record<string, unknown>;
    for (const key of REMEMBERED) if (typeof raw[key] === "boolean") out[key] = raw[key];
  } catch {
    // No storage, or something unreadable in it: the defaults stand.
  }
  return out;
}

let state: Layout = load();
const listeners = new Set<() => void>();

export const getLayout = (): Layout => state;

export function setLayout(patch: Partial<Layout>): void {
  const next = { ...state, ...patch };
  if (Object.keys(next).every((k) => next[k as keyof Layout] === state[k as keyof Layout])) return;
  state = next;
  try {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify(Object.fromEntries(REMEMBERED.map((k) => [k, state[k]]))),
    );
  } catch {
    // Not remembered this time; the console still works.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLayout = (): Layout => useSyncExternalStore(subscribe, getLayout, getLayout);

/** Tests: back to the defaults (or to what storage holds), forgetting what was stored unless reloading. */
export function resetLayout({ reload = false }: { reload?: boolean } = {}): void {
  if (!reload) {
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      // nothing to forget
    }
  }
  state = reload ? load() : { ...DEFAULT };
  for (const listener of listeners) listener();
}
