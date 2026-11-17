import {
  buildDemoBunkerPlanInput,
  DEFAULT_WORLD_SEED,
  DEMO_SCENARIO,
  loadWorld,
  type Sql,
  seedDatabase,
} from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { planBunkers } from "@pharos/domain";
import {
  AuditEventView,
  BunkerPlan,
  DecisionResult,
  ERP_IDEMPOTENCY_HEADER,
  RouteSpeedResult,
  StopCandidate,
} from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createErpApp } from "../../../../services/erp-sim/src/app.js";
import { createToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { proposeAction } from "../ai/tools/propose-action.js";
import { planRouteSpeedFacts } from "../ai/tools/route-speed.js";
import { ASK_FIXTURE_NOW, insertDemoQuotes, prepareAskFixture } from "../ask/demo-fixture.js";
import { FIXTURE_ANCHOR } from "../read/fixtures.js";
import { createErpClient, type ErpFetch } from "./erp-client.js";
import {
  approveRecommendation,
  DecisionError,
  draftsOf,
  type ExecutorDeps,
  idempotencyKeyFor,
  rejectRecommendation,
} from "./execute.js";

const NOW = new Date("2026-11-14T08:20:00.000Z");
describe("idempotencyKeyFor", () => {
  it("is rec-<recommendationId>-<world seeded_at epoch milliseconds>", () => {
    expect(idempotencyKeyFor(7, new Date("2026-11-14T08:00:00.000Z"))).toBe("rec-7-1794643200000");
    expect(idempotencyKeyFor(7, new Date("2026-11-14T08:00:00.900Z"))).toBe("rec-7-1794643200900");
  });

  it("differs between two seeds of the same recommendation id, even a moment apart", () => {
    const a = idempotencyKeyFor(1, new Date("2026-11-14T08:00:00.000Z"));
    const b = idempotencyKeyFor(1, new Date("2026-11-14T08:00:00.001Z"));
    expect(a).not.toBe(b);
  });
});

/** When the test database's world was seeded (`world_meta.seeded_at`), in epoch ms. */
const seededAtMs = async (db: Sql) => {
  const [row] = await db<{ seeded_at: string | Date }[]>`select seeded_at from world_meta`;
  if (!row) throw new Error("world_meta is empty");
  return new Date(row.seeded_at).getTime();
};

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
  /** The world part of every idempotency key in this world. */
  let SEED_MS: number;

  beforeEach(async () => {
    const quoteIds = await prepareAskFixture(db);
    SEED_MS = await seededAtMs(db);
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
  // Every row the executor writes must parse as an AuditEventView (kind is an AUDIT_KINDS member).
  const auditKinds = async (id: number) =>
    (
      await db<
        { id: number; kind: string; actor: string; detail: unknown; at: Date | string }[]
      >`select id, kind, actor, detail, at from audit_events where recommendation_id = ${id} order by id`
    ).map(
      (r) =>
        AuditEventView.parse({
          id: r.id,
          recommendationId: id,
          kind: r.kind,
          actor: r.actor,
          detail: r.detail ?? null,
          at: new Date(r.at).toISOString(),
        }).kind,
    );
  const quoteStatus = async (id: number) =>
    (await db<{ status: string }[]>`select status from quotes where id = ${id}`)[0]?.status;

  it("approve writes one purchase order from the calculation and the quote, pushes it and executes", async () => {
    const result = DecisionResult.parse(await approveRecommendation(deps, recId, "alice"));
    expect(result).toMatchObject({
      recommendationId: recId,
      status: "executed",
      erpPoNumber: "PO-000001",
      erpSyncStatus: "synced",
      instructionId: null,
    });

    const orders = await ordersOf(recId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: result.orderId,
      quote_id: kestrelQuoteId,
      status: "confirmed",
      erp_po_number: "PO-000001",
      erp_sync_status: "synced",
      idempotency_key: `rec-${recId}-${SEED_MS}`,
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
        key: `rec-${recId}-${SEED_MS}`,
        body: {
          supplierErpCode: codes?.erp_code,
          vesselImo: DEMO_SCENARIO.vesselImo,
          port: "MTMLA",
          currency: quote?.currency,
          lines: [{ grade: "LSMGO", qtyMt: option?.qtyMt, pricePerMt: quote?.price_per_mt }],
          bargeFee: quote?.barge_fee,
          reference: `rec-${recId}-${SEED_MS}`,
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
      "order.pushed",
      "drafts.created",
      "recommendation.executed",
    ]);
  });

  it("a reset world's first recommendation gets a new key, so the kept ERP store makes a new PO", async () => {
    const first = await approveRecommendation(deps, recId, "alice");
    expect(first.erpPoNumber).toBe("PO-000001");

    // Reboot: a new world (new anchor, ids restarted), the same ERP store.
    const anchor = new Date(FIXTURE_ANCHOR.getTime() + 26 * 3_600_000);
    await seedDatabase(db, { seed: DEFAULT_WORLD_SEED, anchor, mode: "reset" });
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
    expect(keys).toEqual([`rec-${recId}-${SEED_MS}`, `rec-${recId}-${await seededAtMs(db)}`]);
    expect((await ordersOf(again))[0]?.idempotency_key).toBe(keys[1]);
  });

  it("a reseed at the same (pinned) anchor still gives recommendation 1 a new key and a new PO", async () => {
    const first = await approveRecommendation(deps, recId, "alice");
    expect(first.erpPoNumber).toBe("PO-000001");

    // Restart with DEMO_ANCHOR pinned and SEED_ON_BOOT=reset: the same anchor, ids restarted,
    // the same ERP store. A key built from the anchor would replay the rehearsal's order.
    await seedDatabase(db, { seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
    await insertDemoQuotes(db);
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
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
    expect(second).toMatchObject({
      status: "executed",
      erpSyncStatus: "synced",
      erpPoNumber: "PO-000002",
    });
    const keys = erp.requests.map((r) => r.key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[1]).toBe(`rec-${recId}-${await seededAtMs(db)}`);
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
      "order.pushed",
      "drafts.created",
      "recommendation.executed",
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
    // The loser sees the winner's execution under way (or done) and only reports it.
    expect(results.map((r) => r.status).sort()).toContain("executed");
    expect(new Set(results.map((r) => r.erpPoNumber).filter((n) => n !== null))).toEqual(
      new Set(["PO-000001"]),
    );
    expect(new Set(erp.requests.map((r) => r.key))).toEqual(new Set([`rec-${recId}-${SEED_MS}`]));
    const kinds = await auditKinds(recId);
    expect(kinds.filter((k) => k === "recommendation.approved")).toHaveLength(1);
    expect(kinds.filter((k) => k === "order.created")).toHaveLength(1);
    expect(kinds.filter((k) => k === "order.pushed")).toHaveLength(1);
  });

  it("ERP down leaves order and recommendation failed; approve again retries and syncs with the same key", async () => {
    erp.mode = "down";
    const down = DecisionResult.parse(await approveRecommendation(deps, recId, "alice"));
    expect(down).toMatchObject({
      recommendationId: recId,
      status: "failed",
      erpPoNumber: null,
      erpSyncStatus: "failed",
    });
    expect(await ordersOf(recId)).toMatchObject([
      { erp_sync_status: "failed", erp_po_number: null, status: "approved" },
    ]);
    expect((await recommendation(recId))?.status).toBe("failed");
    expect(await quoteStatus(kestrelQuoteId)).toBe("received");
    expect(await auditKinds(recId)).toEqual([
      "recommendation.approved",
      "order.created",
      "order.sync_failed",
      "recommendation.failed",
    ]);

    erp.mode = "5xx";
    const stillDown = await approveRecommendation(deps, recId, "alice");
    expect(stillDown).toMatchObject({ status: "failed", erpSyncStatus: "failed" });

    erp.mode = "up";
    const retried = DecisionResult.parse(await approveRecommendation(deps, recId, "bob"));
    expect(retried).toEqual({
      recommendationId: recId,
      status: "executed",
      orderId: down.orderId,
      erpPoNumber: "PO-000001",
      erpSyncStatus: "synced",
      instructionId: null,
    });
    expect(await ordersOf(recId)).toHaveLength(1);
    expect(erp.requests.map((r) => r.key)).toEqual([
      `rec-${recId}-${SEED_MS}`,
      `rec-${recId}-${SEED_MS}`,
    ]);
    expect(erp.requests[1]?.body).toEqual(erp.requests[0]?.body);
    expect((await recommendation(recId))?.decided_by).toBe("alice");
    expect(await quoteStatus(kestrelQuoteId)).toBe("ordered");
    expect(await auditKinds(recId)).toEqual([
      "recommendation.approved",
      "order.created",
      "order.sync_failed",
      "recommendation.failed",
      "recommendation.retried",
      "order.sync_failed",
      "recommendation.failed",
      "recommendation.retried",
      "order.pushed",
      "drafts.created",
      "recommendation.executed",
    ]);
  });

  it("a retry is audited as the human who approved it again, not the executor", async () => {
    erp.mode = "down";
    await approveRecommendation(deps, recId, "alice");
    erp.mode = "up";
    await approveRecommendation(deps, recId, "bob");
    const rows = await db<{ kind: string; actor: string }[]>`
      select kind, actor from audit_events where recommendation_id = ${recId} order by id`;
    expect(rows.filter((r) => r.kind === "recommendation.retried")).toEqual([
      { kind: "recommendation.retried", actor: "bob" },
    ]);
    expect(rows.find((r) => r.kind === "recommendation.approved")?.actor).toBe("alice");
  });

  it("a multi-grade quote: executing the VLSFO plan closes the voyage's VLSFO requirement, not the quote's LSMGO one", async () => {
    // A VLSFO requirement on the demo voyage, and Kestrel's quote (linked to the LSMGO
    // requirement) also offering VLSFO, so it backs both plans.
    await db`
      insert into bunker_requirements (voyage_id, grade, qty_mt, status, created_at)
      values ((select id from voyages where voyage_no = ${DEMO_SCENARIO.voyageNo}), 'VLSFO', 200,
              'open', ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    await db`
      insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
      values (${kestrelQuoteId}, 'VLSFO', 200, 590)`;
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const planned = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    const vlsfo = (
      planned.data as { plans: { calculationId: number; grade: string; bestOptionId: string }[] }
    ).plans.find((p) => p.grade === "VLSFO");
    expect(vlsfo?.bestOptionId).toBe("VLSFO-MTMLA-kestrel");
    const best = planned.facts.find(
      (f) =>
        f.id.endsWith("_bestOptionId") &&
        f.provenance.source === "calculation" &&
        f.provenance.calculationId === vlsfo?.calculationId,
    );
    const proposed = await proposeAction(ctx, {
      type: "purchase_order",
      calculationId: vlsfo?.calculationId,
      optionId: "VLSFO-MTMLA-kestrel",
      factRefs: [best?.id],
      rationale: "Lowest total delivered cost.",
    });
    const vlsfoRec = (proposed.data as { recommendationId: number }).recommendationId;

    const result = await approveRecommendation(deps, vlsfoRec, "alice");
    expect(result.status).toBe("executed");
    const lines = await db<{ grade: string }[]>`
      select ol.grade from order_lines ol join purchase_orders po on po.id = ol.order_id
      where po.recommendation_id = ${vlsfoRec}`;
    expect(lines.map((l) => l.grade)).toEqual(["VLSFO"]);
    const requirements = await db<{ grade: string; status: string }[]>`
      select r.grade, r.status from bunker_requirements r join voyages v on v.id = r.voyage_id
      where v.voyage_no = ${DEMO_SCENARIO.voyageNo} order by r.id`;
    expect(requirements).toEqual([
      { grade: "LSMGO", status: "open" },
      { grade: "VLSFO", status: "ordered" },
    ]);
  });

  it("any push error, e.g. a stored order the ERP contract rejects, leaves the order failed and audited", async () => {
    const [supplier] = await db<{ id: number; erp_code: string }[]>`
      select s.id, s.erp_code from suppliers s join quotes q on q.supplier_id = s.id
      where q.id = ${kestrelQuoteId}`;
    await db`update suppliers set erp_code = '' where id = ${supplier?.id ?? 0}`;

    const failed = DecisionResult.parse(await approveRecommendation(deps, recId, "alice"));
    expect(failed).toMatchObject({
      status: "failed",
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
    expect(result).toMatchObject({ status: "failed", erpSyncStatus: "failed" });
    const [audit] = await db<{ detail: { error: string } }[]>`
      select detail from audit_events
      where recommendation_id = ${recId} and kind = 'order.sync_failed'`;
    expect(audit?.detail.error).toBe("proxy closed the socket");
  });

  it("stores one supplier and one master draft with numbers from the order, never sent", async () => {
    await approveRecommendation(deps, recId, "alice");
    const drafts = await draftsOf(db, recId);
    expect(drafts.map((d) => [d.kind, d.status])).toEqual([
      ["supplier_confirmation", "draft"],
      ["master_instruction", "draft"],
    ]);
    const [line] = await db<{ qty_mt: number; price_per_mt: number }[]>`
      select l.qty_mt, l.price_per_mt from order_lines l join purchase_orders o on o.id = l.order_id
      where o.recommendation_id = ${recId}`;
    const qty = (line?.qty_mt ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
    expect(drafts[0]?.to).toMatch(/^bunkers@/);
    expect(drafts[0]?.body).toContain(`${qty} MT`);
    expect(drafts[0]?.body).toContain("PO-000001");
    expect(drafts[1]?.to).toBe("master.mv-aegean-pioneer@fleet.pharos.example");
    expect(drafts[1]?.body).toContain("Pharos has not sent it");
    // A second approve (or a retry) never adds more.
    await approveRecommendation(deps, recId, "bob");
    expect(await draftsOf(db, recId)).toHaveLength(2);
  });

  it("concurrent double approve gives one PO and one set of drafts", async () => {
    await Promise.all([
      approveRecommendation(deps, recId, "alice"),
      approveRecommendation(deps, recId, "bob"),
    ]);
    expect(await ordersOf(recId)).toHaveLength(1);
    expect(await draftsOf(db, recId)).toHaveLength(2);
    expect(erp.requests).toHaveLength(1);
  });

  it("an ERP outage stores no drafts; the retry executes with the same key and one PO", async () => {
    erp.mode = "down";
    expect((await approveRecommendation(deps, recId, "alice")).status).toBe("failed");
    expect(await draftsOf(db, recId)).toHaveLength(0);
    erp.mode = "up";
    expect((await approveRecommendation(deps, recId, "alice")).status).toBe("executed");
    expect(await ordersOf(recId)).toHaveLength(1);
    expect(new Set(erp.requests.map((r) => r.key))).toEqual(new Set([`rec-${recId}-${SEED_MS}`]));
    expect(await draftsOf(db, recId)).toHaveLength(2);
  });

  it("an unreadable plan fails before any ERP call and the recommendation is failed, not stuck", async () => {
    erp.mode = "down";
    await approveRecommendation(deps, recId, "alice"); // order written, push failed
    erp.mode = "up";
    erp.requests.length = 0;
    await db`update calculations set outputs = '{}'::jsonb where id = ${calculationId}`;
    const result = await approveRecommendation(deps, recId, "alice");
    expect(result.status).toBe("failed");
    expect(erp.requests).toHaveLength(0);
    expect(await draftsOf(db, recId)).toHaveLength(0);
    const [audit] = await db<{ detail: { error: string } }[]>`
      select detail from audit_events
      where recommendation_id = ${recId} and kind = 'recommendation.failed' order by id desc limit 1`;
    expect(audit?.detail.error).toMatch(/unreadable/);
  });

  it("an error recording the success after a successful push fails the recommendation; retry executes once", async () => {
    await db.unsafe(`
      create function pharos_test_block_drafts() returns trigger language plpgsql as
        $$ begin raise exception 'forced draft failure'; end $$;
      create trigger pharos_test_block_drafts before insert on drafted_messages
        for each row execute function pharos_test_block_drafts();`);
    try {
      const failed = await approveRecommendation(deps, recId, "alice");
      expect(failed.status).toBe("failed");
      expect(erp.requests).toHaveLength(1); // the PO exists in the ERP
      const [audit] = await db<{ detail: { error: string } }[]>`
        select detail from audit_events
        where recommendation_id = ${recId} and kind = 'recommendation.failed'`;
      expect(audit?.detail.error).toMatch(/forced draft failure/);
    } finally {
      await db.unsafe(
        "drop trigger pharos_test_block_drafts on drafted_messages; drop function pharos_test_block_drafts();",
      );
    }
    const retried = await approveRecommendation(deps, recId, "alice");
    expect(retried).toMatchObject({ status: "executed", erpPoNumber: "PO-000001" });
    expect(await ordersOf(recId)).toHaveLength(1);
    expect(new Set(erp.requests.map((r) => r.key))).toEqual(new Set([`rec-${recId}-${SEED_MS}`]));
    expect(await draftsOf(db, recId)).toHaveLength(2);
  });

  it("reject is final", async () => {
    const rejected = DecisionResult.parse(await rejectRecommendation(deps, recId, "carol"));
    expect(rejected).toEqual({
      recommendationId: recId,
      status: "rejected",
      orderId: null,
      erpPoNumber: null,
      erpSyncStatus: null,
      instructionId: null,
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

  /** Aegean Pioneer's route plan, made in a conversation of its own: its id and facts. */
  const planRoute = async () => {
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const out = await planRouteSpeedFacts(ctx, { vessel: "Aegean Pioneer" });
    const id = (out.data as { calculationId: number }).calculationId;
    // A fact of the plan, by its path (the fuel-blind best route).
    const cite =
      out.facts.find(
        (f) => f.provenance.source === "calculation" && f.provenance.path === "bestCandidateId",
      )?.id ?? "";
    const propose = async (type: "voyage_instruction" | "purchase_order", optionId: string) =>
      (
        (
          await proposeAction(ctx, {
            type,
            calculationId: id,
            optionId,
            factRefs: [cite],
            rationale: "The plan that keeps the fuel margin and meets the berth window.",
          })
        ).data as { recommendationId: number }
      ).recommendationId;
    return { id, propose };
  };

  /** A route calculation's stop plan and its stop candidate (the stop's route, port and quote). */
  const storedStop = async (calcId: number, optionId: string) => {
    const [calc] = await db<{ inputs: unknown; outputs: unknown; voyage_id: number }[]>`
      select inputs, outputs, voyage_id from calculations where id = ${calcId}`;
    const result = RouteSpeedResult.parse(calc?.outputs);
    const inputs = z
      .object({ destination: z.string(), optimiser: z.object({ stops: z.array(StopCandidate) }) })
      .parse(calc?.inputs);
    const plan = result.stopPlans.find((s) => s.optionId === optionId);
    const candidate = inputs.optimiser.stops.find((s) => s.optionId === optionId);
    if (!plan?.stop || !candidate) throw new Error(`no stop plan ${optionId}`);
    return {
      plan,
      timeline: plan.stop,
      candidate,
      destination: inputs.destination,
      voyageId: calc?.voyage_id,
    };
  };

  it("orders from a route plan's stop with the quote's price", async () => {
    const route = await planRoute();
    const id = await route.propose("purchase_order", "MTMLA-kestrel");
    const result = DecisionResult.parse(await approveRecommendation(deps, id, "alice"));
    expect(result).toMatchObject({
      status: "executed",
      erpSyncStatus: "synced",
      instructionId: null,
    });

    // Quantity from the stored stop plan; price, currency and barge fee from its quote.
    const { plan } = await storedStop(route.id, "MTMLA-kestrel");
    const [quote] = await db<{ currency: string; barge_fee: number; price_per_mt: number }[]>`
      select q.currency, q.barge_fee, l.price_per_mt
      from quotes q join quote_lines l on l.quote_id = q.id where q.id = ${kestrelQuoteId}`;
    const orders = await ordersOf(id);
    expect(orders).toMatchObject([{ quote_id: kestrelQuoteId, status: "confirmed" }]);
    const lines = await db`
      select grade, qty_mt, price_per_mt from order_lines where order_id = ${orders[0]?.id ?? 0}`;
    expect(lines).toEqual([
      { grade: "LSMGO", qty_mt: plan.qtyMt, price_per_mt: quote?.price_per_mt },
    ]);
    expect(erp.requests[0]?.body).toMatchObject({
      port: "MTMLA",
      currency: quote?.currency,
      bargeFee: quote?.barge_fee,
      lines: [{ grade: "LSMGO", qtyMt: plan.qtyMt, pricePerMt: quote?.price_per_mt }],
    });
    expect(await quoteStatus(kestrelQuoteId)).toBe("ordered");
    const [req] = await db<{ status: string }[]>`
      select r.status from bunker_requirements r join quotes q on q.requirement_id = r.id
      where q.id = ${kestrelQuoteId}`;
    expect(req?.status).toBe("ordered");
    const master = (await draftsOf(db, id)).find((d) => d.kind === "master_instruction");
    expect(master?.body).toMatch(/Planned fuel cost: [\d,.]+ USD; barge fee: [\d,.]+ USD/);
  });

  describe("voyage instructions", () => {
    let viId: number;
    let routeCalcId: number;

    beforeEach(async () => {
      const route = await planRoute();
      routeCalcId = route.id;
      viId = await route.propose("voyage_instruction", "MTMLA-kestrel");
    });

    /** Approves the purchase order the Marsaxlokk stop needs (the outer Kestrel proposal). */
    const approveOrder = async () => {
      expect((await approveRecommendation(deps, recId, "olga")).status).toBe("executed");
    };
    const instructionsOf = (id: number) =>
      db<
        {
          voyage_id: number;
          calculation_id: number;
          candidate_id: string;
          speed_kn: number;
          eta: Date | string;
          points: unknown;
          stop_port_id: number | null;
          stop_quote_id: number | null;
          stop_arrive_at: Date | string | null;
          stop_depart_at: Date | string | null;
          stop_qty_mt: number | null;
        }[]
      >`select voyage_id, calculation_id, candidate_id, speed_kn, eta, points, stop_port_id,
               stop_quote_id, stop_arrive_at, stop_depart_at, stop_qty_mt
        from voyage_instructions where recommendation_id = ${id} order by id`;
    const orderCount = async () =>
      (await db<{ n: number }[]>`select count(*)::int as n from purchase_orders`)[0]?.n ?? 0;
    const isoOf = (v: Date | string | null | undefined) =>
      v == null ? null : new Date(v).toISOString();

    it("refuses to approve an instruction before its order is approved", async () => {
      const err = await approveRecommendation(deps, viId, "alice").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DecisionError);
      expect((err as DecisionError).code).toBe("dependency_unmet");
      expect((err as DecisionError).message).toContain(
        `needs an approved purchase order for Kestrel Marine Fuels at Marsaxlokk before it can be approved; proposal ${recId} is pending`,
      );
      expect((await recommendation(viId))?.status).toBe("pending");
      expect(await instructionsOf(viId)).toHaveLength(0);
      expect(await auditKinds(viId)).toEqual([]);

      // Once the order is rejected, the reason names the rejected proposal.
      await rejectRecommendation(deps, recId, "carol");
      const none = await approveRecommendation(deps, viId, "alice").catch((e: unknown) => e);
      expect((none as DecisionError).code).toBe("dependency_unmet");
      expect((none as DecisionError).message).toContain(`proposal ${recId} is rejected`);
      expect((await recommendation(viId))?.status).toBe("pending");
    });

    it("approves it once the order is approved and records the stop", async () => {
      await approveOrder();
      const pushes = erp.requests.length;
      const orders = await orderCount();
      const [speedBefore] = await db<{ planned_speed_kn: number }[]>`
        select planned_speed_kn from voyages where voyage_no = ${DEMO_SCENARIO.voyageNo}`;

      const result = DecisionResult.parse(await approveRecommendation(deps, viId, "alice"));
      const [instruction] = await db<{ id: number }[]>`
        select id from voyage_instructions where recommendation_id = ${viId}`;
      expect(result).toEqual({
        recommendationId: viId,
        status: "executed",
        orderId: null,
        erpPoNumber: null,
        erpSyncStatus: null,
        instructionId: instruction?.id,
      });

      const { plan, timeline, candidate, destination, voyageId } = await storedStop(
        routeCalcId,
        "MTMLA-kestrel",
      );
      const [port] = await db<{ id: number }[]>`select id from ports where unlocode = 'MTMLA'`;
      const rows = await instructionsOf(viId);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect({
        ...row,
        eta: isoOf(row?.eta),
        stop_arrive_at: isoOf(row?.stop_arrive_at),
        stop_depart_at: isoOf(row?.stop_depart_at),
      }).toEqual({
        voyage_id: voyageId,
        calculation_id: routeCalcId,
        candidate_id: "MTMLA-kestrel",
        speed_kn: plan.speedKn,
        eta: isoOf(plan.eta),
        points: candidate.points,
        stop_port_id: port?.id,
        stop_quote_id: kestrelQuoteId,
        stop_arrive_at: isoOf(timeline.arriveAt),
        stop_depart_at: isoOf(timeline.departAt),
        stop_qty_mt: plan.qtyMt,
      });
      // The audit trail names the order that satisfied the dependency.
      const [approved] = await db<{ detail: unknown }[]>`
        select detail from audit_events
        where recommendation_id = ${viId} and kind = 'recommendation.approved'`;
      expect(approved?.detail).toEqual({ dependsOnRecommendationId: recId });

      const drafts = await draftsOf(db, viId);
      expect(drafts.map((d) => [d.kind, d.status])).toEqual([["master_instruction", "draft"]]);
      const draft = drafts[0];
      expect(draft?.to).toBe("master.mv-aegean-pioneer@fleet.pharos.example");
      expect(draft?.subject).toBe(
        `Route and speed: MV Aegean Pioneer to ${destination}, bunkering at Marsaxlokk`,
      );
      expect(draft?.body).toMatch(
        /Call at Marsaxlokk for bunkers: arrive .+ UTC, depart .+ UTC, 300 t LSMGO from Kestrel Marine Fuels\./,
      );
      expect(draft?.body).toMatch(/planning-grade advice/);
      // Every number in the draft is the approved plan's speed, distance, ETA, stop times or quantity.
      const numbers = `${draft?.subject}\n${draft?.body}`.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
      expect(numbers.length).toBeGreaterThan(0);
      for (const n of numbers) {
        const value = Number(n.replace(/,/g, ""));
        const fromCalc =
          [plan.eta, timeline.arriveAt, timeline.departAt].some((t) => t.includes(n)) ||
          [plan.speedKn, plan.distanceNm, plan.qtyMt].some((v) => Math.abs(v - value) <= 0.005);
        expect(fromCalc, `draft number ${n}`).toBe(true);
      }

      expect(erp.requests).toHaveLength(pushes);
      expect(await ordersOf(viId)).toHaveLength(0);
      expect(await orderCount()).toBe(orders);
      // Recorded, not applied: the voyage keeps its planned speed (ruling P5).
      const [speedAfter] = await db<{ planned_speed_kn: number }[]>`
        select planned_speed_kn from voyages where voyage_no = ${DEMO_SCENARIO.voyageNo}`;
      expect(speedAfter).toEqual(speedBefore);
      expect(await auditKinds(viId)).toEqual([
        "recommendation.approved",
        "voyage.instructed",
        "drafts.created",
        "recommendation.executed",
      ]);
      expect((await recommendation(viId))?.decided_by).toBe("alice");
    });

    it("a concurrent double approve gives one instruction row and one draft", async () => {
      await approveOrder();
      const pushes = erp.requests.length;
      const results = await Promise.all([
        approveRecommendation(deps, viId, "alice"),
        approveRecommendation(deps, viId, "bob"),
      ]);
      expect(results.map((r) => r.status)).toContain("executed");
      expect(await instructionsOf(viId)).toHaveLength(1);
      expect(await draftsOf(db, viId)).toHaveLength(1);
      const kinds = await auditKinds(viId);
      expect(kinds.filter((k) => k === "recommendation.approved")).toHaveLength(1);
      expect(kinds.filter((k) => k === "voyage.instructed")).toHaveLength(1);
      expect(kinds.filter((k) => k === "recommendation.executed")).toHaveLength(1);
      expect(erp.requests).toHaveLength(pushes);
    });

    it("a reject records no instruction and drafts nothing, with or without its order", async () => {
      const rejected = await rejectRecommendation(deps, viId, "carol");
      expect(rejected.status).toBe("rejected");
      expect(await instructionsOf(viId)).toHaveLength(0);
      expect(await draftsOf(db, viId)).toHaveLength(0);
      expect(await auditKinds(viId)).toEqual(["recommendation.rejected"]);
    });

    it("a failure while drafting leaves it failed; approving again retries and executes once", async () => {
      await approveOrder();
      const pushes = erp.requests.length;
      await db.unsafe(`
        create function pharos_test_block_drafts() returns trigger language plpgsql as
          $$ begin raise exception 'forced draft failure'; end $$;
        create trigger pharos_test_block_drafts before insert on drafted_messages
          for each row execute function pharos_test_block_drafts();`);
      try {
        expect((await approveRecommendation(deps, viId, "alice")).status).toBe("failed");
      } finally {
        await db.unsafe(
          "drop trigger pharos_test_block_drafts on drafted_messages; drop function pharos_test_block_drafts();",
        );
      }
      expect(await instructionsOf(viId)).toHaveLength(1);
      expect(await draftsOf(db, viId)).toHaveLength(0);
      expect((await approveRecommendation(deps, viId, "bob")).status).toBe("executed");
      expect(await instructionsOf(viId)).toHaveLength(1);
      expect(await draftsOf(db, viId)).toHaveLength(1);
      expect(await auditKinds(viId)).toEqual([
        "recommendation.approved",
        "voyage.instructed",
        "recommendation.failed",
        "recommendation.retried",
        "drafts.created",
        "recommendation.executed",
      ]);
      expect(erp.requests).toHaveLength(pushes);
    });

    it("a route plan with no voyage of ours (a ship seen on AIS) cannot be executed", async () => {
      await db`update calculations set voyage_id = null where id = ${routeCalcId}`;
      const err = await approveRecommendation(deps, viId, "alice").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DecisionError);
      expect((err as DecisionError).code).toBe("not_executable");
      expect((await recommendation(viId))?.status).toBe("pending");
      expect(await instructionsOf(viId)).toHaveLength(0);
      expect(await auditKinds(viId)).toEqual([]);
    });
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
