import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_WORLD_SEED, generateWorld, type Sql, seedDatabase } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import {
  BunkerPlan,
  type Fact,
  FobProjection,
  InboxItem,
  InboxItemDetail,
  listOf,
  QuoteView,
  RecommendationView,
  RouteCandidate,
  RouteSpeedResult,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
} from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
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
  let calculationId: number;

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
    expect(pioneer?.alerts).toContain("lsmgo_below_margin_for_eca");
    const detail = VesselDetail.parse((await get(app, `/api/vessels/${pioneer?.id}`)).body);
    expect(detail).toEqual((await get(fixtures, `/api/vessels/${pioneer?.id}`)).body);
  });

  it("projects fuel on board as get_vessel_status does: on the voyage's loaded curve", async () => {
    const { items } = listOf(VesselSummary).parse((await get(app, "/api/vessels")).body);
    const pioneer = items.find((v) => v.name === "MV Aegean Pioneer");
    const detail = VesselDetail.parse((await get(app, `/api/vessels/${pioneer?.id}`)).body);
    const status = await getVesselStatus(createToolContext({ sql: db, now: () => NOW }), {
      vessel: "Aegean Pioneer",
    });
    const { fobCalculationId } = status.data as { fobCalculationId: number };
    const [calc] = await db<{ outputs: unknown }[]>`
      select outputs from calculations where id = ${fobCalculationId}`;
    expect(detail.fobProjection).toEqual(FobProjection.parse(calc?.outputs));
    // The loaded curve's shortfall (17.6 mt), not the unloaded curve's (28.4 mt).
    expect(detail.fobProjection?.shortfallMt.LSMGO).toBeCloseTo(17.6, 1);
    const shortfall = status.facts.find((f) => f.label === "LSMGO shortfall to keep the margin");
    expect(detail.fobProjection?.shortfallMt.LSMGO).toBe(shortfall?.value);
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

  it.each(["vessels", "voyages", "inbox", "quotes", "recommendations"])(
    "404s on an unknown /api/%s id",
    async (path) => {
      const { res, body } = await get(app, `/api/${path}/999999`);
      expect(res.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    },
  );

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

  // Runs after the purchase-order blocks: adds a voyage instruction.
  describe("voyage instruction view", () => {
    let viId: number;
    let routeCalcId: number;
    let toolFacts: Map<string, Fact>;

    beforeAll(async () => {
      const ctx = createToolContext({ sql: db, now: () => NOW });
      const out = await planRouteSpeedFacts(ctx, { vessel: "Aegean Pioneer" });
      routeCalcId = (out.data as { calculationId: number }).calculationId;
      toolFacts = new Map(out.facts.map((f) => [f.id, f]));
      const best = (out.data as { bestCandidateId: string }).bestCandidateId;
      const cite = (suffix: string) => out.facts.find((f) => f.label.endsWith(suffix))?.id ?? "";
      const proposed = await proposeAction(ctx, {
        type: "voyage_instruction",
        calculationId: routeCalcId,
        optionId: best,
        factRefs: [
          cite(": recommended route"),
          cite(`route ${best}: description`),
          cite(`route ${best}: recommended speed`),
          cite(`route ${best}: distance`),
        ],
        rationale: "Lowest total voyage cost within the berth window.",
      });
      viId = (proposed.data as { recommendationId: number }).recommendationId;
    });

    it("shows the approved route with its speed, ETA and distance facts, under the ids the agent cited", async () => {
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${viId}`)).body);
      const [calc] = await db<{ inputs: unknown; outputs: unknown }[]>`
        select inputs, outputs from calculations where id = ${routeCalcId}`;
      const result = RouteSpeedResult.parse(calc?.outputs);
      const inputs = z
        .object({
          subject: z.string(),
          destination: z.string(),
          optimiser: z.object({ candidates: z.array(RouteCandidate) }),
        })
        .parse(calc?.inputs);
      const index = result.options.findIndex((o) => o.candidateId === result.bestCandidateId);
      const option = result.options[index];
      const label = inputs.optimiser.candidates.find((c) => c.id === result.bestCandidateId)?.label;
      expect(rec).toMatchObject({
        type: "voyage_instruction",
        status: "pending",
        calculationId: routeCalcId,
        optionId: result.bestCandidateId,
        expectedSavingUsd: result.savingVsBaselineUsd,
        order: null,
        instruction: null,
      });
      expect(rec.summary).toBe(
        `Instruct ${inputs.subject} to ${inputs.destination}: ${label} (route ${result.bestCandidateId}).`,
      );
      const byPath = new Map(
        rec.facts.map((f) => [f.provenance.source === "calculation" ? f.provenance.path : "", f]),
      );
      expect(byPath.get(`options[${index}].speedKn`)?.value).toBe(option?.speedKn);
      expect(byPath.get(`options[${index}].eta`)?.value).toBe(option?.eta);
      expect(byPath.get(`options[${index}].distanceNm`)?.value).toBe(option?.distanceNm);
      expect(byPath.get(`options[${index}].fuelEuCostUsd`)).toMatchObject({
        value: option?.fuelEuCostUsd,
        unit: "USD",
      });
      expect(byPath.get(`options[${index}].fuelEuCostUsd`)?.label.endsWith("FuelEU exposure")).toBe(
        true,
      );
      expect(byPath.get("savingVsBaselineUsd")?.value).toBe(result.savingVsBaselineUsd);
      // Only the approved route's facts, each exactly as plan_route_speed returned it.
      for (const f of rec.facts) {
        expect(toolFacts.get(f.id)).toEqual(f);
        if (f.provenance.source === "calculation" && f.provenance.path.startsWith("options[")) {
          expect(f.provenance.path.startsWith(`options[${index}].`)).toBe(true);
        }
      }
      const ids = new Set(rec.facts.map((f) => f.id));
      expect(rec.factRefs.length).toBe(4);
      for (const ref of rec.factRefs) expect(ids.has(ref)).toBe(true);
    });

    it("route recommendation names its candidate", async () => {
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${viId}`)).body);
      const [calc] = await db<{ inputs: unknown }[]>`
        select inputs from calculations where id = ${routeCalcId}`;
      const inputs = z
        .object({ optimiser: z.object({ candidates: z.array(RouteCandidate) }) })
        .parse(calc?.inputs);
      const label = inputs.optimiser.candidates.find((c) => c.id === rec.optionId)?.label;
      expect(label).toBeTruthy();
      expect(rec.optionLabel).toBe(label);
      // The plan's saving, as plan_route_speed returned it.
      expect(rec.expectedSavingUsd).not.toBeNull();
      expect(rec.expectedSaving?.value).toBe(rec.expectedSavingUsd);
      expect(rec.expectedSaving).toEqual(
        toolFacts.get(`f_plan_route_speed_${routeCalcId}_savingVsBaselineUsd`),
      );
    });

    it("serves the recorded instruction once approved", async () => {
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
      const [row] = await db<{ id: number; candidate_id: string; speed_kn: number; eta: Date }[]>`
        select id, candidate_id, speed_kn, eta from voyage_instructions
        where recommendation_id = ${viId}`;
      if (!row) throw new Error("no instruction recorded");
      expect(decision.instructionId).toBe(row.id);
      const rec = RecommendationView.parse((await get(app, `/api/recommendations/${viId}`)).body);
      expect(rec).toMatchObject({
        status: "executed",
        order: null,
        instruction: {
          instructionId: row.id,
          candidateId: row.candidate_id,
          speedKn: row.speed_kn,
          eta: new Date(row.eta).toISOString(),
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
});
