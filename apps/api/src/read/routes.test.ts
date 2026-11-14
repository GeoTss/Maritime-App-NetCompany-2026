import { buildDemoBunkerPlanInput, generateWorld } from "@pharos/db";
import { planBunkers } from "@pharos/domain";
import {
  InboxItem,
  InboxItemDetail,
  listOf,
  QuoteView,
  RecommendationView,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createFixtureSource, FIXTURE_ANCHOR, FIXTURE_SEED } from "./fixtures.js";

const app = createApp({ llmMode: "replay", pingDb: async () => true, read: createFixtureSource() });

async function get(path: string) {
  const res = await app.request(path);
  return { res, body: (await res.json()) as unknown };
}

const resources = [
  { path: "vessels", summary: VesselSummary, detail: VesselDetail, idKey: "id" },
  { path: "voyages", summary: VoyageSummary, detail: VoyageDetail, idKey: "id" },
  { path: "inbox", summary: InboxItem, detail: InboxItemDetail, idKey: "documentId" },
  { path: "quotes", summary: QuoteView, detail: QuoteView, idKey: "id" },
  { path: "recommendations", summary: RecommendationView, detail: RecommendationView, idKey: "id" },
] as const;

describe.each(resources)("/api/$path", ({ path, summary, detail, idKey }) => {
  it("lists items, tagged as fixture data", async () => {
    const { res, body } = await get(`/api/${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-pharos-data")).toBe("fixture");
    const parsed = listOf(summary).parse(body);
    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it("returns the first item's detail", async () => {
    const list = listOf(summary).parse((await get(`/api/${path}`)).body);
    const id = (list.items[0] as unknown as Record<string, number>)[idKey];
    const { res, body } = await get(`/api/${path}/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-pharos-data")).toBe("fixture");
    detail.parse(body);
  });

  it.each(["999999", "abc", "1.5", "0", "-1"])("404s on id %s", async (id) => {
    const { res, body } = await get(`/api/${path}/${id}`);
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });
});

describe("fixture content", () => {
  const world = generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR });

  it("has eight vessels", async () => {
    const { items } = listOf(VesselSummary).parse((await get("/api/vessels")).body);
    expect(items).toHaveLength(8);
  });

  it("flags Aegean Pioneer's LSMGO and shows the shortfall in its detail", async () => {
    const { items } = listOf(VesselSummary).parse((await get("/api/vessels")).body);
    const pioneer = items.find((v) => v.name === "MV Aegean Pioneer");
    expect(pioneer?.alerts).toContain("lsmgo_below_margin_for_eca");
    const detail = VesselDetail.parse((await get(`/api/vessels/${pioneer?.id}`)).body);
    expect(detail.fobProjection?.shortfallMt.LSMGO).toBeGreaterThan(0);
  });

  it("recommends the plan's best option with saving from planBunkers and resolvable fact refs", async () => {
    const { items } = listOf(RecommendationView).parse((await get("/api/recommendations")).body);
    const rec = items[0];
    const plan = planBunkers(buildDemoBunkerPlanInput(world));
    expect(rec?.status).toBe("pending");
    expect(rec?.type).toBe("purchase_order");
    expect(rec?.calculationId).toBe(1);
    expect(rec?.optionId).toBe(plan.bestOptionId);
    expect(rec?.expectedSavingUsd).toBe(plan.savingVsCheapestHeadlineUsd);
    const ids = new Set(rec?.facts.map((f) => f.id));
    expect(rec?.factRefs.length).toBeGreaterThan(0);
    for (const ref of rec?.factRefs ?? []) expect(ids.has(ref)).toBe(true);
    for (const f of rec?.facts ?? []) expect(f.provenance.source).toBe("calculation");
  });

  it("has three demo emails with exactly one needing review", async () => {
    const { items } = listOf(InboxItem).parse((await get("/api/inbox")).body);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.extractionStatus === "needs_review")).toHaveLength(1);
    expect(items.map((i) => i.kind).sort()).toEqual(["email", "email", "pdf"]);
  });

  it("gives the needs-review email a null quantity written as a range, with verbatim evidence", async () => {
    const { items } = listOf(InboxItem).parse((await get("/api/inbox")).body);
    const flagged = items.find((i) => i.extractionStatus === "needs_review");
    const detail = InboxItemDetail.parse((await get(`/api/inbox/${flagged?.documentId}`)).body);
    expect(detail.extraction?.kind).toBe("quote");
    if (detail.extraction?.kind !== "quote") return;
    const qty = detail.extraction.lines[0]?.quantity;
    expect(qty?.value).toBeNull();
    expect(qty?.asWritten).toBe("300/350 mt");
    expect(detail.checkResults.some((c) => !c.passed)).toBe(true);
  });

  it("quotes every piece of evidence verbatim from its body text", async () => {
    const { items } = listOf(InboxItem).parse((await get("/api/inbox")).body);
    for (const it of items) {
      const detail = InboxItemDetail.parse((await get(`/api/inbox/${it.documentId}`)).body);
      const x = detail.extraction;
      if (x?.kind !== "quote") throw new Error("expected a quote");
      const evidence = [
        x.supplierName.evidence,
        x.vesselName.evidence,
        x.port.evidence,
        x.bargeFee.evidence,
        ...x.lines.flatMap((l) => [l.grade.evidence, l.quantity.evidence, l.price.evidence]),
      ];
      for (const e of evidence) expect(detail.bodyText).toContain(e as string);
    }
  });
});
