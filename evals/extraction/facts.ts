/**
 * Truth-level facts for a generated quote, drawn from the eval world with the case's PRNG
 * before anything is rendered. Every generated quote: a real vessel with an open requirement, a
 * port on its voyage served by the supplier, the required grade (plus extra grades with tank
 * capacity), qty ≤ free tank space (so ≤ capacity), price within ±10 % of the port's latest
 * market price (EUR via the latest EURUSD rate), and dates after the received time.
 */
import type { World } from "@pharos/db";
import { SUPPLIERS } from "@pharos/db";
import {
  type Currency,
  FUEL_GRADES,
  type FuelGrade,
  type Port,
  type Supplier,
  type TruthQuote,
  type Vessel,
} from "@pharos/shared";
import { type Prng, prngChance, prngInt, prngPick } from "./prng.js";
import { addDays, isoDay } from "./templates/phrasing.js";
import { EVAL_ANCHOR, eurUsd, freeSpace, marketPriceUsd, openRequirementOf } from "./world.js";

/** Generated prices stay inside this fraction of the market price (the pipeline allows 15 %). */
export const GENERATED_BAND = 0.1;

export interface FactLine {
  grade: FuelGrade;
  qtyMt: number;
  pricePerMt: number;
}

export type BargeFacts = { kind: "none" } | { kind: "lump_sum"; amount: number };

export interface QuoteFacts {
  vessel: Vessel;
  port: Port;
  supplier: Supplier & { key: string };
  currency: Currency;
  lines: FactLine[];
  barge: BargeFacts;
  receivedAt: Date;
  validUntil: string;
  deliveryFrom: string;
  deliveryTo: string;
}

export function supplierWithKey(world: World, key: string): Supplier & { key: string } {
  const index = SUPPLIERS.findIndex((s) => s.key === key);
  const row = world.suppliers[index];
  if (index < 0 || !row || row.name !== SUPPLIERS[index]?.name) {
    throw new Error(`unknown supplier ${key}`);
  }
  return { ...row, key };
}

export function supplierKeyOf(world: World, supplierId: number): string {
  const row = world.suppliers.find((s) => s.id === supplierId);
  const key = SUPPLIERS.find((s) => s.name === row?.name)?.key;
  if (!key) throw new Error(`no supplier key for id ${supplierId}`);
  return key;
}

/** A price per mt near the market: ±7 % before rounding to 0.25/0.5/1, checked against ±10 %. */
export function drawPrice(
  prng: Prng,
  world: World,
  portId: number,
  grade: FuelGrade,
  currency: Currency,
): number {
  const rate = currency === "USD" ? 1 : eurUsd(world);
  const market = marketPriceUsd(world, portId, grade);
  const raw = (market / rate) * (1 + (prng() * 0.14 - 0.07));
  const step = prngPick(prng, [1, 1, 0.5, 0.25]);
  const price = Math.round(raw / step) * step;
  if (Math.abs(price * rate - market) / market > GENERATED_BAND) {
    throw new Error(`drawn price ${price} ${currency} is outside the generated band`);
  }
  return price;
}

/** A quantity in steps of 25 mt between 50 mt and the free tank space. */
function drawQty(prng: Prng, free: number, preferred: number | null): number {
  if (preferred !== null && preferred <= free && prngChance(prng, 0.7)) return preferred;
  const max = Math.floor(Math.min(free, 1500) / 25);
  return 25 * prngInt(prng, Math.min(2, max), max);
}

/**
 * Ports the voyage has still to call at (ETA at or after the anchor) where some supplier
 * operates; all served route ports if none is upcoming.
 */
export function upcomingServedPorts(world: World, voyageId: number): number[] {
  const voyage = world.voyages.find((v) => v.id === voyageId);
  if (!voyage) throw new Error(`no voyage ${voyageId}`);
  const served = voyage.plannedRoute.filter((portId) =>
    world.suppliers.some((s) => s.portIds.includes(portId)),
  );
  const upcoming = served.filter((portId) =>
    world.portCalls.some(
      (c) => c.voyageId === voyageId && c.portId === portId && c.eta >= EVAL_ANCHOR,
    ),
  );
  return upcoming.length > 0 ? upcoming : served;
}

export interface FactOptions {
  currency: Currency;
  /** Additional grades after the required one (multi-grade quotes). */
  extraGrades?: number;
  /** Probability that the barge fee is not quoted (truth 0). */
  noBargeChance?: number;
}

export function drawQuoteFacts(prng: Prng, world: World, opts: FactOptions): QuoteFacts {
  const vessel = prngPick(prng, world.vessels);
  const requirement = openRequirementOf(world, vessel.id);
  const voyage = world.voyages.find((v) => v.id === requirement.voyageId);
  if (!voyage) throw new Error(`no voyage ${requirement.voyageId}`);
  // Supplier first (among those at the vessel's upcoming calls), then one of its ports there,
  // so a supplier serving several upcoming ports is not over-represented.
  const served = upcomingServedPorts(world, voyage.id);
  const supplierRow = prngPick(
    prng,
    world.suppliers.filter((s) => s.portIds.some((id) => served.includes(id))),
  );
  const portId = prngPick(
    prng,
    served.filter((id) => supplierRow.portIds.includes(id)),
  );
  const port = world.ports.find((p) => p.id === portId);
  if (!port) throw new Error(`no port ${portId}`);
  const supplier = { ...supplierRow, key: supplierKeyOf(world, supplierRow.id) };

  const free = freeSpace(world, vessel.id);
  const grades: FuelGrade[] = [requirement.grade];
  const others = FUEL_GRADES.filter(
    (g) => g !== requirement.grade && vessel.tankCapacityMt[g] > 0 && free[g] >= 50,
  );
  for (let i = 0; i < (opts.extraGrades ?? 0); i++) {
    const left = others.filter((g) => !grades.includes(g));
    grades.push(prngPick(prng, left));
  }
  const lines = grades.map((grade) => ({
    grade,
    qtyMt: drawQty(prng, free[grade], grade === requirement.grade ? requirement.qtyMt : null),
    pricePerMt: drawPrice(prng, world, port.id, grade, opts.currency),
  }));

  const barge: BargeFacts = prngChance(prng, opts.noBargeChance ?? 0.25)
    ? { kind: "none" }
    : { kind: "lump_sum", amount: 50 * prngInt(prng, 24, 72) };

  // Received between 44 h and 2 h before the anchor, on a whole minute.
  const receivedAt = new Date(EVAL_ANCHOR.getTime() - prngInt(prng, 120, 44 * 60) * 60_000);
  const firstValidDay = [addDays(isoDay(receivedAt), 1), isoDay(EVAL_ANCHOR)].sort().at(-1);
  const validUntil = addDays(firstValidDay as string, prngInt(prng, 0, 2));
  const deliveryFrom = addDays(validUntil, prngInt(prng, 1, 8));
  // Always a real span (from ≠ to): a single date does not fill both ends of the window.
  const deliveryTo = addDays(deliveryFrom, prngPick(prng, [1, 2, 2, 3]));

  return {
    vessel,
    port,
    supplier,
    currency: opts.currency,
    lines,
    barge,
    receivedAt,
    validUntil,
    deliveryFrom,
    deliveryTo,
  };
}

/** The truth quote a perfect transcription plus Pharos's normalisers yields for these facts. */
export function truthFromFacts(f: QuoteFacts): TruthQuote {
  return {
    vesselImo: f.vessel.imo,
    portUnlocode: f.port.unlocode,
    supplierKey: f.supplier.key,
    currency: f.currency,
    validUntil: f.validUntil,
    deliveryFrom: f.deliveryFrom,
    deliveryTo: f.deliveryTo,
    bargeFee: f.barge.kind === "lump_sum" ? f.barge.amount : 0,
    lines: f.lines.map((l) => ({ grade: l.grade, qtyMt: l.qtyMt, pricePerMt: l.pricePerMt })),
  };
}
