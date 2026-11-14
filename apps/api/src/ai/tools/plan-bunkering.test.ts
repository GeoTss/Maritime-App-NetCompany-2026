import { buildBunkerPlanInput, loadWorld, type Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DOMAIN_CODE_VERSION, planBunkers } from "@pharos/domain";
import { BunkerPlan, BunkerPlanInput, Fact, FactId } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { PlanBunkeringInput, planBunkering } from "./plan-bunkering.js";

const sql = await connectTestDb("ask_plan_bunkering");

if (!sql) {
  describe("plan_bunkering (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_plan_bunkering")}`, () => {});
  });
}

describe.skipIf(!sql)("plan_bunkering (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
  let quoteIds: number[];

  beforeEach(async () => {
    quoteIds = await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const latestCalc = async () => {
    const [row] = await db<
      { id: number; kind: string; inputs: unknown; outputs: unknown; code_version: string }[]
    >`select id, kind, inputs, outputs, code_version from calculations order by id desc limit 1`;
    if (!row) throw new Error("no calculation stored");
    return row;
  };

  it("input is strict", () => {
    expect(() => PlanBunkeringInput.parse({ vessel: "Aegean Pioneer", qtyMt: 300 })).toThrow();
  });

  it("plan_bunkering ranks MTMLA-kestrel first and GIGIB-straitline as cheapest headline", async () => {
    const result = await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const calc = await latestCalc();
    expect(calc.kind).toBe("bunker_plan");
    expect(calc.code_version).toBe(DOMAIN_CODE_VERSION);
    const plan = BunkerPlan.parse(calc.outputs);
    expect(plan.bestOptionId).toBe("MTMLA-kestrel");
    expect(plan.cheapestHeadlineOptionId).toBe("GIGIB-straitline");
    expect(plan.savingVsCheapestHeadlineUsd).toBeGreaterThan(0);

    const best = result.facts.find((f) => f.id === `f_plan_bunkering_${calc.id}_bestOptionId`);
    expect(best?.value).toBe("MTMLA-kestrel");
    const cheapest = result.facts.find(
      (f) => f.id === `f_plan_bunkering_${calc.id}_cheapestHeadlineOptionId`,
    );
    expect(cheapest?.value).toBe("GIGIB-straitline");
    const saving = result.facts.find(
      (f) => f.id === `f_plan_bunkering_${calc.id}_savingVsCheapestHeadlineUsd`,
    );
    expect(saving?.value).toBe(plan.savingVsCheapestHeadlineUsd);
    expect(saving?.unit).toBe("USD");
  });

  it("returns the calculation id and the voyage number as facts, so an answer can cite them", async () => {
    const result = await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const calc = await latestCalc();
    const data = result.data as { calculationId: number; voyageNo: string };
    const calcIdFact = result.facts.find(
      (f) => f.id === `f_plan_bunkering_${calc.id}_calculationId`,
    );
    expect(calcIdFact).toMatchObject({
      value: calc.id,
      unit: null,
      provenance: {
        source: "calculation",
        calculationId: calc.id,
        calculator: "planBunkers",
        path: "calculationId",
      },
    });
    expect(data.calculationId).toBe(calcIdFact?.value);

    const [voyage] = await db<{ id: number; voyage_no: string }[]>`
      select id, voyage_no from voyages where voyage_no = 'AP-2611'`;
    const voyageFact = result.facts.find(
      (f) => f.id === `f_plan_bunkering_${voyage?.id}_voyages.voyageNo`,
    );
    expect(voyageFact).toMatchObject({
      value: "AP-2611",
      provenance: { source: "db", table: "voyages", rowId: voyage?.id, field: "voyageNo" },
    });
    expect(data.voyageNo).toBe(voyageFact?.value);
  });

  it("stores the planner input and output, and the output is the domain planner's", async () => {
    await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const calc = await latestCalc();
    const input = BunkerPlanInput.parse(calc.inputs);
    expect(input.options.map((o) => o.quoteId)).toEqual(quoteIds);
    expect(input.options.map((o) => o.optionId)).toEqual(["MTMLA-kestrel", "GIGIB-straitline"]);
    // Same as building the input from the world directly, and the output recomputes identically.
    const world = await loadWorld(db);
    const voyageId = world.voyages.find((v) => v.voyageNo === "AP-2611")?.id;
    if (!voyageId) throw new Error("demo voyage missing");
    const offers = input.options.map((o) => ({
      optionId: o.optionId,
      quoteId: o.quoteId,
      supplierId: o.supplierId,
      portId: o.portId,
      currency: o.currency,
      pricePerMt: o.pricePerMt,
      bargeFee: o.bargeFee,
      qtyMt: o.offeredQtyMt,
    }));
    expect(buildBunkerPlanInput(world, voyageId, offers)).toEqual(input);
    expect(calc.outputs).toEqual(planBunkers(input));
  });

  it("returns a calculation fact per option field, with the calculation path", async () => {
    const result = await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const calc = await latestCalc();
    const plan = BunkerPlan.parse(calc.outputs);
    for (const f of result.facts) {
      expect(() => Fact.parse(f)).not.toThrow();
      expect(FactId.safeParse(f.id).success).toBe(true);
      expect(f.label).not.toMatch(/\d/);
    }
    plan.options.forEach((o, i) => {
      for (const field of [
        "headlinePriceUsdPerMt",
        "totalCostUsd",
        "delayHours",
        "etsCostUsd",
        "rank",
        "feasible",
        "qtyMt",
      ] as const) {
        const f = result.facts.find(
          (x) => x.id === `f_plan_bunkering_${calc.id}_options.${i}.${field}`,
        );
        expect(f, `${o.optionId} ${field}`).toBeDefined();
        expect(f?.value).toBe(o[field]);
        expect(f?.label).toContain(o.optionId);
        expect(f?.provenance).toEqual({
          source: "calculation",
          calculationId: calc.id,
          calculator: "planBunkers",
          path: `options[${i}].${field}`,
        });
      }
    });
  });

  it("with no received quotes it returns a fact-free result saying so", async () => {
    await db`update quotes set status = 'expired' where id in ${db(quoteIds)}`;
    const before = await db`select count(*)::int as n from calculations`;
    const result = await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    expect(result.facts).toEqual([]);
    expect(JSON.stringify(result.data)).toMatch(/no received quotes/i);
    const after = await db`select count(*)::int as n from calculations`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("a vessel with no open requirement gets a fact-free result", async () => {
    const result = await planBunkering(ctx(), { vessel: "Thessaly Star" });
    expect(result.facts).toEqual([]);
    expect(JSON.stringify(result.data)).toMatch(/no open bunker requirement/i);
  });
});
