/**
 * The extraction eval world (ruling R1): the seed world plus one open bunker requirement for
 * every vessel whose current voyage has none, so every generated quote can target a real vessel
 * with an open requirement. Truth generation and the Task 10 runner both use it; the runner
 * inserts `evalExtraRequirements(world)` after seeding. The demo seed itself is untouched.
 */
import { currentVoyage, generateWorld, openRequirements, type World } from "@pharos/db";
import { type BunkerRequirement, FUEL_GRADES, type FuelGrade, type Id } from "@pharos/shared";
import { createPrng, prngPick } from "./prng.js";

export const EVAL_SEED = 20261114;
export const EVAL_ANCHOR = new Date("2026-11-14T08:00:00Z");

/** Requirement quantities are whole multiples of this, never below it. */
const QTY_STEP_MT = 25;

/** The vessel's remaining on board per grade from its latest noon report (0 if none). */
export function latestRob(world: World, vesselId: Id): Record<FuelGrade, number> {
  const latest = world.noonReports
    .filter((r) => r.vesselId === vesselId)
    .reduce<World["noonReports"][number] | null>(
      (best, r) => (best === null || r.ts > best.ts ? r : best),
      null,
    );
  return latest ? { ...latest.robMt } : { LSMGO: 0, VLSFO: 0, HSFO: 0 };
}

/** Free tank space per grade: capacity minus the latest ROB, never negative. */
export function freeSpace(world: World, vesselId: Id): Record<FuelGrade, number> {
  const vessel = world.vessels.find((v) => v.id === vesselId);
  if (!vessel) throw new Error(`no vessel ${vesselId}`);
  const rob = latestRob(world, vesselId);
  const out = { LSMGO: 0, VLSFO: 0, HSFO: 0 };
  for (const g of FUEL_GRADES) out[g] = Math.max(0, vessel.tankCapacityMt[g] - rob[g]);
  return out;
}

/**
 * One deterministic open requirement per vessel (in id order) whose current voyage has no open
 * requirement. Grade: a seeded pick among grades with tank capacity > 0 and free space for at
 * least one step. Quantity: 55-90 % of the free space, rounded down to 25 mt (so it is also
 * ≤ the tank capacity). Ids continue after the world's highest requirement id.
 */
export function evalExtraRequirements(world: World): BunkerRequirement[] {
  const prng = createPrng(EVAL_SEED);
  let nextId = Math.max(0, ...world.bunkerRequirements.map((r) => r.id)) + 1;
  const rows: BunkerRequirement[] = [];
  for (const vessel of [...world.vessels].sort((a, b) => a.id - b.id)) {
    const voyage = currentVoyage(world, vessel.id);
    if (!voyage || openRequirements(world, voyage.id).length > 0) continue;
    const free = freeSpace(world, vessel.id);
    const grades = FUEL_GRADES.filter(
      (g) => vessel.tankCapacityMt[g] > 0 && free[g] >= QTY_STEP_MT,
    );
    const grade = prngPick(prng, grades);
    const fraction = 0.55 + prng() * 0.35;
    const qtyMt = Math.max(
      QTY_STEP_MT,
      Math.floor((free[grade] * fraction) / QTY_STEP_MT) * QTY_STEP_MT,
    );
    rows.push({
      id: nextId++,
      voyageId: voyage.id,
      grade,
      qtyMt,
      status: "open",
      createdAt: new Date(EVAL_ANCHOR.getTime()),
    });
  }
  return rows;
}

/** generateWorld(EVAL_SEED, EVAL_ANCHOR) with the eval requirements added. */
export function evalWorld(): World {
  const world = generateWorld({ seed: EVAL_SEED, anchor: EVAL_ANCHOR });
  return {
    ...world,
    bunkerRequirements: [...world.bunkerRequirements, ...evalExtraRequirements(world)],
  };
}

/** The vessel's one open requirement in the eval world (every vessel has exactly one). */
export function openRequirementOf(world: World, vesselId: Id): BunkerRequirement {
  const voyage = currentVoyage(world, vesselId);
  const reqs = voyage ? openRequirements(world, voyage.id) : [];
  const req = reqs[0];
  if (!req || reqs.length !== 1) {
    throw new Error(`vessel ${vesselId} has ${reqs.length} open requirements in the eval world`);
  }
  return req;
}

/** Latest market price (USD/mt) for a grade at a port. */
export function marketPriceUsd(world: World, portId: Id, grade: FuelGrade): number {
  const rows = world.portFuelPrices.filter((p) => p.portId === portId && p.grade === grade);
  const latest = rows.reduce<(typeof rows)[number] | null>(
    (best, r) => (best === null || r.asOf > best.asOf ? r : best),
    null,
  );
  if (!latest) throw new Error(`no ${grade} market price at port ${portId}`);
  return latest.priceUsdPerMt;
}

/** USD per EUR from the latest EURUSD reference rate. */
export function eurUsd(world: World): number {
  const rows = world.referenceRates.filter((r) => r.kind === "fx" && r.key === "EURUSD");
  const latest = rows.reduce<(typeof rows)[number] | null>(
    (best, r) => (best === null || r.asOf > best.asOf ? r : best),
    null,
  );
  if (!latest) throw new Error("no EURUSD reference rate");
  return latest.value;
}
