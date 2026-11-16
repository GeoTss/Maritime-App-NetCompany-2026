import { buildDemoBunkerPlanInput, DEMO_SCENARIO, generateWorld } from "@pharos/db";
import { legsForRoute, planBunkers } from "@pharos/domain";
import {
  AuditEventList,
  InboxItem,
  InboxItemDetail,
  listOf,
  PortList,
  QuoteView,
  RecommendationView,
  SimClockView,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createClock } from "../clock.js";
import { createFixtureSource, FIXTURE_ANCHOR, FIXTURE_SEED } from "./fixtures.js";
import { createReadRoutes } from "./routes.js";
import type { ReadSource } from "./source.js";

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

describe("id parsing", () => {
  // A source that would answer any id, so only parseId decides between 200 and 404.
  const seen: number[] = [];
  const anyId = async (id: number) => {
    seen.push(id);
    return { id };
  };
  const source = {
    getVessel: anyId,
  } as unknown as ReadSource;
  const routes = createReadRoutes(source);

  it("accepts the largest Postgres integer id, 2147483647", async () => {
    const res = await routes.request("/vessels/2147483647");
    expect(res.status).toBe(200);
    expect(seen).toContain(2147483647);
  });

  it.each(["2147483648", "9999999999"])("404s on id %s without asking the source", async (id) => {
    const before = seen.length;
    const res = await routes.request(`/vessels/${id}`);
    expect(res.status).toBe(404);
    expect(seen.length).toBe(before);
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
    expect(qty?.asWritten).toBe(DEMO_SCENARIO.needsReview.qtyAsWritten);
    expect(qty?.asWritten).toBe("300/350 mt");
    expect(detail.bodyText).toContain(DEMO_SCENARIO.needsReview.qtyAsWritten);
    expect(detail.checkResults.some((c) => !c.passed)).toBe(true);
    expect(detail.extractionId).toBe(flagged?.documentId);
  });

  it("shows no quantity on the needs-review quote; resolved quotes keep theirs", async () => {
    const { items } = listOf(QuoteView).parse((await get("/api/quotes")).body);
    const flagged = items.filter((q) => q.status === "needs_review");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.lines.map((l) => l.qtyMt)).toEqual([null]);
    for (const q of items.filter((x) => x.status !== "needs_review")) {
      for (const l of q.lines) expect(l.qtyMt).toBeGreaterThan(0);
    }
    const detail = QuoteView.parse((await get(`/api/quotes/${flagged[0]?.id}`)).body);
    expect(detail.lines[0]?.qtyMt).toBeNull();
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

describe("console read routes (fixture source)", () => {
  const pinned = createApp({
    llmMode: "replay",
    pingDb: async () => true,
    read: createFixtureSource(),
    clock: createClock(FIXTURE_ANCHOR),
  });

  it("GET /api/clock is a SimClockView: the world anchor and the pinned now", async () => {
    const res = await pinned.request("/api/clock");
    expect(res.status).toBe(200);
    expect(SimClockView.parse(await res.json())).toEqual({
      anchor: "2026-11-14T08:00:00.000Z",
      now: "2026-11-14T08:05:00.000Z",
      pinned: true,
    });
  });

  it("GET /api/clock unpinned reports the wall clock", async () => {
    const before = Date.now();
    const body = SimClockView.parse((await get("/api/clock")).body);
    const after = Date.now();
    expect(body.pinned).toBe(false);
    expect(body.anchor).toBe(FIXTURE_ANCHOR.toISOString());
    expect(Date.parse(body.now)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(body.now)).toBeLessThanOrEqual(after);
  });

  it("GET /api/ports is a PortList of the world's ports", async () => {
    const world = generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR });
    const { res, body } = await get("/api/ports");
    expect(res.status).toBe(200);
    const { items } = PortList.parse(body);
    expect(items).toHaveLength(world.ports.length);
    const marsaxlokk = items.find((p) => p.unlocode === "MTMLA");
    const port = world.ports.find((p) => p.unlocode === "MTMLA");
    expect(marsaxlokk).toEqual({
      id: port?.id,
      name: port?.name,
      unlocode: "MTMLA",
      position: { lat: port?.lat, lon: port?.lon },
      isEu: true,
    });
  });

  it("GET /api/audit is an AuditEventList (the fixture recommendation is undecided)", async () => {
    const { res, body } = await get("/api/audit");
    expect(res.status).toBe(200);
    expect(AuditEventList.parse(body).items).toEqual([]);
    const filtered = await get("/api/audit?recommendationId=1");
    expect(filtered.res.status).toBe(200);
    AuditEventList.parse(filtered.body);
  });

  it.each(["abc", "0", "-1", "2147483648"])(
    "GET /api/audit 400s on recommendationId=%s",
    async (id) => {
      const { res, body } = await get(`/api/audit?recommendationId=${id}`);
      expect(res.status).toBe(400);
      expect(body).toMatchObject({ error: "invalid_request" });
    },
  );

  it("gives every voyage detail a planned track from its route legs' waypoints", async () => {
    const world = generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR });
    const { items } = listOf(VoyageSummary).parse((await get("/api/voyages")).body);
    for (const v of items) {
      const detail = VoyageDetail.parse((await get(`/api/voyages/${v.id}`)).body);
      expect(detail.plannedTrack.length).toBeGreaterThanOrEqual(2);
      const voyage = world.voyages.find((x) => x.id === v.id);
      const legs = legsForRoute(voyage?.plannedRoute ?? [], world.routeLegs);
      // Every leg's waypoints, in order, with each joint (a leg starts where the last one ended) once.
      const expected = legs.flatMap((l, i) => (i === 0 ? l.waypoints : l.waypoints.slice(1)));
      expect(detail.plannedTrack).toEqual(expected.map((w) => ({ lat: w.lat, lon: w.lon })));
      const origin = world.ports.find((p) => p.id === voyage?.originPortId);
      expect(detail.plannedTrack[0]).toEqual({ lat: origin?.lat, lon: origin?.lon });
    }
  });
});
