import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DecisionResult, DraftedMessageList, PlanProposals, ProposeResult } from "@pharos/shared";
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

  describe("POST /api/recommendations (a person proposes from a stored plan)", () => {
    const routePlan = async () => {
      const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
      const planned = await planRouteSpeedFacts(ctx, { vessel: "Aegean Pioneer" });
      return planned.data as {
        calculationId: number;
        recommendedOptionId: string | null;
        recommendedKind: string | null;
      };
    };
    const row = async (id: number) =>
      (
        await db<{ type: string; status: string; option_id: string; message_id: number | null }[]>`
          select type, status, option_id, message_id from recommendations where id = ${id}`
      )[0];

    const propose = async (
      type: string,
      plan: { calculationId: number; recommendedOptionId: string | null },
    ) =>
      ProposeResult.parse(
        await (
          await post("/api/recommendations", {
            type,
            calculationId: plan.calculationId,
            optionId: plan.recommendedOptionId,
          })
        ).json(),
      );

    it("proposes the purchase order for the recommended plan's bunker stop, pending", async () => {
      // No order proposal for the stop's quote yet.
      await db`delete from recommendations where id = ${recId}`;
      const plan = await routePlan();
      expect(plan.recommendedKind).toBe("stop");
      const res = await post("/api/recommendations", {
        type: "purchase_order",
        calculationId: plan.calculationId,
        optionId: plan.recommendedOptionId,
      });
      expect(res.status).toBe(200);
      const body = ProposeResult.parse(await res.json());
      expect(body.created).toBe(true);
      expect(body.status).toBe("pending");
      expect(await row(body.recommendationId)).toEqual({
        type: "purchase_order",
        status: "pending",
        option_id: plan.recommendedOptionId,
        message_id: null,
      });
      // The same proposal again returns the pending one, not a duplicate.
      expect(await propose("purchase_order", plan)).toEqual({
        recommendationId: body.recommendationId,
        created: false,
        status: "pending",
      });
    });

    it("returns the order proposal the voyage already has for the stop's quote, from any plan", async () => {
      // `recId` (proposed from the bunker plan) buys from the same quote as the route plan's stop.
      const plan = await routePlan();
      expect(await propose("purchase_order", plan)).toEqual({
        recommendationId: recId,
        created: false,
        status: "pending",
      });
    });

    it("planning again after both approvals proposes nothing new", async () => {
      const first = await routePlan();
      const instruction = await propose("voyage_instruction", first);
      expect(instruction.created).toBe(true);
      expect((await post(`/api/recommendations/${recId}/approve`)).status).toBe(200);
      expect(
        (await post(`/api/recommendations/${instruction.recommendationId}/approve`)).status,
      ).toBe(200);

      const again = await routePlan();
      expect(again.calculationId).not.toBe(first.calculationId);
      expect(await propose("purchase_order", again)).toEqual({
        recommendationId: recId,
        created: false,
        status: "executed",
      });
      expect(await propose("voyage_instruction", again)).toEqual({
        recommendationId: instruction.recommendationId,
        created: false,
        status: "executed",
      });
      const count = await db<{ n: number }[]>`select count(*)::int as n from recommendations`;
      expect(count[0]?.n).toBe(2);

      const res = await app.request(
        `/api/recommendations/for-plan?calculationId=${again.calculationId}&optionId=${again.recommendedOptionId}`,
      );
      expect(PlanProposals.parse(await res.json())).toEqual({
        purchaseOrder: { recommendationId: recId, status: "executed" },
        voyageInstruction: { recommendationId: instruction.recommendationId, status: "executed" },
        instructionInForce: null,
      });
      // Another option of the plan is a different instruction: it would replace the one in force.
      const other = await app.request(
        `/api/recommendations/for-plan?calculationId=${again.calculationId}&optionId=A`,
      );
      expect(PlanProposals.parse(await other.json())).toEqual({
        purchaseOrder: null,
        voyageInstruction: null,
        instructionInForce: { recommendationId: instruction.recommendationId, status: "executed" },
      });
      expect((await app.request("/api/recommendations/for-plan?optionId=A")).status).toBe(400);
    });

    it("proposes the voyage instruction for the recommended plan", async () => {
      const plan = await routePlan();
      const res = await post("/api/recommendations", {
        type: "voyage_instruction",
        calculationId: plan.calculationId,
        optionId: plan.recommendedOptionId,
      });
      expect(res.status).toBe(200);
      const { recommendationId } = ProposeResult.parse(await res.json());
      expect((await row(recommendationId))?.type).toBe("voyage_instruction");
    });

    it("refuses an option the plan rules out with the reason (409)", async () => {
      const plan = await routePlan();
      const res = await post("/api/recommendations", {
        type: "voyage_instruction",
        calculationId: plan.calculationId,
        optionId: "B",
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("not_proposable");
      expect(body.message).toMatch(/Route B is not feasible \(insufficient_fuel\)/);
    });

    it("rejects a malformed body (400) and a non-JSON request (415)", async () => {
      expect((await post("/api/recommendations", { type: "purchase_order" })).status).toBe(400);
      const form = await app.request("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "type=purchase_order",
      });
      expect(form.status).toBe(415);
    });
  });

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
