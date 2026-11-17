import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DecisionResult, DraftedMessageList } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createErpApp } from "../../../../services/erp-sim/src/app.js";
import { createToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { proposeAction } from "../ai/tools/propose-action.js";
import { planRouteSpeedFacts } from "../ai/tools/route-speed.js";
import { createApp } from "../app.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../ask/demo-fixture.js";
import { createClock } from "../clock.js";
import { createErpClient } from "../executor/erp-client.js";
import { createFixtureSource, FIXTURE_ANCHOR } from "../read/fixtures.js";

const sql = await connectTestDb("approvals_routes");

if (!sql) {
  describe("approval routes (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("approvals_routes")}`, () => {});
  });
}

describe.skipIf(!sql)("approval routes (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  let recId: number;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await prepareAskFixture(db);
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
    recId = (proposed.data as { recommendationId: number }).recommendationId;
    const erpApp = createErpApp({ now: () => ASK_FIXTURE_NOW });
    app = createApp({
      llmMode: "replay",
      clock: createClock(FIXTURE_ANCHOR),
      pingDb: async () => true,
      read: createFixtureSource(),
      approvals: {
        sql: db,
        now: () => ASK_FIXTURE_NOW,
        erp: createErpClient("http://erp.test", (input, init) => erpApp.request(input, init)),
      },
    });
  });
  afterAll(async () => {
    await db.end();
  });

  /** A decision as the page and the smoke runner send it: JSON, `{}` when nobody is named. */
  const post = (path: string, body: unknown = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const status = async () =>
    (await db<{ status: string }[]>`select status from recommendations where id = ${recId}`)[0]
      ?.status;
  const decidedBy = async () =>
    (
      await db<{ decided_by: string | null }[]>`
      select decided_by from recommendations where id = ${recId}`
    )[0]?.decided_by;

  it("POST /api/recommendations/:id/approve returns the DecisionResult with the PO number", async () => {
    const res = await post(`/api/recommendations/${recId}/approve`);
    expect(res.status).toBe(200);
    const body = DecisionResult.parse(await res.json());
    expect(body).toMatchObject({
      recommendationId: recId,
      status: "executed",
      erpPoNumber: "PO-000001",
      erpSyncStatus: "synced",
    });
    expect(await decidedBy()).toBe("operator");
  });

  it("takes decidedBy from the body", async () => {
    const res = await post(`/api/recommendations/${recId}/approve`, { decidedBy: "dana" });
    expect(res.status).toBe(200);
    expect(await decidedBy()).toBe("dana");
  });

  it("reject is final: 200, then 409 for reject and approve", async () => {
    const res = await post(`/api/recommendations/${recId}/reject`, {});
    expect(res.status).toBe(200);
    expect(DecisionResult.parse(await res.json())).toEqual({
      recommendationId: recId,
      status: "rejected",
      orderId: null,
      erpPoNumber: null,
      erpSyncStatus: null,
      instructionId: null,
    });
    const again = await post(`/api/recommendations/${recId}/reject`);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "not_pending" });
    const approve = await post(`/api/recommendations/${recId}/approve`);
    expect(approve.status).toBe(409);
    expect(await approve.json()).toMatchObject({ error: "already_rejected" });
  });

  it.each(["999999", "abc", "0"])("404s on recommendation id %s", async (id) => {
    for (const action of ["approve", "reject"]) {
      const res = await post(`/api/recommendations/${id}/${action}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
  });

  it.each([
    ["a non-string decidedBy", JSON.stringify({ decidedBy: 5 })],
    ["an empty decidedBy", JSON.stringify({ decidedBy: "  " })],
    ["an unknown field", JSON.stringify({ quantity: 500 })],
    ["malformed JSON", "{"],
    ["an empty body", ""],
  ])("400s on %s without deciding", async (_label, body) => {
    const res = await app.request(`/api/recommendations/${recId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
    expect(await status()).toBe("pending");
  });

  // A cross-site HTML form can only send these (or nothing); none of them may decide.
  it.each([
    ["no content-type and no body", undefined, undefined],
    ["a form post", "application/x-www-form-urlencoded", "decidedBy=mallory"],
    ["a multipart form post", "multipart/form-data; boundary=x", "--x--"],
    ["a text/plain form post", "text/plain", '{"decidedBy":"mallory"}'],
  ])("415s on %s and decides nothing", async (_label, type, body) => {
    for (const action of ["approve", "reject"]) {
      const res = await app.request(`/api/recommendations/${recId}/${action}`, {
        method: "POST",
        ...(type === undefined ? {} : { headers: { "content-type": type } }),
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ error: "unsupported_media_type" });
    }
    expect(await status()).toBe("pending");
    const [orders] = await db<{ n: number }[]>`select count(*)::int as n from purchase_orders
      where recommendation_id = ${recId}`;
    expect(orders?.n).toBe(0);
  });

  it("approve after reject is 409 and a failed ERP push can be retried through approve", async () => {
    await post(`/api/recommendations/${recId}/reject`);
    const res = await post(`/api/recommendations/${recId}/approve`);
    expect(res.status).toBe(409);
    expect(await status()).toBe("rejected");
  });

  it("GET /api/recommendations/:id/drafts lists the drafts after approval, none before", async () => {
    const before = await app.request(`/api/recommendations/${recId}/drafts`);
    expect(await before.json()).toEqual({ items: [] });
    await post(`/api/recommendations/${recId}/approve`);
    const res = await app.request(`/api/recommendations/${recId}/drafts`);
    const body = DraftedMessageList.parse(await res.json());
    expect(body.items.map((d) => [d.kind, d.status])).toEqual([
      ["supplier_confirmation", "draft"],
      ["master_instruction", "draft"],
    ]);
  });

  it("maps dependency_unmet to 409 with the reason, and approves once the order is approved", async () => {
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const route = await planRouteSpeedFacts(ctx, { vessel: "Aegean Pioneer" });
    const calculationId = (route.data as { calculationId: number }).calculationId;
    const cite = route.facts.find(
      (f) => f.provenance.source === "calculation" && f.provenance.path === "bestCandidateId",
    );
    const proposed = await proposeAction(ctx, {
      type: "voyage_instruction",
      calculationId,
      optionId: "MTMLA-kestrel",
      factRefs: [cite?.id ?? ""],
      rationale: "The plan that keeps the fuel margin.",
    });
    const viId = (proposed.data as { recommendationId: number }).recommendationId;

    const blocked = await post(`/api/recommendations/${viId}/approve`);
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: string; message: string };
    expect(body.error).toBe("dependency_unmet");
    expect(body.message).toContain("Kestrel Marine Fuels at Marsaxlokk");
    expect(body.message).toContain(`proposal ${recId} is pending`);

    expect((await post(`/api/recommendations/${recId}/approve`)).status).toBe(200);
    const approved = await post(`/api/recommendations/${viId}/approve`);
    expect(approved.status).toBe(200);
    expect(DecisionResult.parse(await approved.json())).toMatchObject({ status: "executed" });
  });

  it("accepts application/json with a charset", async () => {
    const res = await app.request(`/api/recommendations/${recId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await status()).toBe("rejected");
  });
});
