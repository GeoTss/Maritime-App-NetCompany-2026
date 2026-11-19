/**
 * The executor: the only code that writes purchase orders or records voyage instructions, and only
 * after a human approves.
 *
 * A `voyage_instruction` makes no external call and writes no order: it records the approved route
 * option (candidate, speed, ETA, points, all read from the stored route calculation) in
 * `voyage_instructions`, once per recommendation, and drafts the master's instruction (never
 * sent). The voyage's own planned speed and route rows stay as they are; the latest instruction
 * carried out is the plan in force, which the fleet, voyage and vessel-status reads take from
 * `approvals/in-force.ts`. It moves through the same states.
 * An instruction on a route plan's bunker stop also records the stop (port, quote, arrival,
 * departure, quantity), and cannot be approved until the purchase order for the stop's quote is
 * approved (`dependency_unmet`; the rule is `approvals/dependency.ts`, the same the views use).
 *
 * Every order value comes from the database, never from model text: the quantity is the stored
 * plan option's (or route stop plan's) `qtyMt`; price, currency and barge fee come from the quote
 * the option points at;
 * supplier ERP code, vessel IMO and port UN/LOCODE from their rows. The order is written once per
 * recommendation (row lock + unique idempotency key) and pushed to the ERP after the commit, with
 * `idempotencyKey = "rec-<id>-<world seeded_at epoch ms>"`, minted once and stored on the order,
 * so a retry after an outage can never create a second order.
 */
import type { Sql } from "@pharos/db";
import {
  type AuditKind,
  BunkerPlan,
  BunkerPlanInput,
  DecisionResult,
  DraftedMessage,
  ErpOrderRequest,
  type FuelGrade,
  type Id,
  type LatLon,
  type PortCallResult,
  type RecommendationStatus,
  RouteCandidate,
  RouteSpeedResult,
  StopCandidate,
  type StopPlanResult,
} from "@pharos/shared";
import { z } from "zod";
import { orderDependencyOf, unmetDependencyMessage } from "../approvals/dependency.js";
import { transition } from "../approvals/state.js";
import {
  type DraftedMessageInput,
  draftAgentRequest,
  draftMessages,
  draftPreArrivalNotices,
  draftSecurityConfirmation,
  draftVoyageInstruction,
  type VoyageInstructionDraftInput,
} from "./drafts.js";
import type { ErpClient } from "./erp-client.js";

export interface ExecutorDeps {
  sql: Sql;
  erp: ErpClient;
  /** Clock for decision, order and audit timestamps. */
  now: () => Date;
  log?: (message: string) => void;
}

export type DecisionErrorCode =
  | "not_found"
  | "already_rejected"
  | "not_pending"
  | "not_executable"
  /** A voyage instruction's bunker stop has no approved purchase order yet. */
  | "dependency_unmet";

/** A decision that cannot be taken in the recommendation's current state. Nothing was written. */
export class DecisionError extends Error {
  override name = "DecisionError";
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The ERP idempotency key (and our order reference) for a recommendation in a world. Every reseed
 * restarts the ids while the ERP (its own service) keeps its keys, so the instant the world was
 * seeded (`world_meta.seeded_at`, epoch ms) keeps "recommendation 1" of one world apart from that
 * of the next. Not the anchor: with DEMO_ANCHOR pinned every reseed has the same anchor, and a
 * rehearsal's key would come back in the demo (a duplicate PO, or a 409 on a changed order).
 * seeded_at is wall time, but it reaches only the ERP request and the drafted messages, never a
 * model request or a tool result, so pinned replays are unaffected. Deterministic for the same
 * world and recommendation.
 */
export const idempotencyKeyFor = (recommendationId: Id, worldSeededAt: Date) =>
  `rec-${recommendationId}-${worldSeededAt.getTime()}`;

/** Audit actor for what the executor does on its own after a decision. */
const EXECUTOR = "executor";

/** The connection inside `sql.begin` (postgres.js `TransactionSql`). */
type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

/** timestamptz parameter: postgres.js does not serialise a Date in an untyped position. */
const iso = (d: Date): string => d.toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const clock = (deps: ExecutorDeps) => deps.now();

async function audit(
  tx: Tx,
  recommendationId: Id,
  kind: AuditKind,
  actor: string,
  detail: Record<string, unknown>,
  at: Date,
): Promise<void> {
  await tx`
    insert into audit_events (recommendation_id, kind, actor, detail, at)
    values (${recommendationId}, ${kind}, ${actor}, ${json(detail)}::jsonb, ${iso(at)}::timestamptz)`;
}

interface RecommendationRow {
  id: number;
  type: string;
  status: RecommendationStatus;
  calculation_id: number;
  option_id: string;
}

async function lockRecommendation(tx: Tx, id: Id): Promise<RecommendationRow> {
  const [rec] = await tx<RecommendationRow[]>`
    select id, type, status, calculation_id, option_id from recommendations
    where id = ${id} for update`;
  if (!rec) throw new DecisionError("not_found", `Recommendation ${id} does not exist.`);
  return rec;
}

/**
 * Approves a pending recommendation, writes its purchase order once, pushes it to the ERP and
 * stores the drafted messages. The decision and the start of execution happen under one row lock,
 * so two concurrent approvals produce one order: the second sees `executing` or `executed` and
 * only reports the state. Approving a `failed` recommendation retries it (same order, same key).
 * A failed push is not an error: the order and the recommendation are left `failed` (audited).
 * A voyage instruction on a bunker stop is refused (`dependency_unmet`, nothing written) until the
 * purchase order for the stop's quote is approved; the approval audit names that order.
 */
export async function approveRecommendation(
  deps: ExecutorDeps,
  id: Id,
  decidedBy: string,
): Promise<DecisionResult> {
  const now = clock(deps);
  const run = await deps.sql.begin(async (tx) => {
    const rec = await lockRecommendation(tx, id);
    if (rec.status === "rejected") {
      throw new DecisionError("already_rejected", `Recommendation ${id} was rejected.`);
    }
    let status: RecommendationStatus = rec.status;
    if (status === "pending") {
      const dependency = await orderDependencyOf(tx, rec);
      if (dependency && !dependency.satisfied) {
        throw new DecisionError(
          "dependency_unmet",
          `Recommendation ${id} ${unmetDependencyMessage(dependency).replace(/^It /, "")}`,
        );
      }
      status = transition(status, "approve");
      await tx`
        update recommendations set status = ${status}, decided_by = ${decidedBy},
          decided_at = ${iso(now)}::timestamptz
        where id = ${id}`;
      const detail = dependency ? { dependsOnRecommendationId: dependency.recommendationId } : {};
      await audit(tx, id, "recommendation.approved", decidedBy, detail, now);
    }
    if (status !== "approved" && status !== "failed") return null; // executing or executed
    await beginExecution(tx, { ...rec, status }, now, decidedBy);
    return rec;
  });
  if (run) await finish(deps, run);
  return decisionOf(deps.sql, id);
}

/** The second half of an execution, by type: push the order, or draft the voyage instruction. */
function finish(deps: ExecutorDeps, rec: RecommendationRow): Promise<void> {
  if (rec.type === "security_order") return pushSecurityAndFinish(deps, rec.id);
  return rec.type === "voyage_instruction"
    ? finishInstruction(deps, rec.id)
    : pushAndFinish(deps, rec.id);
}

/** Rejects a pending recommendation. Final: it can be neither approved nor rejected again. */
export async function rejectRecommendation(
  deps: ExecutorDeps,
  id: Id,
  decidedBy: string,
): Promise<DecisionResult> {
  const now = clock(deps);
  await deps.sql.begin(async (tx) => {
    const rec = await lockRecommendation(tx, id);
    if (rec.status !== "pending") {
      throw new DecisionError(
        "not_pending",
        `Recommendation ${id} is ${rec.status}; only a pending recommendation can be rejected.`,
      );
    }
    await tx`
      update recommendations set status = ${transition(rec.status, "reject")},
        decided_by = ${decidedBy}, decided_at = ${iso(now)}::timestamptz
      where id = ${id}`;
    await audit(tx, id, "recommendation.rejected", decidedBy, {}, now);
  });
  return decisionOf(deps.sql, id);
}

/**
 * approved -start-> executing, or failed -retry-> executing; writes the order (or records the
 * voyage instruction) if none exists. A retry is audited as `actor`: the human whose approval
 * retried it, or the executor.
 */
async function beginExecution(
  tx: Tx,
  rec: RecommendationRow,
  now: Date,
  actor: string,
): Promise<void> {
  const retry = rec.status === "failed";
  const next = transition(rec.status, retry ? "retry" : "start");
  await tx`update recommendations set status = ${next} where id = ${rec.id}`;
  if (retry) await audit(tx, rec.id, "recommendation.retried", actor, {}, now);
  if (rec.type === "voyage_instruction") {
    const [existing] = await tx<{ id: number }[]>`
      select id from voyage_instructions where recommendation_id = ${rec.id}`;
    if (!existing) await recordInstruction(tx, rec, now);
    return;
  }
  if (rec.type === "security_order") {
    const [existing] = await tx<{ id: number }[]>`
      select id from security_orders where recommendation_id = ${rec.id} order by id limit 1`;
    if (!existing) await createSecurityOrder(tx, rec, now);
    return;
  }
  const [existing] = await tx<{ id: number }[]>`
    select id from purchase_orders where recommendation_id = ${rec.id} order by id limit 1`;
  if (!existing) await createOrder(tx, rec, now);
}

/** The parts of a stored route calculation's inputs the executor reads. */
const RouteInputs = z.object({
  destination: z.string().min(1),
  optimiser: z.object({ candidates: z.array(RouteCandidate), stops: z.array(StopCandidate) }),
});

/** The bunker stop an approved stop plan calls at, as the executor records and drafts it. */
interface ApprovedStop {
  portId: Id;
  supplierId: Id;
  quoteId: Id;
  grade: FuelGrade;
  arriveAt: string;
  departAt: string;
  qtyMt: number;
}

/** The approved plan of a stored route calculation: a route, or a stop plan through a port. */
interface ApprovedRoute {
  voyageId: Id;
  destination: string;
  /** A candidate id, or a stop plan's option id. */
  optionId: string;
  /** The candidate's description; null for a stop plan (it is drafted from its port). */
  label: string | null;
  points: LatLon[];
  option: Pick<StopPlanResult, "speedKn" | "eta" | "distanceNm">;
  stop: ApprovedStop | null;
  /** The approved stop plan's port call; null for a route, or a plan made without stores data. */
  portCall: PortCallResult | null;
}

/** The approved route of a stored route calculation, or why it cannot be executed. */
async function approvedRoute(
  tx: Tx,
  rec: RecommendationRow,
): Promise<({ ok: true } & ApprovedRoute) | { ok: false; why: string }> {
  const [calc] = await tx<
    { kind: string; inputs: unknown; outputs: unknown; voyage_id: number | null }[]
  >`select kind, inputs, outputs, voyage_id from calculations where id = ${rec.calculation_id}`;
  if (calc?.kind !== "route_speed") {
    return { ok: false, why: `calculation ${rec.calculation_id} is not a route plan.` };
  }
  if (calc.voyage_id === null) {
    return { ok: false, why: "the route plan is not for one of the operator's own vessels." };
  }
  const inputs = RouteInputs.safeParse(calc.inputs);
  const result = RouteSpeedResult.safeParse(calc.outputs);
  if (!inputs.success || !result.success) {
    return { ok: false, why: `calculation ${rec.calculation_id} is unreadable.` };
  }
  const base = {
    ok: true as const,
    voyageId: calc.voyage_id,
    destination: inputs.data.destination,
    optionId: rec.option_id,
  };
  const plan = result.data.stopPlans.find((s) => s.optionId === rec.option_id);
  if (plan) {
    const stop = inputs.data.optimiser.stops.find((s) => s.optionId === rec.option_id);
    if (!stop) return { ok: false, why: `the plan has no bunker stop ${rec.option_id}.` };
    if (!plan.feasible || !plan.stop) {
      return { ok: false, why: `bunker stop ${rec.option_id} is not feasible.` };
    }
    if (plan.quoteId === null) {
      return { ok: false, why: `bunker stop ${rec.option_id} is not a received quote.` };
    }
    return {
      ...base,
      label: null,
      points: stop.points,
      option: plan,
      portCall: plan.portCall,
      stop: {
        portId: stop.portId,
        supplierId: stop.supplierId,
        quoteId: plan.quoteId,
        grade: stop.grade,
        arriveAt: plan.stop.arriveAt,
        departAt: plan.stop.departAt,
        qtyMt: plan.qtyMt,
      },
    };
  }
  const option = result.data.options.find((o) => o.candidateId === rec.option_id);
  const candidate = inputs.data.optimiser.candidates.find((c) => c.id === rec.option_id);
  if (!option || !candidate) return { ok: false, why: `the plan has no route ${rec.option_id}.` };
  if (!option.feasible) return { ok: false, why: `route ${rec.option_id} is not feasible.` };
  return {
    ...base,
    label: candidate.label,
    points: candidate.points,
    option,
    stop: null,
    portCall: null,
  };
}

/** Records the approved route option as the voyage's instruction (the voyage itself is unchanged). */
async function recordInstruction(tx: Tx, rec: RecommendationRow, now: Date): Promise<Id> {
  const route = await approvedRoute(tx, rec);
  if (!route.ok) {
    throw new DecisionError(
      "not_executable",
      `Recommendation ${rec.id} cannot be executed: ${route.why}`,
    );
  }
  const { stop } = route;
  const [row] = await tx<{ id: number }[]>`
    insert into voyage_instructions (recommendation_id, voyage_id, calculation_id, candidate_id,
                                     speed_kn, eta, points, stop_port_id, stop_quote_id,
                                     stop_arrive_at, stop_depart_at, stop_qty_mt, created_at)
    values (${rec.id}, ${route.voyageId}, ${rec.calculation_id}, ${route.optionId},
            ${route.option.speedKn}, ${route.option.eta}::timestamptz,
            ${json(route.points)}::jsonb, ${stop?.portId ?? null}, ${stop?.quoteId ?? null},
            ${stop?.arriveAt ?? null}::timestamptz, ${stop?.departAt ?? null}::timestamptz,
            ${stop?.qtyMt ?? null}, ${iso(now)}::timestamptz)
    returning id`;
  if (!row) throw new Error("voyage_instructions insert returned no row");
  await audit(
    tx,
    rec.id,
    "voyage.instructed",
    EXECUTOR,
    { instructionId: row.id, calculationId: rec.calculation_id, candidateId: rec.option_id },
    now,
  );
  return row.id;
}

/**
 * Drafts the master's route-and-speed instruction from the stored calculation and marks the
 * recommendation executed. No external call. Any failure leaves it `failed` (audited); a later
 * approve retries, and the unique indexes keep it to one instruction and one draft.
 */
async function finishInstruction(deps: ExecutorDeps, recId: Id): Promise<void> {
  const { sql } = deps;
  try {
    await sql.begin(async (tx) => {
      const rec = await lockRecommendation(tx, recId);
      const [instruction] = await tx<{ id: number }[]>`
        select id from voyage_instructions where recommendation_id = ${recId}`;
      if (!instruction) throw new Error(`recommendation ${recId} has no voyage instruction`);
      const route = await approvedRoute(tx, rec);
      if (!route.ok) throw new Error(`recommendation ${recId}: ${route.why}`);
      const [vessel] = await tx<{ name: string }[]>`
        select v.name from voyages vo join vessels v on v.id = vo.vessel_id
        where vo.id = ${route.voyageId}`;
      if (!vessel) throw new Error(`voyage ${route.voyageId} has no vessel`);
      const stop = route.stop ? await stopNames(tx, route.stop) : null;
      const draft = draftVoyageInstruction({
        recommendation: { id: recId },
        vessel: { name: vessel.name },
        destination: route.destination,
        route: {
          candidateId: route.optionId,
          label: route.label ?? `Through ${stop?.portName} for bunkers`,
        },
        option: route.option,
        stop,
      });
      const call =
        stop && route.portCall
          ? {
              recommendation: { id: recId },
              vessel: { name: vessel.name },
              portName: stop.portName,
              arriveAt: stop.arriveAt,
              portCall: route.portCall,
            }
          : null;
      const callDrafts = call
        ? [draftAgentRequest(call), draftPreArrivalNotices(call)].filter(
            (d): d is DraftedMessageInput => d !== null,
          )
        : [];
      const at = clock(deps);
      const kinds = await insertDrafts(tx, [draft, ...callDrafts], at);
      if (kinds.length > 0) await audit(tx, recId, "drafts.created", EXECUTOR, { kinds }, at);
      await tx`update recommendations set status = ${transition(rec.status, "succeed")} where id = ${recId}`;
      await audit(
        tx,
        recId,
        "recommendation.executed",
        EXECUTOR,
        { instructionId: instruction.id },
        at,
      );
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log?.(`[executor] voyage instruction ${recId}: ${error}`);
    await failRecommendation(deps, recId, { error });
  }
}

/** The supplier and port names of an approved stop, for the master's draft. */
async function stopNames(
  tx: Tx,
  stop: ApprovedStop,
): Promise<NonNullable<VoyageInstructionDraftInput["stop"]>> {
  const [names] = await tx<{ port_name: string; supplier_name: string }[]>`
    select p.name as port_name, s.name as supplier_name
    from ports p, suppliers s where p.id = ${stop.portId} and s.id = ${stop.supplierId}`;
  if (!names)
    throw new Error(`bunker stop port ${stop.portId} or supplier ${stop.supplierId} is missing`);
  return {
    portName: names.port_name,
    supplierName: names.supplier_name,
    arriveAt: stop.arriveAt,
    departAt: stop.departAt,
    qtyMt: stop.qtyMt,
    grade: stop.grade,
  };
}

/** What a purchase order buys, read from the stored calculation it was proposed from. */
export interface OrderSource {
  grade: FuelGrade;
  quoteId: Id | null;
  supplierId: Id;
  portId: Id;
  qtyMt: number;
  feasible: boolean;
}

/**
 * The option a purchase order was proposed from: a bunker plan option (grade from the plan), or a
 * route plan's bunker stop (grade and quote from its stop candidate, quantity from its stop plan).
 * A string says why it is unreadable.
 */
export function orderSourceOf(
  calc: { id: Id; kind: string; inputs: unknown; outputs: unknown },
  optionId: string,
): OrderSource | string {
  if (calc.kind === "route_speed") {
    const inputs = RouteInputs.safeParse(calc.inputs);
    const result = RouteSpeedResult.safeParse(calc.outputs);
    if (!inputs.success || !result.success) return `calculation ${calc.id} is unreadable.`;
    const stop = inputs.data.optimiser.stops.find((s) => s.optionId === optionId);
    const plan = result.data.stopPlans.find((s) => s.optionId === optionId);
    if (!stop || !plan) return `the route plan has no bunker stop ${optionId}.`;
    return {
      grade: stop.grade,
      quoteId: plan.quoteId,
      supplierId: stop.supplierId,
      portId: stop.portId,
      qtyMt: plan.qtyMt,
      feasible: plan.feasible,
    };
  }
  if (calc.kind !== "bunker_plan") return `calculation ${calc.id} is not a bunker or route plan.`;
  const input = BunkerPlanInput.safeParse(calc.inputs);
  const plan = BunkerPlan.safeParse(calc.outputs);
  if (!input.success || !plan.success) return `calculation ${calc.id} is unreadable.`;
  const offer = input.data.options.find((o) => o.optionId === optionId);
  const result = plan.data.options.find((o) => o.optionId === optionId);
  if (!offer || !result) return `the plan has no option ${optionId}.`;
  return {
    grade: input.data.grade,
    quoteId: offer.quoteId,
    supplierId: offer.supplierId,
    portId: offer.portId,
    qtyMt: result.qtyMt,
    feasible: result.feasible,
  };
}

/** Writes the purchase order and its line from the stored plan option and its quote. */
async function createOrder(tx: Tx, rec: RecommendationRow, now: Date): Promise<Id> {
  function refuse(why: string): never {
    throw new DecisionError(
      "not_executable",
      `Recommendation ${rec.id} cannot be executed: ${why}`,
    );
  }
  if (rec.type !== "purchase_order") refuse(`a ${rec.type} has no executor yet.`);

  const [calc] = await tx<
    { kind: string; inputs: unknown; outputs: unknown; voyage_id: number | null }[]
  >`select kind, inputs, outputs, voyage_id from calculations where id = ${rec.calculation_id}`;
  if (!calc) refuse(`calculation ${rec.calculation_id} does not exist.`);
  const offer = orderSourceOf({ id: rec.calculation_id, ...calc }, rec.option_id);
  if (typeof offer === "string") refuse(offer);
  const grade = offer.grade;
  if (!offer.feasible || offer.qtyMt <= 0) refuse(`option ${rec.option_id} is not feasible.`);
  if (calc.voyage_id === null) refuse(`calculation ${rec.calculation_id} has no voyage.`);
  if (offer.quoteId === null) refuse(`option ${rec.option_id} is not a received quote.`);

  const [quote] = await tx<{ id: number; status: string; supplier_id: number; port_id: number }[]>`
    select id, status, supplier_id, port_id from quotes where id = ${offer.quoteId} for update`;
  if (!quote) refuse(`quote ${offer.quoteId} does not exist.`);
  if (quote.supplier_id !== offer.supplierId || quote.port_id !== offer.portId) {
    refuse(`quote ${quote.id} does not match option ${rec.option_id}.`);
  }
  if (quote.status !== "received" && quote.status !== "accepted") {
    refuse(`quote ${quote.id} is ${quote.status}.`);
  }
  // One purchase order per quote (Phase 4 limit). A multi-grade quote can back the plans of
  // several grades, but once one of them is ordered the quote is taken: a second grade's
  // recommendation from the same quote is refused here rather than ordering it twice.
  const [taken] = await tx<{ id: number }[]>`
    select id from purchase_orders where quote_id = ${quote.id}`;
  if (taken) refuse(`quote ${quote.id} already has purchase order ${taken.id}.`);
  const [line] = await tx<{ price_per_mt: number }[]>`
    select price_per_mt from quote_lines where quote_id = ${quote.id} and grade = ${grade}
    order by id limit 1`;
  if (!line) refuse(`quote ${quote.id} has no ${grade} line.`);

  const [world] = await tx<{ seeded_at: Date | string }[]>`
    select seeded_at from world_meta order by id limit 1`;
  if (!world) throw new Error("world_meta is empty; seed the database first");
  const key = idempotencyKeyFor(rec.id, new Date(world.seeded_at));
  const [order] = await tx<{ id: number }[]>`
    insert into purchase_orders (quote_id, recommendation_id, status, erp_po_number,
                                 erp_sync_status, idempotency_key, created_at)
    values (${quote.id}, ${rec.id}, 'approved', null, 'pending', ${key}, ${iso(now)}::timestamptz)
    returning id`;
  if (!order) throw new Error("purchase_orders insert returned no row");
  await tx`
    insert into order_lines (order_id, grade, qty_mt, price_per_mt)
    values (${order.id}, ${grade}, ${offer.qtyMt}, ${line.price_per_mt})`;
  await audit(
    tx,
    rec.id,
    "order.created",
    EXECUTOR,
    { orderId: order.id, quoteId: quote.id, idempotencyKey: key },
    now,
  );
  return order.id;
}

interface OrderCodesRow {
  idempotency_key: string;
  currency: "USD" | "EUR";
  barge_fee: number;
  erp_code: string;
  unlocode: string;
  imo: string;
}

/** The stored order as the ERP request: the same body every time, so retries stay idempotent. */
async function erpRequestFor(sql: Sql, orderId: Id): Promise<ErpOrderRequest> {
  const [row] = await sql<OrderCodesRow[]>`
    select po.idempotency_key, q.currency, q.barge_fee, s.erp_code, p.unlocode, v.imo
    from purchase_orders po
      join quotes q on q.id = po.quote_id
      join suppliers s on s.id = q.supplier_id
      join ports p on p.id = q.port_id
      join recommendations r on r.id = po.recommendation_id
      join calculations c on c.id = r.calculation_id
      join voyages vo on vo.id = c.voyage_id
      join vessels v on v.id = vo.vessel_id
    where po.id = ${orderId}`;
  if (!row) throw new Error(`purchase order ${orderId} has no quote, supplier, port or vessel`);
  const lines = await sql<{ grade: FuelGrade; qty_mt: number; price_per_mt: number }[]>`
    select grade, qty_mt, price_per_mt from order_lines where order_id = ${orderId} order by id`;
  return {
    supplierErpCode: row.erp_code,
    vesselImo: row.imo,
    port: row.unlocode,
    currency: row.currency,
    lines: lines.map((l) => ({ grade: l.grade, qtyMt: l.qty_mt, pricePerMt: l.price_per_mt })),
    bargeFee: row.barge_fee,
    reference: row.idempotency_key,
  };
}

/**
 * Pushes the executing recommendation's order to the ERP and records the outcome. Any failure of
 * the push (ERP down, ERP refusal, or a stored order the ERP contract rejects) leaves the order
 * and the recommendation `failed` with `order.sync_failed` and `recommendation.failed` audits; it
 * is never thrown, so a later approve retries with the same idempotency key. On success the
 * drafted messages are stored once (never sent).
 */
async function pushAndFinish(deps: ExecutorDeps, recId: Id): Promise<void> {
  const { sql } = deps;
  const [rec] = await sql<RecommendationRow[]>`
    select id, type, status, calculation_id, option_id from recommendations where id = ${recId}`;
  if (!rec) throw new DecisionError("not_found", `Recommendation ${recId} does not exist.`);
  const [order] = await sql<
    { id: number; quote_id: number; erp_sync_status: string; idempotency_key: string }[]
  >`
    select id, quote_id, erp_sync_status, idempotency_key from purchase_orders
    where recommendation_id = ${recId} order by id limit 1`;
  if (!order) throw new Error(`recommendation ${recId} has no purchase order`);
  const orderId = order.id;
  const key = order.idempotency_key;

  // Render inputs first: an unreadable plan or order fails here, before any external call.
  let render: (poNumber: string) => DraftedMessageInput[];
  try {
    render = await prepareDrafts(sql, rec, orderId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log?.(`[executor] order ${orderId} (${key}): drafts cannot be prepared: ${error}`);
    await failRecommendation(deps, recId, { orderId, error });
    return;
  }

  let confirmed: { poNumber: string; duplicate: boolean } | null = null;
  if (order.erp_sync_status === "synced") {
    const [po] = await sql<{ erp_po_number: string | null }[]>`
      select erp_po_number from purchase_orders where id = ${orderId}`;
    confirmed = { poNumber: po?.erp_po_number ?? "", duplicate: true };
  } else {
    try {
      confirmed = await deps.erp.placeOrder(await erpRequestFor(sql, orderId), key);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      deps.log?.(`[executor] order ${orderId} (${key}): ERP push failed: ${error}`);
      await sql.begin(async (tx) => {
        await tx`update purchase_orders set erp_sync_status = 'failed' where id = ${orderId}`;
        await audit(
          tx,
          recId,
          "order.sync_failed",
          EXECUTOR,
          { orderId, idempotencyKey: key, error },
          clock(deps),
        );
      });
      await failRecommendation(deps, recId, { orderId, error });
      return;
    }
  }

  const done = confirmed;
  try {
    await sql.begin(async (tx) => {
      const rec = await lockRecommendation(tx, recId);
      const at = clock(deps);
      await tx`
        update purchase_orders set erp_sync_status = 'synced', erp_po_number = ${done.poNumber},
          status = 'confirmed'
        where id = ${orderId}`;
      await tx`update quotes set status = 'ordered' where id = ${order.quote_id}`;
      // The requirement the plan was for: the voyage's lowest-id open requirement of the ordered
      // grade (the planner's rule), not the one the quote links (a quote may offer other grades).
      await tx`
        update bunker_requirements set status = 'ordered'
        where id = (
          select r.id from bunker_requirements r join calculations c on c.voyage_id = r.voyage_id
          where c.id = ${rec.calculation_id} and r.status = 'open'
            and r.grade = (select grade from order_lines where order_id = ${orderId}
                           order by id limit 1)
          order by r.id limit 1)`;
      await audit(
        tx,
        recId,
        "order.pushed",
        EXECUTOR,
        { orderId, erpPoNumber: done.poNumber, duplicate: done.duplicate },
        at,
      );
      const kinds = await insertDrafts(tx, render(done.poNumber), at);
      if (kinds.length > 0) await audit(tx, recId, "drafts.created", EXECUTOR, { kinds }, at);
      await tx`update recommendations set status = ${transition(rec.status, "succeed")} where id = ${recId}`;
      await audit(tx, recId, "recommendation.executed", EXECUTOR, { orderId }, at);
    });
  } catch (err) {
    // The PO may exist in the ERP; a retry is safe (the key dedupes the PO, the unique index the drafts).
    const error = err instanceof Error ? err.message : String(err);
    deps.log?.(`[executor] order ${orderId} (${key}): recording the success failed: ${error}`);
    await failRecommendation(deps, recId, { orderId, error: `after the ERP push: ${error}` });
  }
}

/** The parts of a stored route calculation's outputs a security order reads. */
const SecurityOutputs = z.object({
  options: z.array(
    z.object({
      candidateId: z.string(),
      feasible: z.boolean(),
      security: z
        .object({ quoteId: z.number().nullable(), teamDays: z.number().int() })
        .nullable()
        .optional(),
    }),
  ),
});

/**
 * Track 3: writes the security order for the team the approved route option's security plan
 * chose: its quote, team days (from the plan, never from the model) and the quote's rates.
 */
async function createSecurityOrder(tx: Tx, rec: RecommendationRow, now: Date): Promise<Id> {
  const refuse = (why: string): never => {
    throw new DecisionError(
      "not_executable",
      `Recommendation ${rec.id} cannot be executed: ${why}`,
    );
  };
  const [calc] = await tx<{ outputs: unknown }[]>`
    select outputs from calculations where id = ${rec.calculation_id}`;
  const parsed = SecurityOutputs.safeParse(calc?.outputs);
  if (!parsed.success) refuse(`calculation ${rec.calculation_id} is unreadable.`);
  const option = parsed.data?.options.find((o) => o.candidateId === rec.option_id);
  const quoteId = option?.security?.quoteId ?? null;
  if (!option || quoteId === null || !option.security) {
    return refuse(`route ${rec.option_id} has no security team to order.`);
  }
  if (!option.feasible) refuse(`route ${rec.option_id} is not feasible.`);
  const [quote] = await tx<{ day_rate: number; fixed_fees: number; currency: "USD" | "EUR" }[]>`
    select day_rate, fixed_fees, currency from security_quotes where id = ${quoteId}`;
  if (!quote) return refuse(`security quote ${quoteId} does not exist.`);
  const [world] = await tx<{ seeded_at: Date | string }[]>`
    select seeded_at from world_meta order by id limit 1`;
  if (!world) throw new Error("world_meta is empty; seed the database first");
  const key = idempotencyKeyFor(rec.id, new Date(world.seeded_at));
  const [order] = await tx<{ id: number }[]>`
    insert into security_orders (security_quote_id, recommendation_id, team_days, day_rate,
                                 fixed_fees, currency, status, erp_po_number, erp_sync_status,
                                 idempotency_key, created_at)
    values (${quoteId}, ${rec.id}, ${option.security.teamDays}, ${quote.day_rate},
            ${quote.fixed_fees}, ${quote.currency}, 'approved', null, 'pending', ${key},
            ${iso(now)}::timestamptz)
    returning id`;
  if (!order) throw new Error("security_orders insert returned no row");
  await audit(
    tx,
    rec.id,
    "order.created",
    EXECUTOR,
    { securityOrderId: order.id, securityQuoteId: quoteId, idempotencyKey: key },
    now,
  );
  return order.id;
}

/**
 * Pushes the security order to the ERP (one service line: team days at the day rate, the fixed
 * fees as the delivery charge), drafts the provider's confirmation (never sent) and executes. Any
 * failure leaves the recommendation failed and audited; a later approve retries with the same key.
 */
async function pushSecurityAndFinish(deps: ExecutorDeps, recId: Id): Promise<void> {
  const { sql } = deps;
  const [order] = await sql<
    {
      id: number;
      team_days: number;
      day_rate: number;
      fixed_fees: number;
      currency: "USD" | "EUR";
      erp_sync_status: string;
      erp_po_number: string | null;
      idempotency_key: string;
      erp_code: string;
      provider: string;
      email_domain: string;
      embark: string;
      embark_name: string;
      disembark_name: string;
      team_size: number;
      vessel_imo: string | null;
      vessel_name: string | null;
    }[]
  >`
    select o.id, o.team_days, o.day_rate, o.fixed_fees, o.currency, o.erp_sync_status,
           o.erp_po_number, o.idempotency_key, p.erp_code, p.name as provider,
           p.email_domain, e.unlocode as embark, e.name as embark_name, d.name as disembark_name,
           q.team_size, v.imo as vessel_imo, v.name as vessel_name
    from security_orders o
      join security_quotes q on q.id = o.security_quote_id
      join security_providers p on p.id = q.provider_id
      join ports e on e.id = q.embark_port_id
      join ports d on d.id = q.disembark_port_id
      join recommendations r on r.id = o.recommendation_id
      join calculations c on c.id = r.calculation_id
      left join voyages vo on vo.id = c.voyage_id
      left join vessels v on v.id = vo.vessel_id
    where o.recommendation_id = ${recId} order by o.id limit 1`;
  if (!order) throw new Error(`recommendation ${recId} has no security order`);
  const key = order.idempotency_key;
  let poNumber = order.erp_po_number;
  if (order.erp_sync_status !== "synced") {
    try {
      const confirmed = await deps.erp.placeOrder(
        ErpOrderRequest.parse({
          supplierErpCode: order.erp_code,
          vesselImo: order.vessel_imo ?? "",
          port: order.embark,
          currency: order.currency,
          lines: [{ service: "security_team", days: order.team_days, dayRate: order.day_rate }],
          bargeFee: order.fixed_fees,
          reference: key,
        }),
        key,
      );
      poNumber = confirmed.poNumber;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      deps.log?.(`[executor] security order ${order.id} (${key}): ERP push failed: ${error}`);
      await sql.begin(async (tx) => {
        await tx`update security_orders set erp_sync_status = 'failed' where id = ${order.id}`;
        await audit(
          tx,
          recId,
          "order.sync_failed",
          EXECUTOR,
          { securityOrderId: order.id, error },
          clock(deps),
        );
      });
      await failRecommendation(deps, recId, { orderId: order.id, error });
      return;
    }
  }
  try {
    await sql.begin(async (tx) => {
      const rec = await lockRecommendation(tx, recId);
      const at = clock(deps);
      await tx`
        update security_orders set erp_sync_status = 'synced', erp_po_number = ${poNumber},
          status = 'confirmed'
        where id = ${order.id}`;
      await tx`update security_quotes set status = 'accepted'
        where id = (select security_quote_id from security_orders where id = ${order.id})`;
      await audit(tx, recId, "order.pushed", EXECUTOR, { securityOrderId: order.id, poNumber }, at);
      const draft = draftSecurityConfirmation({
        recommendation: { id: recId },
        provider: { name: order.provider, emailDomain: order.email_domain },
        vessel: { name: order.vessel_name ?? "the vessel", imo: order.vessel_imo },
        embark: order.embark_name,
        disembark: order.disembark_name,
        teamSize: order.team_size,
        teamDays: order.team_days,
        dayRate: order.day_rate,
        fixedFees: order.fixed_fees,
        currency: order.currency,
        poNumber: poNumber ?? "",
      });
      const kinds = await insertDrafts(tx, [draft], at);
      if (kinds.length > 0) await audit(tx, recId, "drafts.created", EXECUTOR, { kinds }, at);
      await tx`update recommendations set status = ${transition(rec.status, "succeed")} where id = ${recId}`;
      await audit(
        tx,
        recId,
        "recommendation.executed",
        EXECUTOR,
        { securityOrderId: order.id },
        at,
      );
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await failRecommendation(deps, recId, {
      orderId: order.id,
      error: `after the ERP push: ${error}`,
    });
  }
}

/** executing -fail-> failed, audited with the reason; leaves any other status alone. */
async function failRecommendation(
  deps: ExecutorDeps,
  recId: Id,
  detail: { orderId?: Id; error: string },
): Promise<void> {
  await deps.sql.begin(async (tx) => {
    const rec = await lockRecommendation(tx, recId);
    if (rec.status !== "executing") return;
    await tx`update recommendations set status = ${transition(rec.status, "fail")} where id = ${recId}`;
    await audit(tx, recId, "recommendation.failed", EXECUTOR, detail, clock(deps));
  });
}

/**
 * Reads the stored calculation and order and returns the template renderer for the PO number
 * (known only after the push). Throws if the plan, option or order is unreadable.
 */
async function prepareDrafts(
  sql: Sql,
  rec: RecommendationRow,
  orderId: Id,
): Promise<(poNumber: string) => DraftedMessageInput[]> {
  const [row] = await sql<
    {
      idempotency_key: string;
      currency: "USD" | "EUR";
      barge_fee: number;
      supplier_name: string;
      email_domain: string;
      vessel_name: string;
      imo: string;
      port_name: string;
      unlocode: string;
      kind: string;
      outputs: unknown;
    }[]
  >`
    select po.idempotency_key, q.currency, q.barge_fee, s.name as supplier_name, s.email_domain,
           v.name as vessel_name, v.imo, p.name as port_name, p.unlocode, c.kind, c.outputs
    from purchase_orders po
      join quotes q on q.id = po.quote_id
      join suppliers s on s.id = q.supplier_id
      join ports p on p.id = q.port_id
      join recommendations r on r.id = po.recommendation_id
      join calculations c on c.id = r.calculation_id
      join voyages vo on vo.id = c.voyage_id
      join vessels v on v.id = vo.vessel_id
    where po.id = ${orderId}`;
  const [line] = await sql<{ grade: FuelGrade; qty_mt: number; price_per_mt: number }[]>`
    select grade, qty_mt, price_per_mt from order_lines where order_id = ${orderId} order by id limit 1`;
  // A bunker plan's option, or a route plan's stop plan (its times and costs).
  const plan = row?.kind === "bunker_plan" ? BunkerPlan.safeParse(row.outputs) : null;
  const option = plan?.success
    ? (plan.data.options.find((o) => o.optionId === rec.option_id) ?? null)
    : null;
  const route = row?.kind === "route_speed" ? RouteSpeedResult.safeParse(row.outputs) : null;
  const stopPlan = route?.success
    ? route.data.stopPlans.find((s) => s.optionId === rec.option_id)
    : undefined;
  const stop = stopPlan?.stop
    ? {
        arriveAt: stopPlan.stop.arriveAt,
        departAt: stopPlan.stop.departAt,
        bunkerFuelCostUsd: stopPlan.bunkerFuelCostUsd,
        bargeFeeUsd: stopPlan.bargeFeeUsd,
      }
    : null;
  if (!row || !line || (!option && !stop)) {
    throw new Error(`recommendation ${rec.id}: stored order or plan option is unreadable`);
  }
  return (poNumber) =>
    draftMessages({
      recommendation: { id: rec.id },
      order: {
        reference: row.idempotency_key,
        poNumber,
        grade: line.grade,
        qtyMt: line.qty_mt,
        pricePerMt: line.price_per_mt,
        currency: row.currency,
        bargeFee: row.barge_fee,
      },
      supplier: { name: row.supplier_name, emailDomain: row.email_domain },
      vessel: { name: row.vessel_name, imo: row.imo },
      port: { name: row.port_name, unlocode: row.unlocode },
      option,
      stop,
    });
}

/** Stores the drafts; the unique index keeps it to once per kind. Returns the kinds inserted. */
async function insertDrafts(tx: Tx, drafts: DraftedMessageInput[], at: Date): Promise<string[]> {
  const kinds: string[] = [];
  for (const d of drafts) {
    const inserted = await tx`
      insert into drafted_messages (recommendation_id, kind, to_address, subject, body, status, created_at)
      values (${d.recommendationId}, ${d.kind}, ${d.to}, ${d.subject}, ${d.body}, 'draft', ${iso(at)}::timestamptz)
      on conflict (recommendation_id, kind) do nothing returning id`;
    if (inserted.length > 0) kinds.push(d.kind);
  }
  return kinds;
}

/** The drafted messages of a recommendation (empty until it executed), oldest first. */
export async function draftsOf(sql: Sql, id: Id): Promise<DraftedMessage[]> {
  const rows = await sql<
    {
      id: number;
      recommendation_id: number;
      kind: DraftedMessage["kind"];
      to_address: string;
      subject: string;
      body: string;
      created_at: Date | string;
    }[]
  >`
    select id, recommendation_id, kind, to_address, subject, body, created_at
    from drafted_messages where recommendation_id = ${id} order by id`;
  return rows.map((r) =>
    DraftedMessage.parse({
      id: r.id,
      recommendationId: r.recommendation_id,
      kind: r.kind,
      to: r.to_address,
      subject: r.subject,
      body: r.body,
      status: "draft",
      createdAt: new Date(r.created_at),
    }),
  );
}

/** The recommendation's state and its order's, as the decision routes return it. */
async function decisionOf(sql: Sql, id: Id): Promise<DecisionResult> {
  const [row] = await sql<
    {
      status: string;
      order_id: number | null;
      erp_po_number: string | null;
      erp_sync_status: string | null;
      instruction_id: number | null;
    }[]
  >`
    select r.status, po.id as order_id, po.erp_po_number, po.erp_sync_status,
           vi.id as instruction_id
    from recommendations r
      left join purchase_orders po on po.recommendation_id = r.id
      left join voyage_instructions vi on vi.recommendation_id = r.id
    where r.id = ${id}
    order by po.id limit 1`;
  if (!row) throw new DecisionError("not_found", `Recommendation ${id} does not exist.`);
  return DecisionResult.parse({
    recommendationId: id,
    status: row.status,
    orderId: row.order_id,
    erpPoNumber: row.erp_po_number,
    erpSyncStatus: row.erp_sync_status,
    instructionId: row.instruction_id,
  });
}
