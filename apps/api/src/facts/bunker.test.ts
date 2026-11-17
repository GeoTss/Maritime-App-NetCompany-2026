import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import type { BunkerOptionResult, BunkerPlan, Fact, RecommendationView } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createToolContext, type ToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { proposeAction } from "../ai/tools/propose-action.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../ask/demo-fixture.js";
import { createDbSource } from "../read/db-source.js";
import { type BunkerFactContext, bunkerPlanFacts, bunkerPlanView } from "./bunker.js";

const pathOf = (f: Fact) => (f.provenance.source === "calculation" ? f.provenance.path : null);

const sql = await connectTestDb("facts_bunker");

if (!sql) {
  describe("bunker facts (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("facts_bunker")}`, () => {});
  });
}

describe.skipIf(!sql)("bunker facts (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  // A freshly reset database (identities restarted) for every test, so the serial calculation
  // ids in fact ids are the same on every run.
  let quoteIds: number[];
  beforeEach(async () => {
    quoteIds = await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  /**
   * A second open grade on the demo voyage: a VLSFO requirement, and Kestrel's quote (linked to
   * the LSMGO requirement) also offering VLSFO, so both plans have an option.
   */
  const addVlsfo = async () => {
    const [kestrelId] = quoteIds;
    await db`
      insert into bunker_requirements (voyage_id, grade, qty_mt, status, created_at)
      values ((select id from voyages where voyage_no = 'AP-2611'), 'VLSFO', 200, 'open',
              ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    await db`
      insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
      values (${kestrelId ?? 0}, 'VLSFO', 200, 590)`;
  };

  // The tool's facts go into every later model request, and recorded replies are keyed on those
  // bytes: this pins them whole.
  it("plan_bunkering facts are unchanged", async () => {
    const single = await planBunkering(ctx(), { vessel: "MV Aegean Pioneer" });
    expect(JSON.stringify(single)).toMatchSnapshot();

    quoteIds = await prepareAskFixture(db);
    await addVlsfo();
    const twoGrades = await planBunkering(ctx(), { vessel: "MV Aegean Pioneer" });
    expect((twoGrades.data as { plans: unknown[] }).plans).toHaveLength(2);
    expect(JSON.stringify(twoGrades)).toMatchSnapshot();
  });

  /** Proposes `optionId` from the stored plan and reads the approval view of the proposal. */
  const proposeAndView = async (
    c: ToolContext,
    calculationId: number,
    optionId: string,
    factRef: string,
  ): Promise<RecommendationView> => {
    const proposed = await proposeAction(c, {
      type: "purchase_order",
      calculationId,
      optionId,
      factRefs: [factRef],
      rationale: "Lowest total delivered cost.",
    });
    const id = (proposed.data as { recommendationId: number }).recommendationId;
    const view = await createDbSource(db, () => ASK_FIXTURE_NOW).getRecommendation(id);
    if (!view) throw new Error(`no view of recommendation ${id}`);
    return view;
  };

  it("view facts are the tool's facts", async () => {
    const c = ctx();
    const result = await planBunkering(c, { vessel: "MV Aegean Pioneer" });
    const { calculationId, bestOptionId } = result.data as {
      calculationId: number;
      bestOptionId: string;
    };
    const tool = new Map(result.facts.map((f) => [f.id, f]));
    const bestRef = `f_plan_bunkering_${calculationId}_bestOptionId`;
    const saving = tool.get(`f_plan_bunkering_${calculationId}_savingVsCheapestHeadlineUsd`);
    expect(bestOptionId).toBe("MTMLA-kestrel");

    for (const [i, optionId] of ["MTMLA-kestrel", "GIGIB-straitline"].entries()) {
      const view = await proposeAndView(c, calculationId, optionId, bestRef);
      for (const f of view.facts.filter((x) => tool.has(x.id))) {
        expect(f, f.id).toEqual(tool.get(f.id));
      }
      // The effective price is the one fact the view adds; the tool never emits it.
      expect(view.facts.filter((f) => !tool.has(f.id)).map(pathOf)).toEqual([
        `options[${i}].effectivePriceUsdPerMt`,
      ]);
      const best = optionId === bestOptionId;
      expect(view.facts.map(pathOf)).toEqual([
        `options[${i}].qtyMt`,
        `options[${i}].headlinePriceUsdPerMt`,
        `options[${i}].totalCostUsd`,
        `options[${i}].effectivePriceUsdPerMt`,
        `options[${i}].fuelEuCostUsd`,
        ...(best ? ["bestOptionId", "savingVsCheapestHeadlineUsd"] : []),
      ]);
      expect(view.expectedSaving).toEqual(best ? saving : null);
    }
  });

  it("view facts carry the grade scope", async () => {
    await addVlsfo();
    const c = ctx();
    const result = await planBunkering(c, { vessel: "MV Aegean Pioneer" });
    const { plans } = result.data as {
      plans: { calculationId: number; grade: string; bestOptionId: string }[];
    };
    const tool = new Map(result.facts.map((f) => [f.id, f]));
    expect(plans.map((p) => p.bestOptionId)).toEqual([
      "LSMGO-MTMLA-kestrel",
      "VLSFO-MTMLA-kestrel",
    ]);

    for (const plan of plans) {
      const bestRef = `f_plan_bunkering_${plan.calculationId}_bestOptionId`;
      const view = await proposeAndView(c, plan.calculationId, plan.bestOptionId, bestRef);
      expect(view.facts.find((f) => f.id === bestRef)?.label).toBe(
        `${plan.grade} plan: Best option (lowest total cost, feasible)`,
      );
      for (const f of view.facts.filter((x) => tool.has(x.id))) {
        expect(f, f.id).toEqual(tool.get(f.id));
      }
    }
  });
});

describe("bunkerPlanView", () => {
  const opt = (optionId: string, rank: number, feasible: boolean, total: number) =>
    ({
      optionId,
      rank,
      feasible,
      reasons: [],
      qtyMt: 100,
      headlinePriceUsdPerMt: 600,
      fuelCostUsd: 0,
      bargeFeeUsd: 0,
      deviationFuelMt: 0,
      portStayFuelMt: 0,
      deviationCostUsd: 0,
      delayHours: 2,
      delayCostUsd: 0,
      co2T: 0,
      etsCostUsd: 10,
      fuelEuCostUsd: 5,
      totalCostUsd: total,
      effectivePriceUsdPerMt: total / 100,
    }) satisfies BunkerOptionResult;
  const plan: BunkerPlan = {
    options: [opt("A", 1, true, 1000), opt("B", 2, true, 1250), opt("C", 3, false, 900)],
    bestOptionId: "A",
    cheapestHeadlineOptionId: "A",
    savingVsCheapestHeadlineUsd: 0,
  };
  const onlyA: BunkerPlan = { ...plan, options: [plan.options[0] as BunkerOptionResult] };
  const ctx = (p: BunkerPlan): BunkerFactContext => ({
    calculationId: 7,
    plan: p,
    scope: "",
    names: (id) => ({ supplier: `Supplier ${id}`, port: `Port ${id}` }),
    displacementMt: null,
  });
  const PORT = { id: 1, name: "Piraeus", unlocode: "GRPIR", position: { lat: 37.9, lon: 23.6 } };
  const meta = { grade: "VLSFO" as const, vesselId: 1, voyageNo: "AP-2611", port: () => PORT };

  it("lists the options in rank order with the tool's fact ids", () => {
    const v = bunkerPlanView(ctx(plan), meta);
    expect(v.options.map((o) => o.optionId)).toEqual(["A", "B", "C"]);
    expect(v.options[1]?.totalCost.id).toBe("f_plan_bunkering_7_options.1.totalCostUsd");
    expect(v.options[0]?.rows.map((r) => r.name)).toEqual([
      "quantity",
      "headline price",
      "total delivered cost",
      "effective price (total cost per mt)",
      "delay",
      "EU ETS cost",
      "FuelEU exposure",
    ]);
    expect(v.options[0]?.best).toBe(true);
  });
  it("rows carry exactly the facts plan_bunkering returns for that option", () => {
    const tool = new Map(bunkerPlanFacts(ctx(plan)).map((f) => [f.id, f]));
    for (const row of bunkerPlanView(ctx(plan), meta).options[0]?.rows ?? []) {
      if (row.fact.id.endsWith("effectivePriceUsdPerMt")) continue; // view-only, as in wave 1
      expect(row.fact).toEqual(tool.get(row.fact.id));
    }
  });
  it("derives the margin over the first feasible runner-up", () => {
    const m = bunkerPlanView(ctx(plan), meta).marginVsRunnerUp;
    expect(m?.id).toBe("f_plan_bunkering_7_marginVsRunnerUpUsd");
    expect(m?.value).toBe(250);
    expect(m?.unit).toBe("USD");
    expect(m?.label).toBe("Margin of the best option over the runner-up, in total cost");
    expect(m?.provenance).toEqual({
      source: "derived",
      operation: "subtract",
      operands: [
        "f_plan_bunkering_7_options.1.totalCostUsd",
        "f_plan_bunkering_7_options.0.totalCostUsd",
      ],
    });
  });
  it("has no margin with one feasible option or no best option", () => {
    expect(bunkerPlanView(ctx(onlyA), meta).marginVsRunnerUp).toBeNull();
    expect(bunkerPlanView(ctx({ ...plan, bestOptionId: null }), meta).marginVsRunnerUp).toBeNull();
  });
  it("leaves out an option whose port is unknown", () => {
    const v = bunkerPlanView(ctx(plan), { ...meta, port: (id) => (id === "B" ? null : PORT) });
    expect(v.options.map((o) => o.optionId)).toEqual(["A", "C"]);
  });
});
