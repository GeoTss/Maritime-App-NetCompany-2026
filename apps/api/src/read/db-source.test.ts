import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_WORLD_SEED,
  DEMO_SCENARIO,
  generateWorld,
  type Sql,
  seedDatabase,
} from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import {
  insertWeatherSnapshot,
  latestWeatherSnapshot,
  loadRecordedSources,
} from "@pharos/integrations";
import {
  BunkerPlan,
  BunkerPlanView,
  type Fact,
  InboxItem,
  InboxItemDetail,
  listOf,
  QuoteView,
  RecommendationView,
  RoutePlanView,
  RouteSpeedResult,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
} from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createErpApp } from "../../../../services/erp-sim/src/app.js";
import type { Extractor } from "../ai/extract.js";
import { createToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { proposeAction } from "../ai/tools/propose-action.js";
import { planRouteSpeedFacts } from "../ai/tools/route-speed.js";
import { getVesselStatus } from "../ai/tools/vessel-status.js";
import { createApp } from "../app.js";
import { createClock } from "../clock.js";
import { createErpClient } from "../executor/erp-client.js";
import { approveRecommendation } from "../executor/execute.js";
import { DEMO_INBOX_DIR } from "../inbox/routes.js";
import { type IngestDeps, ingestRaw, processDocument } from "../ingest/workflow.js";
import { routePlanFacts } from "../routing/facts.js";
import { planRouteSpeed } from "../routing/plan.js";
import { createDbSource } from "./db-source.js";
import {
  buildDemoEmails,
  createFixtureSource,
  demoExtraction,
  FIXTURE_ANCHOR,
} from "./fixtures.js";

const NOW = new Date("2026-11-14T08:05:00.000Z");

const sql = await connectTestDb("db_source");

if (!sql) {
  describe("createDbSource (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("db_source")}`, () => {});
  });
}

describe.skipIf(!sql)("createDbSource (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const world = generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR });
  const kestrel = buildDemoEmails(world).find((e) => e.option.supplierKey === "kestrel");
  const extractor: Extractor = {
    model: "claude-haiku-5-5",
    promptVersion: "extract-quote/v1",
    async extract() {
      if (!kestrel) throw new Error("no kestrel demo email");
      return { output: demoExtraction(world, kestrel), metrics: [] };
    },
  };
  const ingest: IngestDeps = { sql: db, extractor, now: () => NOW };
  const app = createApp({
    llmMode: "replay",
    clock: createClock(FIXTURE_ANCHOR),
    pingDb: async () => true,
    read: createDbSource(db, () => NOW),
  });
  const fixtures = createApp({
    llmMode: "replay",
    clock: createClock(FIXTURE_ANCHOR),
    pingDb: async () => true,
    read: createFixtureSource(),
  });

  let kestrelDocId: number;
  let pendingDocId: number;
  let recId: number;
  /** A purchase order proposed from the route plan's stop (set in the instruction view block). */
  let routeOrderId: number;
  let calculationId: number;
  /** The facts plan_bunkering returned for `calculationId`. */
  let bunkerToolFacts: Fact[];

  beforeAll(async () => {
    await seedDatabase(db, { seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
    const raw = (name: string) =>
      readFile(join(DEMO_INBOX_DIR, name)).then((b) => new Uint8Array(b));
    kestrelDocId = (await ingestRaw(ingest, await raw("01-kestrel-marsaxlokk.eml"), "demo_inbox"))
      .documentId;
    await processDocument(ingest, kestrelDocId);
    // Stored but not processed: its extraction is still running as far as the inbox can tell.
    pendingDocId = (await ingestRaw(ingest, await raw("02-straitline-gibraltar.eml"), "demo_inbox"))
      .documentId;

    const ctx = createToolContext({ sql: db, now: () => NOW });
    const planned = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    calculationId = (planned.data as { calculationId: number }).calculationId;
    bunkerToolFacts = planned.facts;
    const best = planned.facts.find((f) => f.id.endsWith("_bestOptionId"));
    const proposed = await proposeAction(ctx, {
      type: "purchase_order",
      calculationId,
      optionId: "MTMLA-kestrel",
      factRefs: [best?.id ?? ""],
      rationale: "Lowest total delivered cost.",
    });
    recId = (proposed.data as { recommendationId: number }).recommendationId;
  });
  afterAll(async () => {
    await db.end();
  });

  async function get(target: typeof app, path: string) {
    const res = await target.request(path);
    return { res, body: (await res.json()) as unknown };
  }

  it("returns the 8 seeded vessels, built exactly as the fixture source builds them", async () => {
    const { items } = listOf(VesselSummary).parse((await get(app, "/api/vessels")).body);
    expect(items).toHaveLength(8);
    expect(items).toEqual(
      listOf(VesselSummary).parse((await get(fixtures, "/api/vessels")).body).items,
    );
    const pioneer = items.find((v) => v.name === "MV Aegean Pioneer");
    expect(pioneer?.alerts).toContain("lsmgo_runs_out");
    const detail = VesselDetail.parse((await get(app, `/api/vessels/${pioneer?.id}`)).body);
    expect(detail).toEqual((await get(fixtures, `/api/vessels/${pioneer?.id}`)).body);
  });

  it("draws fuel on board along the current plan; the panel and the alert agree with get_vessel_status", async () => {
    const { items } = listOf(VesselSummary).parse((await get(app, "/api/vessels")).body);
    const pioneer = items.find((v) => v.name === "MV Aegean Pioneer");
    const detail = VesselDetail.parse((await get(app, `/api/vessels/${pioneer?.id}`)).body);
    const status = await getVesselStatus(createToolContext({ sql: db, now: () => NOW }), {
      vessel: "Aegean Pioneer",
    });
    // The alert and the tool read the one fuel calculation: LSMGO runs out on the current plan.
    expect(pioneer?.alerts).toEqual(["lsmgo_runs_out"]);
    expect(status.data).toMatchObject({ gradesRunningOut: ["LSMGO"] });
    // The panel draws that same calculation: its numbers are the tool's cited facts.
    const cited = (label: string) => status.facts.find((f) => f.label === label)?.value;
    const lsmgo = detail.fuelTrack?.grades.LSMGO;
    expect(lsmgo?.shortfallMt).toBeGreaterThan(0);
    expect(lsmgo?.shortfallMt).toBe(cited("LSMGO shortfall to keep the margin"));
    expect(lsmgo?.marginMt).toBe(cited("LSMGO safety margin to keep on arrival"));
    expect(lsmgo?.belowMarginAt?.nm).toBe(
      cited("LSMGO drops below its safety margin, distance along the current plan"),
    );
    expect(lsmgo?.runsDryAt?.nm).toBe(cited("LSMGO runs out, distance along the current plan"));
  });

  it("returns the seeded voyages with their detail", async () => {
    const { items } = listOf(VoyageSummary).parse((await get(app, "/api/voyages")).body);
    expect(items).toEqual(
      listOf(VoyageSummary).parse((await get(fixtures, "/api/voyages")).body).items,
    );
    const first = items[0];
    const detail = VoyageDetail.parse((await get(app, `/api/voyages/${first?.id}`)).body);
    expect(detail.portCalls.length).toBeGreaterThan(0);
  });

  it("returns the ingested quote with its document, next to the seeded history", async () => {
    const { items } = listOf(QuoteView).parse((await get(app, "/api/quotes")).body);
    const ingested = items.find((q) => q.documentId === kestrelDocId);
    expect(ingested).toMatchObject({
      supplierName: "Kestrel Marine Fuels",
      portName: "Marsaxlokk",
      currency: kestrel?.option.currency,
      bargeFee: kestrel?.option.bargeFee,
      status: "received",
      validUntil: null,
      lines: [
        { grade: "LSMGO", qtyMt: kestrel?.option.qtyMt, pricePerMt: kestrel?.option.pricePerMt },
      ],
    });
    // Newest first; the seeded history (two ordered, two expired) has no document.
    expect(items[0]?.id).toBe(ingested?.id);
    expect(
      items
        .filter((q) => q.documentId === null)
        .map((q) => q.status)
        .sort(),
    ).toEqual(["expired", "expired", "ordered", "ordered"]);
    const detail = QuoteView.parse((await get(app, `/api/quotes/${ingested?.id}`)).body);
    expect(detail).toEqual(ingested);
  });

  it("lists inbox documents newest first, pending while extraction runs", async () => {
    const { items } = listOf(InboxItem).parse((await get(app, "/api/inbox")).body);
    expect(items.map((i) => [i.documentId, i.extractionStatus])).toEqual([
      [pendingDocId, "pending"],
      [kestrelDocId, "extracted"],
    ]);
    expect(items[1]).toMatchObject({ kind: "email", subject: kestrel?.subject });
  });

  it("returns an inbox item's body, extraction and checks", async () => {
    const detail = InboxItemDetail.parse((await get(app, `/api/inbox/${kestrelDocId}`)).body);
    expect(detail.bodyText).toContain("Marsaxlokk");
    expect(detail.extraction?.kind).toBe("quote");
    expect(detail.checkResults.length).toBeGreaterThan(0);
    expect(detail.checkResults.every((c) => c.passed)).toBe(true);
    const pending = InboxItemDetail.parse((await get(app, `/api/inbox/${pendingDocId}`)).body);
    expect(pending.extraction).toBeNull();
    expect(pending.checkResults).toEqual([]);
    expect(detail.error).toBeNull();
    expect(pending.error).toBeNull();
    // The id is the latest extraction's, the same row the other fields come from.
    const [latest] = await db<{ id: number }[]>`
      select id from extractions where document_id = ${kestrelDocId} order by id desc limit 1`;
    expect(detail.extractionId).toBe(latest?.id);
    expect(pending.extractionId).toBeGreaterThan(0);
    expect(pending.extractionId).not.toBe(detail.extractionId);
  });

  it("returns a null extractionId for a document with no extraction", async () => {
    const [doc] = await db<{ id: number }[]>`
      insert into documents (kind, source, sha256, sender, subject, body_text, received_at,
                             has_unreadable_attachment)
      values ('email', 'test', 'no-extraction-sha', 'a@b.test', 'bare', 'body', ${NOW.toISOString()}::timestamptz, false)
      returning id`;
    try {
      const bare = InboxItemDetail.parse((await get(app, `/api/inbox/${doc?.id}`)).body);
      expect(bare).toMatchObject({ extractionId: null, extraction: null, error: null });
    } finally {
      await db`delete from documents where id = ${doc?.id ?? 0}`;
    }
  });

  it("returns the stored error of a failed extraction", async () => {
    await db`update extractions set status = 'failed', error = 'model refused' where document_id = ${pendingDocId}`;
    try {
      const failed = InboxItemDetail.parse((await get(app, `/api/inbox/${pendingDocId}`)).body);
      expect(failed).toMatchObject({ extractionStatus: "failed", error: "model refused" });
    } finally {
      await db`update extractions set status = 'pending', error = null where document_id = ${pendingDocId}`;
    }
  });

  it("returns the recommendation with facts re-derived from its calculation", async () => {
    const { items } = listOf(RecommendationView).parse(
      (await get(app, "/api/recommendations")).body,
    );
    expect(items).toHaveLength(1);
    const rec = items[0];
    const [calc] = await db<{ outputs: unknown }[]>`
      select outputs from calculations where id = ${calculationId}`;
    const plan = BunkerPlan.parse(calc?.outputs);
    const index = plan.options.findIndex((o) => o.optionId === "MTMLA-kestrel");
    const option = plan.options[index];
    expect(rec).toMatchObject({
      id: recId,
      type: "purchase_order",
      status: "pending",
      calculationId,
      optionId: "MTMLA-kestrel",
      expectedSavingUsd: plan.savingVsCheapestHeadlineUsd,
      // Proposed straight through the tool, not by an ask; not approved yet.
      gatePassed: null,
      order: null,
    });
    expect(rec?.summary).toContain("Kestrel Marine Fuels");
    expect(rec?.summary).toContain("Marsaxlokk");
    for (const f of rec?.facts ?? []) {
      expect(f.provenance).toMatchObject({ source: "calculation", calculationId });
    }
    const byPath = new Map(
      rec?.facts.map((f) => [f.provenance.source === "calculation" ? f.provenance.path : "", f]),
    );
    expect(byPath.get(`options[${index}].qtyMt`)?.value).toBe(option?.qtyMt);
    expect(byPath.get(`options[${index}].totalCostUsd`)?.value).toBe(option?.totalCostUsd);
    expect(byPath.get(`options[${index}].headlinePriceUsdPerMt`)?.value).toBe(
      option?.headlinePriceUsdPerMt,
    );
    expect(byPath.get(`options[${index}].fuelEuCostUsd`)).toMatchObject({
      // The tool's label: one fact id, one Fact.
      label: "MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): FuelEU exposure",
      value: option?.fuelEuCostUsd,
      unit: "USD",
    });
    // The same fact ids the agent cited, so stored factRefs resolve.
    const ids = new Set(rec?.facts.map((f) => f.id));
    for (const ref of rec?.factRefs ?? []) expect(ids.has(ref)).toBe(true);
    const detail = RecommendationView.parse((await get(app, `/api/recommendations/${recId}`)).body);
    expect(detail).toEqual(rec);
  });

  it("recommendation names its option", async () => {
    const rec = RecommendationView.parse((await get(app, `/api/recommendations/${recId}`)).body);
    expect(rec.optionLabel).toBe("Kestrel Marine Fuels at Marsaxlokk");
    expect(rec.expectedSavingUsd).not.toBeNull();
    expect(rec.expectedSaving?.value).toBe(rec.expectedSavingUsd);
    // The plan's saving fact, one of the view's own facts.
    expect(rec.expectedSaving).toEqual(
      rec.facts.find(
        (f) =>
          f.provenance.source === "calculation" &&
          f.provenance.path === "savingVsCheapestHeadlineUsd",
      ),
    );
  });

  it.each([
    "vessels",
    "voyages",
    "inbox",
    "quotes",
    "recommendations",
    "bunker-plans",
    "route-plans",
  ])("404s on an unknown /api/%s id", async (path) => {
    const { res, body } = await get(app, `/api/${path}/999999`);
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });

  // Runs last: approves the first recommendation and adds a second one.
  describe("gate origin and order state", () => {
    let withheldRecId: number;

    /** What runAgent stores for an answer: its assistant message, linked from the proposals. */
    const attachAnswer = async (id: number, gate: { passed: boolean; repaired: boolean }) => {
      const [conv] = await db<{ id: number }[]>`
        insert into conversations (title, created_at)
        values ('Where should Aegean Pioneer bunker?', ${NOW.toISOString()}::timestamptz)
        returning id`;
      const content = {
        answer: gate.passed ? "Bunker at Marsaxlokk." : null,
        gate: { ...gate, ungroundedNumbers: gate.passed ? [] : ["8,000"] },
      };
      const [msg] = await db<{ id: number }[]>`
        insert into messages (conversation_id, role, content, created_at)
        values (${conv?.id ?? 0}, 'assistant', ${JSON.stringify(content)}::jsonb,
                ${NOW.toISOString()}::timestamptz)
        returning id`;
      await db`update recommendations set message_id = ${msg?.id ?? 0} where id = ${id}`;
    };

    beforeAll(async () => {
      // A second proposal (a fresh plan), made in an answer the release gate withheld.
      const ctx = createToolContext({ sql: db, now: () => NOW });
      const planned = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
      const best = planned.facts.find((f) => f.id.endsWith("_bestOptionId"));
      const proposed = await proposeAction(ctx, {
        type: "purchase_order",
        calculationId: (planned.data as { calculationId: number }).calculationId,
        optionId: "MTMLA-kestrel",
        factRefs: [best?.id ?? ""],
        rationale: "Lowest total delivered cost.",
      });
      withheldRecId = (proposed.data as { recommendationId: number }).recommendationId;
      await attachAnswer(withheldRecId, { passed: false, repaired: true });

      // The first proposal, from an answer that passed, approved and pushed to the ERP.
      await attachAnswer(recId, { passed: true, repaired: false });
      const erpApp = createErpApp({ now: () => NOW });
      await approveRecommendation(
        {
          sql: db,
          erp: createErpClient("http://erp.test", (input, init) => erpApp.request(input, init)),
          now: () => NOW,
        },
        recId,
        "alice",
      );
    });

    it("shows a recommendation from a withheld answer as gatePassed false, still pending", async () => {
      const rec = RecommendationView.parse(
        (await get(app, `/api/recommendations/${withheldRecId}`)).body,
      );
      expect(rec).toMatchObject({
        status: "pending",
        gatePassed: false,
        order: null,
        instruction: null,
      });
      const { items } = listOf(RecommendationView).parse(
        (await get(app, "/api/recommendations")).body,
      );
      expect(items.map((r) => r.id)).toEqual([withheldRecId, recId]);
    });

    it("shows an executed recommendation with its order and PO number", async () => {
      const [order] = await db<{ id: number }[]>`
        select id from purchase_orders where recommendation_id = ${recId}`;
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${recId}`)).body);
      expect(rec).toMatchObject({
        status: "executed",
        gatePassed: true,
        order: { orderId: order?.id, erpPoNumber: "PO-000001", erpSyncStatus: "synced" },
        instruction: null,
      });
    });
  });

  // Runs after the purchase-order blocks (Kestrel's order is executed): adds a voyage instruction
  // on the recommended plan's bunker stop, and a purchase order proposed from that stop.
  describe("voyage instruction view", () => {
    let viId: number;
    let routeCalcId: number;
    let toolFacts: Map<string, Fact>;
    let cited: string[];

    beforeAll(async () => {
      const ctx = createToolContext({ sql: db, now: () => NOW });
      const out = await planRouteSpeedFacts(ctx, { vessel: "Aegean Pioneer" });
      routeCalcId = (out.data as { calculationId: number }).calculationId;
      toolFacts = new Map(out.facts.map((f) => [f.id, f]));
      const at = (path: string) =>
        out.facts.find((f) => f.provenance.source === "calculation" && f.provenance.path === path)
          ?.id ?? "";
      cited = [
        at("plan.optionId"),
        at("stopPlans[0].speedKn"),
        at("stopPlans[0].stop.arriveAt"),
        at("stopPlans[0].qtyMt"),
      ];
      const propose = async (type: "voyage_instruction" | "purchase_order") =>
        (
          (
            await proposeAction(ctx, {
              type,
              calculationId: routeCalcId,
              optionId: "MTMLA-kestrel",
              factRefs: cited,
              rationale: "The plan that keeps the fuel margin and meets the berth window.",
            })
          ).data as { recommendationId: number }
        ).recommendationId;
      viId = await propose("voyage_instruction");
      routeOrderId = await propose("purchase_order");
    });

    it("shows the bunker-stop plan with its stop facts, under the ids the agent cited", async () => {
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${viId}`)).body);
      const result = RouteSpeedResult.parse(
        (
          await db<
            { outputs: unknown }[]
          >`select outputs from calculations where id = ${routeCalcId}`
        )[0]?.outputs,
      );
      // Kestrel's approved order fixes the stop: the one stop plan is the recommended plan.
      expect(result.plan?.optionId).toBe("MTMLA-kestrel");
      const index = result.stopPlans.findIndex((s) => s.optionId === "MTMLA-kestrel");
      expect(rec).toMatchObject({
        type: "voyage_instruction",
        status: "pending",
        calculationId: routeCalcId,
        optionId: "MTMLA-kestrel",
        optionLabel: "Bunker stop at Marsaxlokk (Kestrel Marine Fuels)",
        summary:
          "Instruct MV Aegean Pioneer to Rotterdam with a bunker stop at Marsaxlokk (Kestrel Marine Fuels).",
        expectedSavingUsd: null,
        expectedSaving: null,
        order: null,
        instruction: null,
        bunkerPlan: null,
      });
      const paths = rec.facts.map((f) =>
        f.provenance.source === "calculation" ? f.provenance.path : "",
      );
      expect(paths).toContain(`stopPlans[${index}].qtyMt`);
      expect(paths).toContain("plan.optionId");
      // Only this stop plan's and the recommended plan's facts, each as plan_route_speed returned it.
      for (const [i, f] of rec.facts.entries()) {
        expect(toolFacts.get(f.id)).toEqual(f);
        expect(paths[i]?.startsWith("options[")).toBe(false);
      }
      const ids = new Set(rec.facts.map((f) => f.id));
      for (const ref of rec.factRefs) expect(ids.has(ref)).toBe(true);
    });

    it("depends on the executed purchase order for its stop's quote", async () => {
      const [quote] = await db<{ id: number }[]>`
        select q.id from quotes q join purchase_orders po on po.quote_id = q.id
        where po.recommendation_id = ${recId}`;
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${viId}`)).body);
      expect(rec.dependsOn).toEqual({
        quoteId: quote?.id,
        optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
        recommendationId: recId,
        status: "executed",
        satisfied: true,
      });
      const { items } = listOf(RecommendationView).parse(
        (await get(app, "/api/recommendations")).body,
      );
      for (const r of items.filter((x) => x.type === "purchase_order")) {
        expect(r.dependsOn).toBeNull();
      }
    });

    it("names a purchase order proposed from the route plan's stop like a bunker plan's", async () => {
      const rec = RecommendationView.parse(
        (await get(app, `/api/recommendations/${routeOrderId}`)).body,
      );
      expect(rec).toMatchObject({
        type: "purchase_order",
        optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
        summary: `Order LSMGO for the ${DEMO_SCENARIO.voyageNo} stem from Kestrel Marine Fuels at Marsaxlokk.`,
        bunkerPlan: null,
        dependsOn: null,
      });
      expect(rec.facts.length).toBeGreaterThan(0);
    });

    it("serves the recorded instruction with its stop once approved", async () => {
      const erpApp = createErpApp({ now: () => NOW });
      const decision = await approveRecommendation(
        {
          sql: db,
          erp: createErpClient("http://erp.test", (input, init) => erpApp.request(input, init)),
          now: () => NOW,
        },
        viId,
        "alice",
      );
      const [row] = await db<
        {
          id: number;
          candidate_id: string;
          speed_kn: number;
          eta: Date;
          stop_quote_id: number;
          stop_arrive_at: Date;
          stop_depart_at: Date;
          stop_qty_mt: number;
        }[]
      >`
        select id, candidate_id, speed_kn, eta, stop_quote_id, stop_arrive_at, stop_depart_at,
               stop_qty_mt
        from voyage_instructions where recommendation_id = ${viId}`;
      if (!row) throw new Error("no instruction recorded");
      expect(decision.instructionId).toBe(row.id);
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${viId}`)).body);
      expect(rec).toMatchObject({
        status: "executed",
        order: null,
        instruction: {
          instructionId: row.id,
          candidateId: "MTMLA-kestrel",
          speedKn: row.speed_kn,
          eta: new Date(row.eta).toISOString(),
          stop: {
            unlocode: "MTMLA",
            portName: "Marsaxlokk",
            arriveAt: new Date(row.stop_arrive_at).toISOString(),
            departAt: new Date(row.stop_depart_at).toISOString(),
            qtyMt: row.stop_qty_mt,
            quoteId: row.stop_quote_id,
          },
        },
      });
      const { items } = listOf(RecommendationView).parse(
        (await get(app, "/api/recommendations")).body,
      );
      expect(items.find((r) => r.id === viId)?.instruction?.instructionId).toBe(row.id);
      expect(items.filter((r) => r.type === "purchase_order").map((r) => r.instruction)).toEqual(
        items.filter((r) => r.type === "purchase_order").map(() => null),
      );
    });
  });

  // Runs last: loads the recorded weather snapshot, AIS capture and synthetic hazard, so a route
  // plan cites a forecast and goes round a hazard.
  describe("stored plan views", () => {
    const source = createDbSource(db, () => NOW);
    const deps = { sql: db, now: () => NOW };

    beforeAll(async () => {
      await loadRecordedSources(db, { anchor: FIXTURE_ANCHOR });
    });

    it("serves a stored bunker plan with its voyage, its ports and the facts plan_bunkering returned", async () => {
      const { res, body } = await get(app, `/api/bunker-plans/${calculationId}`);
      expect(res.status).toBe(200);
      const plan = BunkerPlanView.parse(body);
      const [voyage] = await db<{ vessel_id: number; voyage_no: string }[]>`
        select vo.vessel_id, vo.voyage_no
        from calculations c join voyages vo on vo.id = c.voyage_id
        where c.id = ${calculationId}`;
      expect(plan).toMatchObject({
        calculationId,
        grade: DEMO_SCENARIO.requirement.grade,
        vesselId: voyage?.vessel_id,
        voyageNo: voyage?.voyage_no,
      });
      expect(plan.voyageNo).toBe(DEMO_SCENARIO.voyageNo);
      expect(plan.options[0]?.best).toBe(true);
      const ports = await db<
        { id: number; name: string; unlocode: string; lat: number; lon: number }[]
      >`select id, name, unlocode, lat, lon from ports`;
      for (const o of plan.options) {
        const p = ports.find((x) => x.id === o.port.id);
        expect(o.port).toEqual({
          id: p?.id,
          name: p?.name,
          unlocode: p?.unlocode,
          position: { lat: p?.lat, lon: p?.lon },
        });
      }
      // Every row the tool returned is the tool's own fact; only the effective price is the view's.
      const tool = new Map(bunkerToolFacts.map((f) => [f.id, f]));
      const rows = plan.options.flatMap((o) => o.rows);
      expect(rows.filter((r) => !tool.has(r.fact.id)).map((r) => r.name)).toEqual(
        plan.options.map(() => "effective price (total cost per mt)"),
      );
      for (const r of rows.filter((x) => tool.has(x.fact.id))) {
        expect(r.fact).toEqual(tool.get(r.fact.id));
      }
      expect(await source.getBunkerPlan(calculationId)).toEqual(plan);
    });

    it("gives each purchase order its whole plan and each voyage instruction none", async () => {
      const { items } = listOf(RecommendationView).parse(
        (await get(app, "/api/recommendations")).body,
      );
      // A purchase order from a route plan's stop has no bunker plan behind it.
      const orders = items.filter((r) => r.type === "purchase_order" && r.id !== routeOrderId);
      expect(orders.length).toBeGreaterThan(0);
      expect(items.find((r) => r.id === routeOrderId)?.bunkerPlan).toBeNull();
      for (const r of orders) {
        expect(r.bunkerPlan).not.toBeNull();
        expect(r.bunkerPlan?.calculationId).toBe(r.calculationId);
        expect(r.bunkerPlan).toEqual(await source.getBunkerPlan(r.calculationId));
      }
      const instructions = items.filter((r) => r.type === "voyage_instruction");
      expect(instructions.length).toBeGreaterThan(0);
      for (const r of instructions) expect(r.bunkerPlan).toBeNull();
    });

    it.each(["Thessaly Star", "Aegean Pioneer"])(
      "rebuilds %s's stored route plan exactly as it was planned, facts in the same order",
      async (vessel) => {
        const planned = await planRouteSpeed(deps, { vessel });
        expect(planned.vesselId).not.toBeNull();
        expect(planned.snapshot).not.toBeNull();
        const id = planned.response.calculationId;
        const facts = routePlanFacts(planned);
        const view = await source.getRoutePlan(id);
        expect(view).toEqual({ ...planned.response, facts, computeMs: null });
        expect(view?.facts.map((f) => f.id)).toEqual(facts.map((f) => f.id));
        // Each routable bunker stop's track is a candidate the map can draw, by its stop plan id.
        for (const stop of planned.response.result.stopPlans.filter((p) => p.distanceNm > 0)) {
          expect(view?.candidates.map((c) => c.id)).toContain(stop.optionId);
        }
        const served = await get(app, `/api/route-plans/${id}`);
        expect(served.res.status).toBe(200);
        expect(RoutePlanView.parse(served.body)).toEqual(view);
        // The view cites what plan_route_speed cites for the same calculation: the tool's facts,
        // byte for byte, including the fuel check, the stop plans and the recommended plan.
        const tool = await planRouteSpeedFacts(createToolContext({ sql: db, now: () => NOW }), {
          vessel,
        });
        const toolId = (tool.data as { calculationId: number }).calculationId;
        const toolView = await get(app, `/api/route-plans/${toolId}`);
        expect(JSON.stringify((toolView.body as { facts: Fact[] }).facts)).toBe(
          JSON.stringify(tool.facts),
        );
        const { result } = planned.response;
        const paths = tool.facts.flatMap((f) =>
          f.provenance.source === "calculation" ? [f.provenance.path] : [],
        );
        expect(paths.includes("plan.optionId")).toBe(result.plan !== null);
        expect(paths.filter((p) => p.startsWith("stopPlans[")).length > 0).toBe(
          result.stopPlans.length > 0,
        );
        const short = result.options.some((o) => o.fuel?.grades.LSMGO.belowMarginAt);
        expect(paths.some((p) => /^options\[\d+\]\.fuel\.grades\.LSMGO\./.test(p))).toBe(short);
        if (vessel === "Aegean Pioneer") expect(short).toBe(true);
      },
    );

    it("cites the hazard's label from nav_hazards and its radius and the forecast from the stored plan", async () => {
      const planned = await planRouteSpeed(deps, { vessel: "Thessaly Star" });
      expect(planned.plan.avoidedHazardIds).toContain("synthetic:1");
      const id = planned.response.calculationId;
      const view = await source.getRoutePlan(id);
      const byLabel = (label: string) => view?.facts.find((f) => f.label === label);
      expect(byLabel("Reported hazard synthetic:1")?.provenance).toEqual({
        source: "db",
        table: "nav_hazards",
        rowId: "synthetic:1",
        field: "label",
      });
      expect(byLabel("Reported hazard synthetic:1: keep-out radius")?.provenance).toMatchObject({
        source: "db",
        table: "calculations",
        rowId: id,
      });
      expect(byLabel("Weather forecast start (UTC)")?.provenance).toEqual({
        source: "weather",
        snapshotId: planned.snapshot?.id,
        modelRun: planned.snapshot?.modelRun.toISOString(),
      });
    });

    it("reads plan time from the stored plan, not from a newer forecast or a moved hazard", async () => {
      const planned = await planRouteSpeed(deps, { vessel: "Thessaly Star" });
      const expected = { ...planned.response, facts: routePlanFacts(planned), computeMs: null };
      const latest = await latestWeatherSnapshot(db);
      if (!latest) throw new Error("no weather snapshot");
      const later = new Date(new Date(latest.grid.startAt).getTime() + 6 * 3_600_000);
      await insertWeatherSnapshot(db, {
        grid: { ...latest.grid, startAt: later.toISOString() },
        source: "test-newer",
        fetchedAt: NOW,
      });
      const [hazard] = await db<{ lat: number; radius_nm: number | null }[]>`
        select lat, radius_nm from nav_hazards where id = 'synthetic:1'`;
      await db`update nav_hazards set lat = lat + 1, radius_nm = 99 where id = 'synthetic:1'`;
      try {
        expect(await source.getRoutePlan(planned.response.calculationId)).toEqual(expected);
      } finally {
        await db`
          update nav_hazards set lat = ${hazard?.lat ?? 0}, radius_nm = ${hazard?.radius_nm ?? null}
          where id = 'synthetic:1'`;
      }
    });

    it("serves no AIS ship's route plan (ruling U5)", async () => {
      await db`
        insert into ais_traffic (mmsi, name, ship_type, lat, lon, sog_kn, destination, updated_at)
        values ('900000005', 'Plan View Test', 'tanker', 36, 5, 12, null,
                ${NOW.toISOString()}::timestamptz)`;
      try {
        const planned = await planRouteSpeed(deps, {
          vessel: "900000005",
          destination: "Rotterdam",
        });
        expect(planned.mmsi).toBe("900000005");
        const id = planned.response.calculationId;
        expect(await source.getRoutePlan(id)).toBeNull();
        const { res, body } = await get(app, `/api/route-plans/${id}`);
        expect(res.status).toBe(404);
        expect(body).toEqual({ error: "not_found" });
      } finally {
        await db`delete from ais_traffic where mmsi = '900000005'`;
      }
    });

    it("serves neither kind of plan under the other's path", async () => {
      const route = await planRouteSpeed(deps, { vessel: "Aegean Pioneer" });
      const routeId = route.response.calculationId;
      expect(await source.getRoutePlan(calculationId)).toBeNull();
      expect(await source.getBunkerPlan(routeId)).toBeNull();
      expect((await get(app, `/api/route-plans/${calculationId}`)).res.status).toBe(404);
      expect((await get(app, `/api/bunker-plans/${routeId}`)).res.status).toBe(404);
    });
  });
});
