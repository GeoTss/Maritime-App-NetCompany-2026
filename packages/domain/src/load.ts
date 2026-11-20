/**
 * Load condition: how laden a ship is, and how much that changes its main-engine burn.
 * Admiralty law: at a given speed, power (and so fuel) scales with displacement^(2/3). The
 * consumption curve's reference is the full-load displacement (lightship + deadweight), so a ship
 * in ballast burns less than its curve says (Phase 6 Rulings R1–R3). Pure.
 */
import { type ConsumptionCurve, LoadCondition } from "@pharos/shared";
import {
  DRAUGHT_BALLAST_SHARE,
  DRAUGHT_LADEN_SHARE,
  type ReferenceVesselProfile,
} from "./constants.js";

/** Displacement = lightship + cargo + ballast water, mt. */
export function displacementMt(v: {
  lightshipMt: number;
  cargoMt: number;
  ballastMt: number;
}): number {
  if (!(v.lightshipMt > 0)) throw new RangeError("lightshipMt must be > 0");
  if (!(v.cargoMt >= 0)) throw new RangeError("cargoMt must be >= 0");
  if (!(v.ballastMt >= 0)) throw new RangeError("ballastMt must be >= 0");
  return v.lightshipMt + v.cargoMt + v.ballastMt;
}

/** (displacement / reference displacement)^(2/3); 1 without a load. */
export function loadFactor(load: LoadCondition | undefined): number {
  if (load === undefined) return 1;
  return (load.displacementMt / load.refDisplacementMt) ** (2 / 3);
}

/**
 * A fleet voyage's load: displacement from the voyage's cargo and ballast against the vessel's
 * full-load displacement (lightship + deadweight). Cargo plus ballast above deadweight is rejected.
 */
export function voyageLoad(
  vessel: { lightshipMt: number; dwt: number },
  voyage: { cargoMt: number; ballastMt: number },
): LoadCondition {
  if (voyage.cargoMt + voyage.ballastMt > vessel.dwt) {
    throw new RangeError(
      `cargo ${voyage.cargoMt} + ballast ${voyage.ballastMt} mt exceeds deadweight ${vessel.dwt} mt`,
    );
  }
  return {
    displacementMt: displacementMt({ lightshipMt: vessel.lightshipMt, ...voyage }),
    refDisplacementMt: vessel.lightshipMt + vessel.dwt,
  };
}

/** The curve with this load condition attached (a copy; the load is validated). */
export function withLoad(curve: ConsumptionCurve, load: LoadCondition): ConsumptionCurve {
  return { ...curve, load: LoadCondition.parse(load) };
}

export type DraughtCondition = "laden" | "partial" | "ballast" | "assumed_laden";

/**
 * A planning-grade load from a reported draught: the share of the way from the profile's ballast
 * to its laden draught (clamped to 0..1) sets the displacement linearly between the ballast
 * displacement (lightship + ballast water) and full load. At or above DRAUGHT_LADEN_SHARE the
 * condition is "laden", at or below DRAUGHT_BALLAST_SHARE "ballast", else "partial". A missing or
 * zero draught is "assumed_laden" at full load (factor 1, the cautious side).
 */
export function draughtLoad(
  profile: ReferenceVesselProfile,
  draughtM: number | null,
): { condition: DraughtCondition; load: LoadCondition } {
  const ref = profile.lightshipMt + profile.dwtMt;
  if (draughtM === null || !(draughtM > 0)) {
    return { condition: "assumed_laden", load: { displacementMt: ref, refDisplacementMt: ref } };
  }
  const span = profile.ladenDraughtM - profile.ballastDraughtM;
  const share = Math.min(1, Math.max(0, (draughtM - profile.ballastDraughtM) / span));
  const ballast = profile.lightshipMt + profile.ballastMt;
  const condition: DraughtCondition =
    share >= DRAUGHT_LADEN_SHARE ? "laden" : share <= DRAUGHT_BALLAST_SHARE ? "ballast" : "partial";
  return {
    condition,
    load: { displacementMt: ballast + share * (ref - ballast), refDisplacementMt: ref },
  };
}
