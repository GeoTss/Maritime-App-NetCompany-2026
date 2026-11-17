/**
 * The one place a voyage instruction's link to its purchase order is resolved (spec §5). The link is
 * derived, never stored: an instruction on a route plan's bunker stop depends on a purchase order
 * of the same voyage for the stop's quote. `propose_action`, the approval views and the executor
 * all call `orderDependencyOf`, so they agree on it.
 *
 * The matching order is the latest non-rejected purchase-order proposal of the voyage whose option
 * buys from that quote (a bunker plan option or a route plan's stop plan), preferring one that is
 * already approved, executing or executed: a later duplicate proposal never blocks an instruction
 * whose order went through. Only those three states satisfy the dependency.
 */
import type { Sql } from "@pharos/db";
import { Id, type RecommendationDependency, RecommendationStatus } from "@pharos/shared";
import { z } from "zod";

/** The states of a purchase-order proposal that let its instruction be approved. */
const SATISFIED: ReadonlySet<RecommendationStatus> = new Set(["approved", "executing", "executed"]);

/** The quote ids a stored calculation's options buy from; the rest of the calculation is ignored. */
const BunkerQuotes = z.object({
  options: z.array(z.object({ optionId: z.string(), quoteId: Id.nullable() })),
});
const StopQuotes = z.object({
  stopPlans: z.array(z.object({ optionId: z.string(), quoteId: Id.nullable() })),
});

/** A connection or the transaction the executor holds (postgres.js `TransactionSql`). */
type Db = Sql | Parameters<Parameters<Sql["begin"]>[1]>[0];

interface StoredCalculation {
  kind: string;
  inputs: unknown;
  outputs: unknown;
}

/** The quote a route plan's stop plan buys from; null for a route with no stop or no quote. */
export function stopQuoteOf(outputs: unknown, optionId: string): Id | null {
  const parsed = StopQuotes.safeParse(outputs);
  if (!parsed.success) return null;
  return parsed.data.stopPlans.find((s) => s.optionId === optionId)?.quoteId ?? null;
}

/**
 * The quote a purchase-order proposal buys from: its bunker plan option's (from the plan's inputs)
 * or its route plan stop's (from the plan's outputs). Null when the calculation is unreadable.
 */
export function orderQuoteOf(calc: StoredCalculation, optionId: string): Id | null {
  if (calc.kind === "route_speed") return stopQuoteOf(calc.outputs, optionId);
  if (calc.kind !== "bunker_plan") return null;
  const parsed = BunkerQuotes.safeParse(calc.inputs);
  if (!parsed.success) return null;
  return parsed.data.options.find((o) => o.optionId === optionId)?.quoteId ?? null;
}

/**
 * The purchase order a recommendation waits for, or null when it waits for none: a purchase order,
 * an instruction on a route with no stop, a stop without a received quote, or a plan with no
 * voyage of ours.
 */
export async function orderDependencyOf(
  sql: Db,
  rec: { type: string; calculation_id: Id; option_id: string },
): Promise<RecommendationDependency | null> {
  if (rec.type !== "voyage_instruction") return null;
  const [calc] = await sql<{ kind: string; outputs: unknown; voyage_id: number | null }[]>`
    select kind, outputs, voyage_id from calculations where id = ${rec.calculation_id}`;
  if (calc?.kind !== "route_speed" || calc.voyage_id === null) return null;
  const quoteId = stopQuoteOf(calc.outputs, rec.option_id);
  if (quoteId === null) return null;

  const [names] = await sql<{ supplier: string; port: string }[]>`
    select s.name as supplier, p.name as port
    from quotes q join suppliers s on s.id = q.supplier_id join ports p on p.id = q.port_id
    where q.id = ${quoteId}`;
  const orders = await sql<
    ({ id: number; status: RecommendationStatus; option_id: string } & StoredCalculation)[]
  >`
    select r.id, r.status, r.option_id, c.kind, c.inputs, c.outputs
    from recommendations r join calculations c on c.id = r.calculation_id
    where r.type = 'purchase_order' and r.status <> 'rejected' and c.voyage_id = ${calc.voyage_id}
    order by r.id desc`;
  const matching = orders.filter((o) => orderQuoteOf(o, o.option_id) === quoteId);
  const match = matching.find((o) => SATISFIED.has(o.status)) ?? matching[0] ?? null;
  return {
    quoteId,
    optionLabel: names ? `${names.supplier} at ${names.port}` : `quote ${quoteId}`,
    recommendationId: match?.id ?? null,
    status: match ? RecommendationStatus.parse(match.status) : null,
    satisfied: match !== null && SATISFIED.has(match.status),
  };
}

/** Why an instruction cannot be approved yet, in the operator's words. */
export function unmetDependencyMessage(dep: RecommendationDependency): string {
  const why =
    dep.recommendationId === null
      ? "none has been proposed yet"
      : `proposal ${dep.recommendationId} is ${dep.status}`;
  return `It needs an approved purchase order for ${dep.optionLabel} before it can be approved; ${why}.`;
}
