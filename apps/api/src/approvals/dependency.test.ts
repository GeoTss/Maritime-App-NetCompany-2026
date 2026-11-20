import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { planRouteSpeedFacts } from "../ai/tools/route-speed.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../ask/demo-fixture.js";
import { orderDependencyOf } from "./dependency.js";

const sql = await connectTestDb("approvals_dependency");

if (!sql) {
  describe("orderDependencyOf (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("approvals_dependency")}`, () => {});
  });
}

describe.skipIf(!sql)("orderDependencyOf (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  let kestrelQuoteId: number;
  let routeCalcId: number;
  let bunkerCalcId: number;

  /** The instruction for the route plan's Marsaxlokk stop (it needs no row to be resolved). */
  const instruction = () => ({
    type: "voyage_instruction",
    calculation_id: routeCalcId,
    option_id: "MTMLA-kestrel",
  });
  /** A purchase-order proposal row, as propose_action stores one. */
  const order = async (calculationId: number, optionId: string, status = "pending") => {
    const [row] = await db<{ id: number }[]>`
      insert into recommendations (type, calculation_id, option_id, message_id, fact_refs,
                                   expected_saving_usd, status, decided_by, decided_at, created_at)
      values ('purchase_order', ${calculationId}, ${optionId}, null, '[]'::jsonb, null, ${status},
              null, null, ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)
      returning id`;
    if (!row) throw new Error("no recommendation inserted");
    return row.id;
  };
  const setStatus = (id: number, status: string) =>
    db`update recommendations set status = ${status} where id = ${id}`;

  beforeEach(async () => {
    const quoteIds = await prepareAskFixture(db);
    kestrelQuoteId = quoteIds[0] ?? 0;
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const route = await planRouteSpeedFacts(ctx, { vessel: "Aegean Pioneer" });
    routeCalcId = (route.data as { calculationId: number }).calculationId;
    const bunker = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    bunkerCalcId = (bunker.data as { calculationId: number }).calculationId;
  });
  afterAll(async () => {
    await db.end();
  });

  it("is unmet with no order, naming the stop's supplier and port", async () => {
    expect(await orderDependencyOf(db, instruction())).toEqual({
      quoteId: kestrelQuoteId,
      optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
      recommendationId: null,
      status: null,
      satisfied: false,
    });
  });

  it("finds the order for the stop's quote, unmet while it is pending", async () => {
    const id = await order(bunkerCalcId, "MTMLA-kestrel");
    expect(await orderDependencyOf(db, instruction())).toMatchObject({
      quoteId: kestrelQuoteId,
      recommendationId: id,
      status: "pending",
      satisfied: false,
    });
  });

  it("is satisfied once the order is approved, executing or executed, but not failed", async () => {
    const id = await order(bunkerCalcId, "MTMLA-kestrel");
    for (const status of ["approved", "executing", "executed"]) {
      await setStatus(id, status);
      expect(await orderDependencyOf(db, instruction())).toMatchObject({
        recommendationId: id,
        status,
        satisfied: true,
      });
    }
    await setStatus(id, "failed");
    expect((await orderDependencyOf(db, instruction()))?.satisfied).toBe(false);
  });

  it("counts a purchase order proposed from the route plan's own stop", async () => {
    const id = await order(routeCalcId, "MTMLA-kestrel", "approved");
    expect(await orderDependencyOf(db, instruction())).toMatchObject({
      recommendationId: id,
      satisfied: true,
    });
  });

  it("reports a rejected order as rejected and ignores an order for another quote", async () => {
    const rejected = await order(bunkerCalcId, "MTMLA-kestrel", "rejected");
    await order(bunkerCalcId, "GIGIB-straitline", "approved");
    const dep = await orderDependencyOf(db, instruction());
    expect(dep).toMatchObject({ recommendationId: rejected, status: "rejected", satisfied: false });
    // A newer live order for the same quote takes its place.
    const pending = await order(bunkerCalcId, "MTMLA-kestrel");
    expect(await orderDependencyOf(db, instruction())).toMatchObject({
      recommendationId: pending,
      status: "pending",
      satisfied: false,
    });
  });

  it("takes the latest pending order, but an approved one wins", async () => {
    const first = await order(bunkerCalcId, "MTMLA-kestrel");
    const latest = await order(bunkerCalcId, "MTMLA-kestrel");
    expect((await orderDependencyOf(db, instruction()))?.recommendationId).toBe(latest);
    await setStatus(first, "executed");
    expect(await orderDependencyOf(db, instruction())).toMatchObject({
      recommendationId: first,
      satisfied: true,
    });
  });

  it("is null for a purchase order and for a route with no stop", async () => {
    expect(
      await orderDependencyOf(db, {
        type: "purchase_order",
        calculation_id: bunkerCalcId,
        option_id: "MTMLA-kestrel",
      }),
    ).toBeNull();
    expect(await orderDependencyOf(db, { ...instruction(), option_id: "B" })).toBeNull();
  });
});
