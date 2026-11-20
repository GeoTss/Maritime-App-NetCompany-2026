/**
 * The supplier offers for a voyage's open requirement: received, still-valid quotes with a line of
 * the grade, the latest per supplier and port. Shared by the bunker plan and the route plan.
 */
import { isoDayAfter } from "@pharos/domain";
import type { FuelGrade, Id, Quote } from "@pharos/shared";
import { type BunkerOffer, optionIdFor } from "./seed/demo-plan.js";
import type { World } from "./seed/types.js";
import { openRequirements } from "./world-rules.js";

/** Why a quote can no longer be accepted: its status, its validity date, or null when it can. */
export function quoteExpiry(
  quote: Pick<Quote, "status" | "validUntil">,
  now: Date,
): "status" | "validUntil" | null {
  if (quote.status === "expired") return "status";
  if (quote.validUntil && isoDayAfter(quote.validUntil, 0) < isoDayAfter(now, 0)) {
    return "validUntil";
  }
  return null;
}

/** Received, still-valid quotes for the voyage's open requirements, oldest first. */
export function validQuotes(world: World, voyageId: Id, now: Date): Quote[] {
  const open = new Set(openRequirements(world, voyageId).map((r) => r.id));
  return world.quotes
    .filter(
      (q) =>
        q.requirementId !== null &&
        open.has(q.requirementId) &&
        q.status === "received" &&
        quoteExpiry(q, now) === null,
    )
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);
}

/**
 * One offer per supplier and port from `quotes` (the latest wins) for `grade`, in quote order.
 * With several grades on the voyage (`multi`), option ids carry the grade.
 */
export function offersFromQuotes(
  world: World,
  quotes: Quote[],
  grade: FuelGrade,
  multi: boolean,
): BunkerOffer[] {
  const latest = new Map<string, { quote: Quote; pricePerMt: number; qtyMt: number }>();
  for (const quote of quotes) {
    const line = world.quoteLines.find((l) => l.quoteId === quote.id && l.grade === grade);
    if (line) {
      latest.set(`${quote.supplierId}:${quote.portId}`, {
        quote,
        pricePerMt: line.pricePerMt,
        qtyMt: line.qtyMt,
      });
    }
  }
  const offers: BunkerOffer[] = [];
  for (const { quote: q, pricePerMt, qtyMt } of [...latest.values()].sort(
    (a, b) => a.quote.id - b.quote.id,
  )) {
    const port = world.ports.find((p) => p.id === q.portId);
    const supplier = world.suppliers.find((s) => s.id === q.supplierId);
    if (!port || !supplier) continue;
    const optionId = optionIdFor(port, supplier);
    offers.push({
      optionId: multi ? `${grade}-${optionId}` : optionId,
      quoteId: q.id,
      supplierId: supplier.id,
      portId: port.id,
      currency: q.currency,
      pricePerMt,
      bargeFee: q.bargeFee,
      qtyMt,
    });
  }
  return offers;
}

/** The offers for the voyage's open `grade` requirement at `now`. */
export function latestOffers(
  world: World,
  voyageId: Id,
  grade: FuelGrade,
  now: Date,
  multi: boolean,
): BunkerOffer[] {
  return offersFromQuotes(world, validQuotes(world, voyageId, now), grade, multi);
}
