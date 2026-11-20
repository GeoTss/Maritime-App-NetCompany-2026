/**
 * The one place a voyage instruction's links to its orders are resolved (spec §5). The links are
 * derived, never stored: an instruction on a route plan's bunker stop depends on a purchase order
 * of the same voyage for the stop's quote, and one whose route or stop plan needs an armed team on
 * the security order for that team's quote (Track 3). `propose_action`, the approval views and the
 * executor all call this module, so they agree on it.
 *
 * The matching order is the latest non-rejected purchase-order proposal of the voyage whose option
 * buys from that quote (a bunker plan option or a route plan's stop plan), preferring one that is
 * already approved, executing or executed: a later duplicate proposal never blocks an instruction
 * whose order went through. Only those three states satisfy the dependency.
 */
import type { Sql } from "@pharos/db";
import { Id, type RecommendationDependency, RecommendationStatus } from "@pharos/shared";
import { z } from "zod";
import { securityQuoteOf } from "./existing.js";

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

type Rec = { type: string; calculation_id: Id; option_id: string };

/**
 * Every order a voyage instruction waits for, purchase order first: the purchase order for its
 * bunker stop's quote, and the security order for the team its route or stop plan needs. Empty
 * for anything else: a purchase or security order, an option with neither, or a plan with no
 * voyage of ours.
 */
export async function orderDependenciesOf(sql: Db, rec: Rec): Promise<RecommendationDependency[]> {
  if (rec.type !== "voyage_instruction") return [];
  const [calc] = await sql<{ kind: string; outputs: unknown; voyage_id: number | null }[]>`
    select kind, outputs, voyage_id from calculations where id = ${rec.calculation_id}`;
  if (calc?.kind !== "route_speed" || calc.voyage_id === null) return [];
  const out: RecommendationDependency[] = [];
  const quoteId = stopQuoteOf(calc.outputs, rec.option_id);
  if (quoteId !== null) out.push(await purchaseDependencyOf(sql, calc.voyage_id, quoteId));
  const security = await securityDependencyOf(sql, calc, rec.option_id);
  if (security) out.push(security);
  return out;
}

/**
 * The order a recommendation waits for now: the first unmet one, else the first. Null when it
 * waits for none. Approving is refused while this is unmet, so an instruction with both orders
 * waits for both.
 */
export async function orderDependencyOf(
  sql: Db,
  rec: Rec,
): Promise<RecommendationDependency | null> {
  const all = await orderDependenciesOf(sql, rec);
  return all.find((d) => !d.satisfied) ?? all[0] ?? null;
}

/** The purchase-order proposal of the voyage for a bunker stop's quote. */
async function purchaseDependencyOf(
  sql: Db,
  voyageId: number,
  quoteId: Id,
): Promise<RecommendationDependency> {
  const [names] = await sql<{ supplier: string; port: string }[]>`
    select s.name as supplier, p.name as port
    from quotes q join suppliers s on s.id = q.supplier_id join ports p on p.id = q.port_id
    where q.id = ${quoteId}`;
  const orders = await sql<
    ({ id: number; status: RecommendationStatus; option_id: string } & StoredCalculation)[]
  >`
    select r.id, r.status, r.option_id, c.kind, c.inputs, c.outputs
    from recommendations r join calculations c on c.id = r.calculation_id
    where r.type = 'purchase_order' and c.voyage_id = ${voyageId}
    order by r.id desc`;
  const matching = orders.filter((o) => orderQuoteOf(o, o.option_id) === quoteId);
  // An approved (or executing, executed) order wins; else the latest live one; else the latest
  // rejected one, so the operator is told the order was rejected rather than never proposed.
  const match =
    matching.find((o) => SATISFIED.has(o.status)) ??
    matching.find((o) => o.status !== "rejected") ??
    matching[0] ??
    null;
  return {
    quoteId,
    optionLabel: names ? `${names.supplier} at ${names.port}` : `quote ${quoteId}`,
    recommendationId: match?.id ?? null,
    status: match ? RecommendationStatus.parse(match.status) : null,
    satisfied: match !== null && SATISFIED.has(match.status),
  };
}

/**
 * Track 3: an instruction on a route or bunker stop plan whose security plan needs a team waits
 * for the security order of the same voyage for that quote. Null when it needs no team or has no
 * quote.
 */
async function securityDependencyOf(
  sql: Db,
  calc: { outputs: unknown; voyage_id: number | null },
  optionId: string,
): Promise<RecommendationDependency | null> {
  const quoteId = securityQuoteOf(calc.outputs, optionId);
  if (quoteId === null || calc.voyage_id === null) return null;
  const [names] = await sql<{ provider: string; embark: string; disembark: string }[]>`
    select p.name as provider, e.name as embark, d.name as disembark
    from security_quotes q join security_providers p on p.id = q.provider_id
      join ports e on e.id = q.embark_port_id join ports d on d.id = q.disembark_port_id
    where q.id = ${quoteId}`;
  const orders = await sql<
    { id: number; status: RecommendationStatus; option_id: string; outputs: unknown }[]
  >`
    select r.id, r.status, r.option_id, c.outputs
    from recommendations r join calculations c on c.id = r.calculation_id
    where r.type = 'security_order' and c.voyage_id = ${calc.voyage_id}
    order by r.id desc`;
  const matching = orders.filter((o) => securityQuoteOf(o.outputs, o.option_id) === quoteId);
  const match =
    matching.find((o) => SATISFIED.has(o.status)) ??
    matching.find((o) => o.status !== "rejected") ??
    matching[0] ??
    null;
  return {
    quoteId,
    optionLabel: names
      ? `${names.provider} (${names.embark} to ${names.disembark})`
      : `security quote ${quoteId}`,
    recommendationId: match?.id ?? null,
    status: match ? RecommendationStatus.parse(match.status) : null,
    satisfied: match !== null && SATISFIED.has(match.status),
    orderType: "security_order",
  };
}

/** Why an instruction cannot be approved yet, in the operator's words. */
export function unmetDependencyMessage(dep: RecommendationDependency): string {
  const why =
    dep.recommendationId === null
      ? "none has been proposed yet"
      : `proposal ${dep.recommendationId} is ${dep.status}`;
  const what = dep.orderType === "security_order" ? "security order" : "purchase order";
  return `It needs an approved ${what} for ${dep.optionLabel} before it can be approved; ${why}.`;
}
