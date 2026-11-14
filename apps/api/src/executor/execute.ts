/**
 * The executor: the only code that writes purchase orders, and only after a human approves.
 *
 * Every order value comes from the database, never from model text: the quantity is the stored
 * plan option's `qtyMt`; price, currency and barge fee come from the quote the option points at;
 * supplier ERP code, vessel IMO and port UN/LOCODE from their rows. The order is written once per
 * recommendation (row lock + unique idempotency key) and pushed to the ERP after the commit, with
 * `idempotencyKey = "rec-<id>-<world anchor epoch seconds>"`, minted once and stored on the order,
 * so a retry after an outage can never create a second order.
 */
import type { Sql } from "@pharos/db";
import {
  BunkerPlan,
  BunkerPlanInput,
  DecisionResult,
  type ErpOrderRequest,
  type FuelGrade,
  type Id,
} from "@pharos/shared";
import type { ErpClient } from "./erp-client.js";

export interface ExecutorDeps {
  sql: Sql;
  erp: ErpClient;
  /** Clock for decision, order and audit timestamps. */
  now?: () => Date;
  log?: (message: string) => void;
}

export type DecisionErrorCode = "not_found" | "already_rejected" | "not_pending" | "not_executable";

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
 * The ERP idempotency key (and our order reference) for a recommendation in a world. Every boot
 * reseeds the world with restarted ids while the ERP keeps its keys, so the world's anchor (epoch
 * seconds, from `world_meta`) keeps "recommendation 1" of one world apart from that of the next.
 * Deterministic for the same world and recommendation.
 */
export const idempotencyKeyFor = (recommendationId: Id, worldAnchor: Date) =>
  `rec-${recommendationId}-${Math.floor(worldAnchor.getTime() / 1000)}`;

/** Audit actor for what the executor does on its own after a decision. */
const EXECUTOR = "executor";

/** The connection inside `sql.begin` (postgres.js `TransactionSql`). */
type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

/** timestamptz parameter: postgres.js does not serialise a Date in an untyped position. */
const iso = (d: Date): string => d.toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const clock = (deps: ExecutorDeps) => (deps.now ?? (() => new Date()))();

async function audit(
  tx: Tx,
  recommendationId: Id,
  kind: string,
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
  status: string;
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
 * Approves a pending recommendation, writes its purchase order once, and pushes the order to the
 * ERP. Calling it again on an approved or executed recommendation re-uses the order and only
 * retries a push that has not synced. A failed push is not an error: the order is left `failed`
 * (audited) and the recommendation stays `approved` until a later call syncs it.
 */
export async function approveRecommendation(
  deps: ExecutorDeps,
  id: Id,
  decidedBy: string,
): Promise<DecisionResult> {
  const now = clock(deps);
  const orderId = await deps.sql.begin(async (tx) => {
    const rec = await lockRecommendation(tx, id);
    if (rec.status === "rejected") {
      throw new DecisionError("already_rejected", `Recommendation ${id} was rejected.`);
    }
    if (rec.status === "pending") {
      await tx`
        update recommendations set status = 'approved', decided_by = ${decidedBy},
          decided_at = ${iso(now)}::timestamptz
        where id = ${id}`;
      await audit(tx, id, "recommendation.approved", decidedBy, {}, now);
    }
    const [existing] = await tx<{ id: number }[]>`
      select id from purchase_orders where recommendation_id = ${id} order by id limit 1`;
    return existing ? existing.id : createOrder(tx, rec, now);
  });
  await pushOrder(deps, id, orderId);
  return decisionOf(deps.sql, id);
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
      update recommendations set status = 'rejected', decided_by = ${decidedBy},
        decided_at = ${iso(now)}::timestamptz
      where id = ${id}`;
    await audit(tx, id, "recommendation.rejected", decidedBy, {}, now);
  });
  return decisionOf(deps.sql, id);
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
  if (calc?.kind !== "bunker_plan") {
    refuse(`calculation ${rec.calculation_id} is not a bunker plan.`);
  }
  const input = BunkerPlanInput.safeParse(calc.inputs);
  const plan = BunkerPlan.safeParse(calc.outputs);
  if (!input.success || !plan.success) refuse(`calculation ${rec.calculation_id} is unreadable.`);
  const grade = input.data.grade;
  const offer = input.data.options.find((o) => o.optionId === rec.option_id);
  const result = plan.data.options.find((o) => o.optionId === rec.option_id);
  if (!offer || !result) refuse(`the plan has no option ${rec.option_id}.`);
  if (!result.feasible || result.qtyMt <= 0) refuse(`option ${rec.option_id} is not feasible.`);
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
  const [taken] = await tx<{ id: number }[]>`
    select id from purchase_orders where quote_id = ${quote.id}`;
  if (taken) refuse(`quote ${quote.id} already has purchase order ${taken.id}.`);
  const [line] = await tx<{ price_per_mt: number }[]>`
    select price_per_mt from quote_lines where quote_id = ${quote.id} and grade = ${grade}
    order by id limit 1`;
  if (!line) refuse(`quote ${quote.id} has no ${grade} line.`);

  const [world] = await tx<{ anchor: Date | string }[]>`
    select anchor from world_meta order by id limit 1`;
  if (!world) throw new Error("world_meta is empty; seed the database first");
  const key = idempotencyKeyFor(rec.id, new Date(world.anchor));
  const [order] = await tx<{ id: number }[]>`
    insert into purchase_orders (quote_id, recommendation_id, status, erp_po_number,
                                 erp_sync_status, idempotency_key, created_at)
    values (${quote.id}, ${rec.id}, 'approved', null, 'pending', ${key}, ${iso(now)}::timestamptz)
    returning id`;
  if (!order) throw new Error("purchase_orders insert returned no row");
  await tx`
    insert into order_lines (order_id, grade, qty_mt, price_per_mt)
    values (${order.id}, ${grade}, ${result.qtyMt}, ${line.price_per_mt})`;
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
 * Pushes an unsynced order to the ERP and records the outcome. Any failure of the push (ERP
 * down, ERP refusal, or a stored order the ERP contract rejects) leaves the order `failed` with an
 * `order.sync_failed` audit carrying the error; it is never thrown, so a later approve retries.
 */
async function pushOrder(deps: ExecutorDeps, recId: Id, orderId: Id): Promise<void> {
  const { sql } = deps;
  const [order] = await sql<
    { quote_id: number; erp_sync_status: string; idempotency_key: string }[]
  >`
    select quote_id, erp_sync_status, idempotency_key from purchase_orders where id = ${orderId}`;
  if (!order) throw new Error(`purchase order ${orderId} does not exist`);
  if (order.erp_sync_status === "synced") return;
  const key = order.idempotency_key;

  let confirmed: Awaited<ReturnType<ErpClient["placeOrder"]>>;
  try {
    confirmed = await deps.erp.placeOrder(await erpRequestFor(sql, orderId), key);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log?.(`[executor] order ${orderId} (${key}): ERP push failed: ${error}`);
    await sql.begin(async (tx) => {
      // A concurrent push may have synced it meanwhile; never downgrade that.
      const marked = await tx`
        update purchase_orders set erp_sync_status = 'failed'
        where id = ${orderId} and erp_sync_status <> 'synced' returning id`;
      if (marked.length > 0) {
        await audit(
          tx,
          recId,
          "order.sync_failed",
          EXECUTOR,
          { orderId, idempotencyKey: key, error },
          clock(deps),
        );
      }
    });
    return;
  }

  await sql.begin(async (tx) => {
    const synced = await tx`
      update purchase_orders set erp_sync_status = 'synced', erp_po_number = ${confirmed.poNumber},
        status = 'confirmed'
      where id = ${orderId} and erp_sync_status <> 'synced' returning id`;
    if (synced.length === 0) return; // a concurrent push recorded the same PO first
    await tx`update recommendations set status = 'executed' where id = ${recId} and status = 'approved'`;
    await tx`update quotes set status = 'ordered' where id = ${order.quote_id}`;
    await tx`
      update bunker_requirements set status = 'ordered'
      where id = (select requirement_id from quotes where id = ${order.quote_id}) and status = 'open'`;
    await audit(
      tx,
      recId,
      "order.synced",
      EXECUTOR,
      { orderId, erpPoNumber: confirmed.poNumber, duplicate: confirmed.duplicate },
      clock(deps),
    );
  });
}

/** The recommendation's state and its order's, as the decision routes return it. */
async function decisionOf(sql: Sql, id: Id): Promise<DecisionResult> {
  const [row] = await sql<
    {
      status: string;
      order_id: number | null;
      erp_po_number: string | null;
      erp_sync_status: string | null;
    }[]
  >`
    select r.status, po.id as order_id, po.erp_po_number, po.erp_sync_status
    from recommendations r left join purchase_orders po on po.recommendation_id = r.id
    where r.id = ${id}
    order by po.id limit 1`;
  if (!row) throw new DecisionError("not_found", `Recommendation ${id} does not exist.`);
  return DecisionResult.parse({
    recommendationId: id,
    status: row.status,
    orderId: row.order_id,
    erpPoNumber: row.erp_po_number,
    erpSyncStatus: row.erp_sync_status,
  });
}
