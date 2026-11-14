import {
  buildDemoBunkerPlanInput,
  DEMO_SCENARIO,
  loadWorld,
  type Sql,
  seedDatabase,
} from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { planBunkers } from "@pharos/domain";
import { BunkerPlan, DecisionResult, ERP_IDEMPOTENCY_HEADER } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createErpApp } from "../../../../services/erp-sim/src/app.js";
import { createToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { proposeAction } from "../ai/tools/propose-action.js";
import { ASK_FIXTURE_NOW, insertDemoQuotes, prepareAskFixture } from "../ask/demo-fixture.js";
import { FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";
import { createErpClient, type ErpFetch } from "./erp-client.js";
import {
  approveRecommendation,
  DecisionError,
  type ExecutorDeps,
  idempotencyKeyFor,
  rejectRecommendation,
} from "./execute.js";

const NOW = new Date("2026-11-14T08:20:00.000Z");
/** The fixture world's anchor in epoch seconds, the world part of every idempotency key. */
const ANCHOR_S = Math.floor(FIXTURE_ANCHOR.getTime() / 1000);

describe("idempotencyKeyFor", () => {
  it("is rec-<recommendationId>-<world anchor epoch seconds>", () => {
    expect(idempotencyKeyFor(7, new Date("2026-11-14T08:00:00.000Z"))).toBe("rec-7-1794643200");
    // Sub-second parts of the anchor do not change the key.
    expect(idempotencyKeyFor(7, new Date("2026-11-14T08:00:00.900Z"))).toBe("rec-7-1794643200");
  });

  it("differs between worlds with different anchors for the same recommendation id", () => {
    const a = idempotencyKeyFor(1, new Date("2026-11-14T08:00:00Z"));
    const b = idempotencyKeyFor(1, new Date("2026-11-15T09:30:00Z"));
    expect(a).not.toBe(b);
  });
});

const sql = await connectTestDb("executor");

if (!sql) {
  describe("executor (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("executor")}`, () => {});
  });
}

describe.skipIf(!sql)("executor (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;

  /** The ERP simulator in-process; `mode` switches it off to simulate an outage. */
  let erp: {
    mode: "up" | "down" | "5xx";
    requests: { key: string | null; body: Record<string, unknown> }[];
  };
  let deps: ExecutorDeps;
  let recId: number;
  let calculationId: number;
  let kestrelQuoteId: number;

  beforeEach(async () => {
    const quoteIds = await prepareAskFixture(db);
    kestrelQuoteId = quoteIds[0] ?? 0;
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const planned = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    const factId = (suffix: string) => planned.facts.find((f) => f.id.endsWith(suffix))?.id ?? "";
    const proposed = await proposeAction(ctx, {
      type: "purchase_order",
      calculationId: (planned.data as { calculationId: number }).calculationId,
      optionId: "MTMLA-kestrel",
      factRefs: [factId("_bestOptionId")],
      rationale: "Lowest total delivered cost.",
    });
    recId = (proposed.data as { recommendationId: number }).recommendationId;
    calculationId = (planned.data as { calculationId: number }).calculationId;

    const app = createErpApp({ now: () => NOW });
    erp = { mode: "up", requests: [] };
    const fetchImpl: ErpFetch = async (input, init) => {
      if (erp.mode === "down") throw new TypeError("fetch failed");
      erp.requests.push({
        key: new Headers(init.headers).get(ERP_IDEMPOTENCY_HEADER),
        body: JSON.parse(String(init.body)),
      });
      if (erp.mode === "5xx") return new Response("unavailable", { status: 503 });
      return app.request(input, init);
    };
    deps = { sql: db, erp: createErpClient("http://erp.test", fetchImpl), now: () => NOW };
  });
  afterAll(async () => {
    await db.end();
  });

  const ordersOf = (id: number) =>
    db<
      {
        id: number;
        quote_id: number;
        status: string;
        erp_po_number: string | null;
        erp_sync_status: string;
        idempotency_key: string;
      }[]
    >`select id, quote_id, status, erp_po_number, erp_sync_status, idempotency_key
      from purchase_orders where recommendation_id = ${id} order by id`;
  const recommendation = async (id: number) => {
    const [row] = await db<{ status: string; decided_by: string | null; decided_at: unknown }[]>`
      select status, decided_by, decided_at from recommendations where id = ${id}`;
    return row;
  };
  const auditKinds = async (id: number) =>
    (
      await db<{ kind: string }[]>`
        select kind from audit_events where recommendation_id = ${id} order by id`
    ).map((r) => r.kind);
  const quoteStatus = async (id: number) =>
    (await db<{ status: string }[]>`select status from quotes where id = ${id}`)[0]?.status;

  it("approve writes one purchase order from the calculation and the quote, pushes it and executes", async () => {
    const result = DecisionResult.parse(await approveRecommendation(deps, recId, "alice"));
    expect(result).toMatchObject({
      recommendationId: recId,
      status: "executed",
      erpPoNumber: "PO-000001",
      erpSyncStatus: "synced",
    });

    const orders = await ordersOf(recId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: result.orderId,
      quote_id: kestrelQuoteId,
      status: "confirmed",
      erp_po_number: "PO-000001",
      erp_sync_status: "synced",
      idempotency_key: `rec-${recId}-${ANCHOR_S}`,
    });

    // Quantity from the stored plan option; price, currency and barge fee from the quote.
    const [calc] = await db<{ outputs: unknown }[]>`
      select outputs from calculations where id = ${calculationId}`;
    const option = BunkerPlan.parse(calc?.outputs).options.find(
      (o) => o.optionId === "MTMLA-kestrel",
    );
    const [quote] = await db<{ currency: string; barge_fee: number; price_per_mt: number }[]>`
      select q.currency, q.barge_fee, l.price_per_mt
      from quotes q join quote_lines l on l.quote_id = q.id where q.id = ${kestrelQuoteId}`;
    const lines = await db`
      select grade, qty_mt, price_per_mt from order_lines where order_id = ${result.orderId}`;
    expect(lines).toEqual([
      { grade: "LSMGO", qty_mt: option?.qtyMt, price_per_mt: quote?.price_per_mt },
    ]);

    const [codes] = await db<{ erp_code: string; imo: string }[]>`
      select s.erp_code, v.imo from quotes q join suppliers s on s.id = q.supplier_id,
        vessels v where q.id = ${kestrelQuoteId} and v.imo = ${DEMO_SCENARIO.vesselImo}`;
    expect(erp.requests).toEqual([
      {
        key: `rec-${recId}-${ANCHOR_S}`,
        body: {
          supplierErpCode: codes?.erp_code,
          vesselImo: DEMO_SCENARIO.vesselImo,
          port: "MTMLA",
          currency: quote?.currency,
          lines: [{ grade: "LSMGO", qtyMt: option?.qtyMt, pricePerMt: quote?.price_per_mt }],
          bargeFee: quote?.barge_fee,
          reference: `rec-${recId}-${ANCHOR_S}`,
        },
      },
    ]);

    const rec = await recommendation(recId);
    expect(rec?.status).toBe("executed");
    expect(rec?.decided_by).toBe("alice");
    expect(rec?.decided_at).not.toBeNull();
    expect(await quoteStatus(kestrelQuoteId)).toBe("ordered");
    const [req] = await db<{ status: string }[]>`
      select r.status from bunker_requirements r join quotes q on q.requirement_id = r.id
      where q.id = ${kestrelQuoteId}`;
    expect(req?.status).toBe("ordered");
    expect(await auditKinds(recId)).toEqual([
      "recommendation.approved",
      "order.created",
      "order.synced",
    ]);
  });

  it("a reset world's first recommendation gets a new key, so the kept ERP store makes a new PO", async () => {
    const first = await approveRecommendation(deps, recId, "alice");
    expect(first.erpPoNumber).toBe("PO-000001");

    // Reboot: a new world (new anchor, ids restarted), the same ERP store.
    const anchor = new Date(FIXTURE_ANCHOR.getTime() + 26 * 3_600_000);
    await seedDatabase(db, { seed: FIXTURE_SEED, anchor, mode: "reset" });
    await insertDemoQuotes(db);
    const ctx = createToolContext({ sql: db, now: () => anchor });
    const planned = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    const best = planned.facts.find((f) => f.id.endsWith("_bestOptionId"));
    const proposed = await proposeAction(ctx, {
      type: "purchase_order",
      calculationId: (planned.data as { calculationId: number }).calculationId,
      optionId: "MTMLA-kestrel",
      factRefs: [best?.id ?? ""],
      rationale: "Lowest total delivered cost.",
    });
    const again = (proposed.data as { recommendationId: number }).recommendationId;
    expect(again).toBe(recId);

    const second = await approveRecommendation(deps, again, "alice");
    expect(second).toMatchObject({ erpSyncStatus: "synced", erpPoNumber: "PO-000002" });
    const keys = erp.requests.map((r) => r.key);
    expect(keys).toEqual([
      `rec-${recId}-${ANCHOR_S}`,
      `rec-${recId}-${Math.floor(anchor.getTime() / 1000)}`,
    ]);
    expect((await ordersOf(again))[0]?.idempotency_key).toBe(keys[1]);
  });

  it("approve twice creates one order and one ERP call", async () => {
    const first = await approveRecommendation(deps, recId, "alice");
    const second = await approveRecommendation(deps, recId, "bob");
    expect(second).toEqual(first);
    expect(await ordersOf(recId)).toHaveLength(1);
    expect(erp.requests).toHaveLength(1);
    expect((await recommendation(recId))?.decided_by).toBe("alice");
    expect(await auditKinds(recId)).toEqual([
      "recommendation.approved",
      "order.created",
      "order.synced",
    ]);
  });

  it("two concurrent approves still create exactly one order and one PO number", async () => {
    const results = await Promise.all([
      approveRecommendation(deps, recId, "alice"),
      approveRecommendation(deps, recId, "bob"),
    ]);
    const orders = await ordersOf(recId);
    expect(orders).toHaveLength(1);
    expect(results.map((r) => r.orderId)).toEqual([orders[0]?.id, orders[0]?.id]);
    expect(new Set(results.map((r) => r.erpPoNumber))).toEqual(new Set(["PO-000001"]));
    expect(new Set(erp.requests.map((r) => r.key))).toEqual(new Set([`rec-${recId}-${ANCHOR_S}`]));
    const kinds = await auditKinds(recId);
    expect(kinds.filter((k) => k === "recommendation.approved")).toHaveLength(1);
    expect(kinds.filter((k) => k === "order.created")).toHaveLength(1);
    expect(kinds.filter((k) => k === "order.synced")).toHaveLength(1);
  });

  it("ERP down leaves order failed and recommendation approved; approve again syncs with the same key", async () => {
    erp.mode = "down";
    const down = DecisionResult.parse(await approveRecommendation(deps, recId, "alice"));
    expect(down).toMatchObject({
      recommendationId: recId,
      status: "approved",
      erpPoNumber: null,
      erpSyncStatus: "failed",
    });
    expect(await ordersOf(recId)).toMatchObject([
      { erp_sync_status: "failed", erp_po_number: null, status: "approved" },
    ]);
    expect((await recommendation(recId))?.status).toBe("approved");
    expect(await quoteStatus(kestrelQuoteId)).toBe("received");
    expect(await auditKinds(recId)).toEqual([
      "recommendation.approved",
      "order.created",
      "order.sync_failed",
    ]);

    erp.mode = "5xx";
    const stillDown = await approveRecommendation(deps, recId, "alice");
    expect(stillDown).toMatchObject({ status: "approved", erpSyncStatus: "failed" });

    erp.mode = "up";
    const retried = DecisionResult.parse(await approveRecommendation(deps, recId, "bob"));
    expect(retried).toEqual({
      recommendationId: recId,
      status: "executed",
      orderId: down.orderId,
      erpPoNumber: "PO-000001",
      erpSyncStatus: "synced",
    });
    expect(await ordersOf(recId)).toHaveLength(1);
    expect(erp.requests.map((r) => r.key)).toEqual([
      `rec-${recId}-${ANCHOR_S}`,
      `rec-${recId}-${ANCHOR_S}`,
    ]);
    expect(erp.requests[1]?.body).toEqual(erp.requests[0]?.body);
    expect((await recommendation(recId))?.decided_by).toBe("alice");
    expect(await quoteStatus(kestrelQuoteId)).toBe("ordered");
    expect(await auditKinds(recId)).toEqual([
      "recommendation.approved",
      "order.created",
      "order.sync_failed",
      "order.sync_failed",
      "order.synced",
    ]);
  });

  it("any push error, e.g. a stored order the ERP contract rejects, leaves the order failed and audited", async () => {
    const [supplier] = await db<{ id: number; erp_code: string }[]>`
      select s.id, s.erp_code from suppliers s join quotes q on q.supplier_id = s.id
      where q.id = ${kestrelQuoteId}`;
    await db`update suppliers set erp_code = '' where id = ${supplier?.id ?? 0}`;

    const failed = DecisionResult.parse(await approveRecommendation(deps, recId, "alice"));
    expect(failed).toMatchObject({
      status: "approved",
      erpSyncStatus: "failed",
      erpPoNumber: null,
    });
    expect(erp.requests).toHaveLength(0);
    const [audit] = await db<{ detail: { orderId: number; error: string } }[]>`
      select detail from audit_events
      where recommendation_id = ${recId} and kind = 'order.sync_failed'`;
    expect(audit?.detail.orderId).toBe(failed.orderId);
    expect(audit?.detail.error).toMatch(/supplierErpCode/);

    await db`update suppliers set erp_code = ${supplier?.erp_code ?? ""} where id = ${supplier?.id ?? 0}`;
    const retried = await approveRecommendation(deps, recId, "alice");
    expect(retried).toMatchObject({
      status: "executed",
      erpSyncStatus: "synced",
      erpPoNumber: "PO-000001",
      orderId: failed.orderId,
    });
  });

  it("an unexpected error from the ERP client is recorded the same way, not thrown", async () => {
    const broken: ExecutorDeps = {
      ...deps,
      erp: {
        placeOrder: async () => {
          throw new Error("proxy closed the socket");
        },
      },
    };
    const result = await approveRecommendation(broken, recId, "alice");
    expect(result).toMatchObject({ status: "approved", erpSyncStatus: "failed" });
    const [audit] = await db<{ detail: { error: string } }[]>`
      select detail from audit_events
      where recommendation_id = ${recId} and kind = 'order.sync_failed'`;
    expect(audit?.detail.error).toBe("proxy closed the socket");
  });

  it("reject is final", async () => {
    const rejected = DecisionResult.parse(await rejectRecommendation(deps, recId, "carol"));
    expect(rejected).toEqual({
      recommendationId: recId,
      status: "rejected",
      orderId: null,
      erpPoNumber: null,
      erpSyncStatus: null,
    });
    const rec = await recommendation(recId);
    expect(rec?.status).toBe("rejected");
    expect(rec?.decided_by).toBe("carol");

    const approve = await approveRecommendation(deps, recId, "alice").catch((e: unknown) => e);
    expect(approve).toBeInstanceOf(DecisionError);
    expect((approve as DecisionError).code).toBe("already_rejected");
    const again = await rejectRecommendation(deps, recId, "carol").catch((e: unknown) => e);
    expect(again).toBeInstanceOf(DecisionError);
    expect((again as DecisionError).code).toBe("not_pending");

    expect(await ordersOf(recId)).toHaveLength(0);
    expect(erp.requests).toHaveLength(0);
    expect(await auditKinds(recId)).toEqual(["recommendation.rejected"]);
  });

  it("reject after approval is a conflict and changes nothing", async () => {
    await approveRecommendation(deps, recId, "alice");
    const err = await rejectRecommendation(deps, recId, "carol").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DecisionError);
    expect((err as DecisionError).code).toBe("not_pending");
    expect((await recommendation(recId))?.status).toBe("executed");
  });

  it("an unknown recommendation is not_found", async () => {
    const approve = await approveRecommendation(deps, 999_999, "alice").catch((e: unknown) => e);
    expect((approve as DecisionError).code).toBe("not_found");
    const reject = await rejectRecommendation(deps, 999_999, "alice").catch((e: unknown) => e);
    expect((reject as DecisionError).code).toBe("not_found");
  });

  it("an option with no stored quote cannot be executed and the recommendation stays pending", async () => {
    // The Phase 1 demo plan: its options are scenario offers, not received quotes (quoteId null).
    const world = await loadWorld(db);
    const input = buildDemoBunkerPlanInput(world);
    const plan = planBunkers(input);
    const [calc] = await db<{ id: number }[]>`
      insert into calculations (kind, inputs, outputs, code_version, voyage_id, weather_snapshot_id, created_at)
      values ('bunker_plan', ${JSON.stringify(input)}::jsonb, ${JSON.stringify(plan)}::jsonb, 'test',
              null, null, ${NOW.toISOString()}::timestamptz)
      returning id`;
    const [rec] = await db<{ id: number }[]>`
      insert into recommendations (type, calculation_id, option_id, message_id, fact_refs,
                                   expected_saving_usd, status, decided_by, decided_at, created_at)
      values ('purchase_order', ${calc?.id ?? 0}, ${plan.bestOptionId ?? ""}, null, '[]'::jsonb,
              null, 'pending', null, null, ${NOW.toISOString()}::timestamptz)
      returning id`;
    const id = rec?.id ?? 0;
    const err = await approveRecommendation(deps, id, "alice").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DecisionError);
    expect((err as DecisionError).code).toBe("not_executable");
    expect((await recommendation(id))?.status).toBe("pending");
    expect(await ordersOf(id)).toHaveLength(0);
    expect(await auditKinds(id)).toEqual([]);
    expect(erp.requests).toHaveLength(0);
  });
});
