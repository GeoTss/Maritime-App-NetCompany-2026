import { loadWorld, type Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { recordedLiveData } from "@pharos/integrations";
import { BunkerPlan, type Fact, ProposeActionInput, RouteSpeedResult } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { FIXTURE_ANCHOR } from "../../read/fixtures.js";
import { createToolContext, type ToolContext } from "./common.js";
import { planBunkering } from "./plan-bunkering.js";
import { proposeAction, proposeActionDef } from "./propose-action.js";
import { planRouteSpeedFacts } from "./route-speed.js";
import { getVesselStatus } from "./vessel-status.js";

const sql = await connectTestDb("ask_propose_action");

if (!sql) {
  describe("propose_action (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_propose_action")}`, () => {});
  });
}

describe.skipIf(!sql)("propose_action (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  let ctx: ToolContext;
  let calculationId: number;
  let plan: BunkerPlan;
  let facts: Fact[];

  beforeEach(async () => {
    await prepareAskFixture(db);
    ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const result = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    facts = result.facts;
    const [calc] = await db<{ id: number; outputs: unknown }[]>`
      select id, outputs from calculations where kind = 'bunker_plan' order by id desc limit 1`;
    if (!calc) throw new Error("no plan stored");
    calculationId = calc.id;
    plan = BunkerPlan.parse(calc.outputs);
  });
  afterAll(async () => {
    await db.end();
  });

  const factFor = (suffix: string) => {
    const f = facts.find((x) => x.id.endsWith(suffix));
    if (!f) throw new Error(`no fact ${suffix}`);
    return f.id;
  };
  const valid = () => ({
    type: "purchase_order" as const,
    calculationId,
    optionId: "MTMLA-kestrel",
    factRefs: [factFor("_bestOptionId"), factFor("_savingVsCheapestHeadlineUsd")],
    rationale: "Lowest total delivered cost of the received quotes.",
  });
  const recommendations = () =>
    db<
      {
        id: number;
        type: string;
        calculation_id: number;
        option_id: string;
        fact_refs: string[];
        expected_saving_usd: number | null;
        status: string;
        message_id: number | null;
      }[]
    >`select id, type, calculation_id, option_id, fact_refs, expected_saving_usd, status, message_id
      from recommendations order by id`;

  it("inserts a pending recommendation and returns its id", async () => {
    const result = await proposeAction(ctx, valid());
    const rows = await recommendations();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      type: "purchase_order",
      calculation_id: calculationId,
      option_id: "MTMLA-kestrel",
      status: "pending",
      message_id: null,
    });
    expect(row?.fact_refs).toEqual(valid().factRefs);
    expect(result.data).toMatchObject({ recommendationId: row?.id, status: "pending" });
    expect(ctx.recommendationIds).toEqual([row?.id]);
    const idFact = result.facts[0];
    expect(idFact?.value).toBe(row?.id);
    expect(idFact?.provenance).toMatchObject({ source: "db", table: "recommendations" });
  });

  it("expectedSavingUsd equals the calculation's savingVsCheapestHeadlineUsd", async () => {
    await proposeAction(ctx, valid());
    const [row] = await recommendations();
    expect(plan.savingVsCheapestHeadlineUsd).not.toBeNull();
    expect(row?.expected_saving_usd).toBe(plan.savingVsCheapestHeadlineUsd);
  });

  it("proposing the same option twice returns the same pending recommendation", async () => {
    const first = await proposeAction(ctx, valid());
    const again = await proposeAction(ctx, valid());
    expect(again.data).toEqual(first.data);
    expect(await recommendations()).toHaveLength(1);
  });

  it("rejects an unknown factRef", async () => {
    await expect(
      proposeAction(ctx, { ...valid(), factRefs: ["f_plan_bunkering_999_options.0.totalCostUsd"] }),
    ).rejects.toThrow(/not returned earlier in this conversation/);
    expect(await recommendations()).toHaveLength(0);
  });

  it("rejects a factRef from another calculation, and creates no recommendation", async () => {
    // A second plan in the same conversation: its facts are known, but they do not back this one.
    const second = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    const otherBest = second.facts.find((f) => f.id.endsWith("_bestOptionId"));
    if (!otherBest) throw new Error("no best option in the second plan");
    expect(otherBest.provenance).toMatchObject({ calculationId: calculationId + 1 });
    await expect(
      proposeAction(ctx, { ...valid(), factRefs: [factFor("_bestOptionId"), otherBest.id] }),
    ).rejects.toThrow(new RegExp(`${otherBest.id}.*not facts of calculation ${calculationId}`));
    // A db fact returned beside the plan (the voyage number) is not one of its calculation's facts.
    await expect(
      proposeAction(ctx, { ...valid(), factRefs: [factFor("_voyages.voyageNo")] }),
    ).rejects.toThrow(/not facts of calculation/);
    expect(await recommendations()).toHaveLength(0);
  });

  it("its description limits proposals to questions that ask for a decision", () => {
    const { description } = proposeActionDef;
    expect(description).toMatch(/only when the operator asks you to decide/);
    expect(description).toMatch(/never when they only look something up, compare/);
  });

  it("rejects a model-typed quantity, price or speed (strict input)", () => {
    for (const extra of [{ qtyMt: 300 }, { pricePerMt: 700 }, { speedKn: 11 }]) {
      expect(() => ProposeActionInput.parse({ ...valid(), ...extra })).toThrow();
      expect(() => proposeActionDef.inputSchema.parse({ ...valid(), ...extra })).toThrow();
    }
  });

  it("rejects an unknown option and an infeasible option", async () => {
    await expect(proposeAction(ctx, { ...valid(), optionId: "XXNOPE-kestrel" })).rejects.toThrow(
      /has no option/,
    );
    // A third quote offering far too little fuel makes an infeasible option in a new plan.
    await db`
      insert into quotes (supplier_id, port_id, requirement_id, currency, barge_fee, status, received_at)
      values ((select id from suppliers where name = 'Nordwind Bunker Services'),
              (select id from ports where unlocode = 'ESALG'), 1, 'EUR', 3000, 'received',
              ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    await db`
      insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
      values ((select max(id) from quotes), 'LSMGO', 10, 690)`;
    const replan = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    const calcId = (replan.data as { calculationId: number }).calculationId;
    const [row] = await db<{ outputs: unknown }[]>`
      select outputs from calculations where id = ${calcId}`;
    const infeasible = BunkerPlan.parse(row?.outputs).options.find((o) => !o.feasible);
    expect(infeasible?.optionId).toBe("ESALG-nordwind");
    const replanBest = replan.facts.find((f) => f.id.endsWith("_bestOptionId"));
    await expect(
      proposeAction(ctx, {
        ...valid(),
        calculationId: calcId,
        optionId: "ESALG-nordwind",
        factRefs: [replanBest?.id ?? ""],
      }),
    ).rejects.toThrow(/not feasible \(insufficient_quantity/);
    expect(await recommendations()).toHaveLength(0);
  });

  it("rejects a calculation that does not exist or was not computed in this conversation", async () => {
    await expect(proposeAction(ctx, { ...valid(), calculationId: 99_999 })).rejects.toThrow(
      /does not exist/,
    );
    // Another conversation knows a fact (vessel status), but not this plan.
    const other = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const status = await getVesselStatus(other, { vessel: "Aegean Pioneer" });
    const known = status.facts.find((f) => f.provenance.source === "db");
    if (!known) throw new Error("no db fact");
    await expect(proposeAction(other, { ...valid(), factRefs: [known.id] })).rejects.toThrow(
      /not computed in this conversation/,
    );
    expect(await recommendations()).toHaveLength(0);
  });

  describe("route plans", () => {
    /** Aegean Pioneer's route plan in this conversation: its stored result and facts. */
    const routePlan = async (vessel = "Aegean Pioneer", destination?: string) => {
      const out = await planRouteSpeedFacts(
        ctx,
        destination ? { vessel, destination } : { vessel },
      );
      const id = (out.data as { calculationId: number }).calculationId;
      const [calc] = await db<{ outputs: unknown; voyage_id: number | null }[]>`
        select outputs, voyage_id from calculations where id = ${id}`;
      const result = RouteSpeedResult.parse(calc?.outputs);
      /** The plan's fact at a result path (its label may change; its path does not). */
      const at = (path: string) => {
        const f = out.facts.find(
          (x) => x.provenance.source === "calculation" && x.provenance.path === path,
        );
        if (!f) throw new Error(`no route fact at ${path}`);
        return f.id;
      };
      return { id, result, facts: out.facts, at, voyageId: calc?.voyage_id ?? null };
    };
    type Plan = Awaited<ReturnType<typeof routePlan>>;
    const instruction = (plan: Plan, optionId = plan.result.bestCandidateId) => ({
      type: "voyage_instruction" as const,
      calculationId: plan.id,
      optionId,
      factRefs: [plan.at("bestCandidateId")],
      rationale: "The plan that keeps the fuel margin and meets the berth window.",
    });
    const order = (plan: Plan, optionId = "MTMLA-kestrel") => ({
      ...instruction(plan, optionId),
      type: "purchase_order" as const,
      rationale: "Buy where the recommended plan bunkers.",
    });
    const count = async (table: "recommendations" | "purchase_orders") =>
      (await db<{ n: number }[]>`select count(*)::int as n from ${db(table)}`)[0]?.n ?? 0;
    const NEEDS_ORDER =
      "Needs an approved purchase order for Kestrel Marine Fuels at Marsaxlokk before it can be approved.";

    it("recommends the Marsaxlokk stop (the demo world after the retune)", async () => {
      const plan = await routePlan();
      expect(plan.result.plan).toMatchObject({ kind: "stop", optionId: "MTMLA-kestrel" });
      expect(plan.result.stopPlans.find((s) => s.optionId === "MTMLA-kestrel")?.feasible).toBe(
        true,
      );
    });

    it("proposes an instruction on a stop plan without creating an order", async () => {
      const plan = await routePlan();
      const orders = await count("purchase_orders");
      const result = await proposeAction(ctx, instruction(plan, "MTMLA-kestrel"));
      const rows = await recommendations();
      // One recommendation, the instruction: never its purchase order as a side effect.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "voyage_instruction",
        calculation_id: plan.id,
        option_id: "MTMLA-kestrel",
        status: "pending",
        expected_saving_usd: null,
      });
      expect(await count("purchase_orders")).toBe(orders);
      expect(result.data).toMatchObject({
        recommendationId: rows[0]?.id,
        status: "pending",
        optionId: "MTMLA-kestrel",
        dependsOnRecommendationId: null,
      });
      const { note } = result.data as { note: string };
      expect(note).toMatch(/No voyage change has been made/);
      expect(note).toContain(NEEDS_ORDER);
      expect(ctx.recommendationIds).toEqual([rows[0]?.id]);
    });

    it("returns the matching order id, and drops the note once that order is approved", async () => {
      const ordered = await proposeAction(ctx, valid());
      const orderId = (ordered.data as { recommendationId: number }).recommendationId;
      const plan = await routePlan();
      const pending = await proposeAction(ctx, instruction(plan, "MTMLA-kestrel"));
      expect(pending.data).toMatchObject({ dependsOnRecommendationId: orderId });
      expect((pending.data as { note: string }).note).toContain(NEEDS_ORDER);
      // The order's id is cited as a fact, so an answer may name it.
      expect(pending.facts.map((f) => f.value)).toContain(orderId);

      await db`update recommendations set status = 'approved' where id = ${orderId}`;
      const again = await proposeAction(ctx, instruction(plan, "MTMLA-kestrel"));
      expect(again.data).toMatchObject({
        recommendationId: (pending.data as { recommendationId: number }).recommendationId,
        dependsOnRecommendationId: orderId,
      });
      expect((again.data as { note: string }).note).not.toContain("Needs an approved");
      expect(await count("recommendations")).toBe(2);
    });

    it("proposes a purchase order from a route plan's stop", async () => {
      const plan = await routePlan();
      const result = await proposeAction(ctx, order(plan));
      const rows = await recommendations();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "purchase_order",
        calculation_id: plan.id,
        option_id: "MTMLA-kestrel",
        status: "pending",
        expected_saving_usd: null,
      });
      expect((result.data as { note: string }).note).toMatch(/Nothing has been ordered/);
      expect(result.data).not.toHaveProperty("dependsOnRecommendationId");
      // A route plan's purchase order is for one of its bunker stops, never a route.
      await expect(proposeAction(ctx, order(plan, "B"))).rejects.toThrow(
        /has no bunker stop B; its bunker stops are MTMLA-kestrel, GIGIB-straitline/,
      );
      expect(await recommendations()).toHaveLength(1);
    });

    it("refuses an infeasible stop plan with its reasons", async () => {
      const plan = await routePlan();
      const straitline = plan.result.stopPlans.find((s) => s.optionId === "GIGIB-straitline");
      expect(straitline?.feasible).toBe(false);
      const reasons = straitline?.reasons.join(", ") ?? "";
      for (const action of [
        instruction(plan, "GIGIB-straitline"),
        order(plan, "GIGIB-straitline"),
      ]) {
        await expect(proposeAction(ctx, action)).rejects.toThrow(
          `Bunker stop GIGIB-straitline is not feasible (${reasons}); it cannot be proposed.`,
        );
      }
      expect(await recommendations()).toHaveLength(0);
    });

    it("refuses a fuel-blind route that runs short (insufficient_fuel)", async () => {
      const plan = await routePlan();
      const best = plan.result.options.find((o) => o.candidateId === plan.result.bestCandidateId);
      expect(best?.reasons).toContain("insufficient_fuel");
      await expect(proposeAction(ctx, instruction(plan))).rejects.toThrow(
        new RegExp(
          `Route ${plan.result.bestCandidateId} is not feasible \\(.*insufficient_fuel.*\\); ` +
            "it cannot be proposed. The recommended plan is MTMLA-kestrel.",
        ),
      );
      expect(await recommendations()).toHaveLength(0);
    });

    it("a voyage instruction from a bunker plan is a tool error naming both kinds", async () => {
      await expect(proposeAction(ctx, { ...valid(), type: "voyage_instruction" })).rejects.toThrow(
        /voyage_instruction.*route_speed.*bunker_plan/,
      );
      expect(await recommendations()).toHaveLength(0);
    });

    it("an unknown route is a tool error naming the routes and stops", async () => {
      const plan = await routePlan();
      await expect(proposeAction(ctx, instruction(plan, "Z"))).rejects.toThrow(
        /has no route Z; its routes are A, B, C and its bunker stops are MTMLA-kestrel, GIGIB-straitline/,
      );
      expect(await recommendations()).toHaveLength(0);
    });

    it("a factRef of another calculation, or a plan from another conversation, is a tool error", async () => {
      const plan = await routePlan();
      await expect(
        proposeAction(ctx, { ...instruction(plan), factRefs: [factFor("_bestOptionId")] }),
      ).rejects.toThrow(new RegExp(`not facts of calculation ${plan.id}`));
      const other = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
      await expect(proposeAction(other, instruction(plan))).rejects.toThrow(
        /not returned earlier in this conversation/,
      );
      expect(await recommendations()).toHaveLength(0);
    });

    it("a public AIS ship's plan is refused", async () => {
      const world = await loadWorld(db);
      const ship = recordedLiveData({ anchor: FIXTURE_ANCHOR, ports: world.ports })
        .traffic.filter(
          (t) =>
            t.name?.trim() &&
            (t.shipType === "cargo" || t.shipType === "tanker") &&
            (t.sogKn ?? 0) >= 8,
        )
        .sort((a, b) => a.mmsi.localeCompare(b.mmsi))[0];
      if (!ship) throw new Error("no suitable ship in the capture");
      const plan = await routePlan(ship.mmsi, "Rotterdam");
      expect(plan.voyageId).toBeNull();
      await expect(proposeAction(ctx, instruction(plan))).rejects.toThrow(
        "Pharos can only instruct the operator's own vessels.",
      );
      expect(await recommendations()).toHaveLength(0);
    });
  });
});
