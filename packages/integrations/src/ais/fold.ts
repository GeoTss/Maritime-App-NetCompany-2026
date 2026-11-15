import type { AisObservation, AisTraffic } from "@pharos/shared";

export interface HeldStatic {
  name: string | null;
  shipType: string | null;
  destination: string | null;
}

/** `rows`: latest traffic per MMSI. `held`: static data waiting for that MMSI's first position. */
export interface FoldState {
  rows: Map<string, AisTraffic>;
  held: Map<string, HeldStatic>;
}

export const newFoldState = (held: Map<string, HeldStatic> = new Map()): FoldState => ({
  rows: new Map(),
  held,
});

/**
 * Fold one observation into traffic rows. The single merge rule, used by the ingest path and by
 * `recordedLiveData`: position fields (lat, lon, speed, status, time) always take the newest
 * message; name, ship type and destination take the newest non-null value and otherwise keep the
 * previous one. Static data that precedes a position is held, then applied to that position's row.
 */
export type TrafficObservation = Extract<AisObservation, { kind: "position" | "static" }>;

export function foldObservation(state: FoldState, obs: TrafficObservation, at: Date): void {
  const prev = state.rows.get(obs.mmsi);
  if (obs.kind === "static") {
    if (prev) {
      state.rows.set(obs.mmsi, {
        ...prev,
        name: obs.name ?? prev.name,
        shipType: obs.shipType ?? prev.shipType,
        destination: obs.destination ?? prev.destination,
      });
    } else {
      const h = state.held.get(obs.mmsi);
      state.held.set(obs.mmsi, {
        name: obs.name ?? h?.name ?? null,
        shipType: obs.shipType ?? h?.shipType ?? null,
        destination: obs.destination ?? h?.destination ?? null,
      });
    }
    return;
  }
  const h = state.held.get(obs.mmsi);
  state.held.delete(obs.mmsi);
  state.rows.set(obs.mmsi, {
    mmsi: obs.mmsi,
    name: obs.name ?? prev?.name ?? h?.name ?? null,
    shipType: prev?.shipType ?? h?.shipType ?? null,
    lat: obs.lat,
    lon: obs.lon,
    sogKn: obs.sogKn,
    navStatus: obs.navStatus,
    destination: prev?.destination ?? h?.destination ?? null,
    // Type plumbing only (Phase 6 task 2); Phase 6 task 3 parses draught and course.
    draughtM: null,
    cogDeg: null,
    updatedAt: at,
  });
}
