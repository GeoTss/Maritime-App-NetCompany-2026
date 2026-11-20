/**
 * The one rule for "which voyage is a vessel on" and "which bunker requirements are open".
 * Pure: reads the loaded world only.
 */
import type { BunkerRequirement, FuelGrade, Id, Voyage } from "@pharos/shared";
import type { World } from "./seed/types.js";

/**
 * The vessel's underway voyage. Failing that, the planned voyage whose earliest port-call ETA is
 * soonest; ties, and planned voyages with no port calls (which come last), go by id. Null if none.
 */
export function currentVoyage(world: World, vesselId: Id): Voyage | null {
  const own = world.voyages.filter((v) => v.vesselId === vesselId);
  const underway = own.filter((v) => v.status === "underway").sort((a, b) => a.id - b.id)[0];
  if (underway) return underway;

  const firstEta = (voyageId: Id): number | null => {
    const etas = world.portCalls.filter((c) => c.voyageId === voyageId).map((c) => c.eta.getTime());
    return etas.length === 0 ? null : Math.min(...etas);
  };
  const planned = own
    .filter((v) => v.status === "planned")
    .map((v) => ({ voyage: v, eta: firstEta(v.id) }));
  planned.sort((a, b) => {
    if (a.eta !== null && b.eta !== null && a.eta !== b.eta) return a.eta - b.eta;
    if ((a.eta === null) !== (b.eta === null)) return a.eta === null ? 1 : -1;
    return a.voyage.id - b.voyage.id;
  });
  return planned[0]?.voyage ?? null;
}

/** The voyage's open bunker requirements, ordered by id; optionally only one grade. */
export function openRequirements(
  world: World,
  voyageId: Id,
  grade?: FuelGrade,
): BunkerRequirement[] {
  return world.bunkerRequirements
    .filter((r) => r.voyageId === voyageId && r.status === "open" && (!grade || r.grade === grade))
    .sort((a, b) => a.id - b.id);
}
