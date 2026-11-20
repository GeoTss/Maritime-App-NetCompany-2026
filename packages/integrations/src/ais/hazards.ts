import type { AisObservation, NavHazard } from "@pharos/shared";

export const HAZARD_LABEL_MAX = 160;

/** Hazards by id: the latest observation of each id wins. */
export type HazardMap = Map<string, NavHazard>;

const label = (s: string): string => s.trim().slice(0, HAZARD_LABEL_MAX);

/**
 * Fold one observation into hazard rows. The single rule, used by the ingest path and by
 * `recordedLiveData`:
 * - distress beacons and SAR aircraft are hazards at their own position;
 * - an aid to navigation is a hazard only when virtual (a physical buoy is not);
 * - a safety message sits at its sender's last known traffic position (`positionOf`) and is skipped
 *   when there is none.
 * The label is untrusted text, stored as data only.
 */
export function foldHazard(
  hazards: HazardMap,
  obs: AisObservation,
  at: Date,
  positionOf: (mmsi: string) => { lat: number; lon: number } | undefined,
): void {
  const put = (
    kind: NavHazard["kind"],
    mmsi: string,
    pos: { lat: number; lon: number },
    text: string,
  ) => {
    const id = `ais:${kind}:${mmsi}`;
    hazards.set(id, {
      id,
      kind,
      source: "ais",
      mmsi,
      lat: pos.lat,
      lon: pos.lon,
      label: label(text),
      radiusNm: null,
      observedAt: at,
    });
  };
  switch (obs.kind) {
    case "distress":
      put("distress_beacon", obs.mmsi, obs, `Distress beacon ${obs.mmsi}`);
      break;
    case "sar":
      put("sar_aircraft", obs.mmsi, obs, `SAR aircraft ${obs.mmsi}`);
      break;
    case "aton":
      if (obs.virtual)
        put("aton", obs.mmsi, obs, obs.name ?? `Virtual aid to navigation ${obs.mmsi}`);
      break;
    case "safety": {
      const pos = positionOf(obs.mmsi);
      if (pos) put("safety_message", obs.mmsi, pos, obs.text);
      break;
    }
    default:
      break;
  }
}
