import { buildBunkerPlanInput, loadWorld, type Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DOMAIN_CODE_VERSION, planBunkers } from "@pharos/domain";
import { BunkerPlan, BunkerPlanInput, Fact, FactId, PlanBunkeringInput } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { planBunkering } from "./plan-bunkering.js";

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

  it("input is strict; the vessel is optional", () => {
    expect(() => PlanBunkeringInput.parse({ vessel: "Aegean Pioneer", qtyMt: 300 })).toThrow();
    expect(PlanBunkeringInput.parse({})).toEqual({});
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

  it("leaves out a quote whose validity has passed (context clock, UTC day)", async () => {
    const [, straitId] = quoteIds;
    await db`update quotes set valid_until = '2026-11-13T00:00:00Z' where id = ${straitId ?? 0}`;
    await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const input = BunkerPlanInput.parse((await latestCalc()).inputs);
    expect(input.options.map((o) => o.optionId)).toEqual(["MTMLA-kestrel"]);
    // Valid through its last day.
    await db`update quotes set valid_until = '2026-11-14T00:00:00Z' where id = ${straitId ?? 0}`;
    await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const again = BunkerPlanInput.parse((await latestCalc()).inputs);
    expect(again.options.map((o) => o.optionId)).toEqual(["MTMLA-kestrel", "GIGIB-straitline"]);
  });

  it("plans each open requirement: LSMGO + VLSFO give two plans with grade-prefixed options", async () => {
    const [kestrelId] = quoteIds;
    // A VLSFO requirement on the demo voyage, and Kestrel's quote (linked to the LSMGO
    // requirement) also offering VLSFO: a multi-grade quote serves both plans.
    await db`
      insert into bunker_requirements (voyage_id, grade, qty_mt, status, created_at)
      values ((select id from voyages where voyage_no = 'AP-2611'), 'VLSFO', 200, 'open',
              ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    await db`
      insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
      values (${kestrelId ?? 0}, 'VLSFO', 200, 590)`;

    const result = await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    const data = result.data as {
      voyageNo: string;
      plans: { calculationId: number; grade: string; bestOptionId: string | null }[];
    };
    expect(data.voyageNo).toBe("AP-2611");
    expect(data.plans.map((p) => p.grade)).toEqual(["LSMGO", "VLSFO"]);

    const calcs = await db<{ id: number; kind: string; inputs: unknown; outputs: unknown }[]>`
      select id, kind, inputs, outputs from calculations order by id`;
    expect(calcs.map((c) => c.kind)).toEqual(["bunker_plan", "bunker_plan"]);
    expect(data.plans.map((p) => p.calculationId)).toEqual(calcs.map((c) => c.id));
    const [lsmgo, vlsfo] = calcs.map((c) => ({
      input: BunkerPlanInput.parse(c.inputs),
      plan: BunkerPlan.parse(c.outputs),
    }));
    expect(lsmgo?.input.grade).toBe("LSMGO");
    expect(lsmgo?.input.options.map((o) => o.optionId)).toEqual([
      "LSMGO-MTMLA-kestrel",
      "LSMGO-GIGIB-straitline",
    ]);
    expect(vlsfo?.input.grade).toBe("VLSFO");
    expect(vlsfo?.input.requiredQtyMt).toBe(200);
    expect(vlsfo?.input.options.map((o) => [o.optionId, o.pricePerMt])).toEqual([
      ["VLSFO-MTMLA-kestrel", 590],
    ]);
    expect(data.plans.map((p) => p.bestOptionId)).toEqual([
      lsmgo?.plan.bestOptionId,
      vlsfo?.plan.bestOptionId,
    ]);

    // Each plan's facts point at its own calculation, and labels say which grade they are for.
    const best = result.facts.filter((f) => f.id.endsWith("_bestOptionId"));
    expect(best.map((f) => f.label)).toEqual([
      "LSMGO plan: Best option (lowest total cost, feasible)",
      "VLSFO plan: Best option (lowest total cost, feasible)",
    ]);
    expect(best.map((f) => f.provenance)).toEqual(
      calcs.map((c) =>
        expect.objectContaining({
          source: "calculation",
          calculationId: c.id,
          path: "bestOptionId",
        }),
      ),
    );
    expect(result.facts.filter((f) => f.id.endsWith("_voyages.voyageNo"))).toHaveLength(1);
    expect(new Set(result.facts.map((f) => f.id)).size).toBe(result.facts.length);
    for (const f of result.facts) expect(f.label).not.toMatch(/\d/);
  });

  it("with no vessel it plans every vessel with an open requirement: today Aegean Pioneer, as if named", async () => {
    const unnamed = await planBunkering(ctx(), {});
    await prepareAskFixture(db); // same ids again, so the two results can be compared whole
    const named = await planBunkering(ctx(), { vessel: "Aegean Pioneer" });
    expect(unnamed).toEqual(named);
    expect(unnamed.data).toMatchObject({
      vessel: "MV Aegean Pioneer",
      bestOptionId: "MTMLA-kestrel",
    });
  });

  it("with no vessel and several vessels to plan, plans each and names the vessel in every label", async () => {
    // An open VLSFO requirement on Coral Horizon's current voyage, with no quote for it yet.
    await db`
      insert into bunker_requirements (voyage_id, grade, qty_mt, status, created_at)
      values ((select id from voyages where voyage_no = 'CH-2613'), 'VLSFO', 400, 'open',
              ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    const result = await planBunkering(ctx(), {});
    const data = result.data as { vessels: { vessel: string; calculationId?: number }[] };
    expect(data.vessels.map((v) => v.vessel)).toEqual(["MV Aegean Pioneer", "MV Coral Horizon"]);
    expect(JSON.stringify(data.vessels[1])).toMatch(/no received quotes/i);

    // Aegean Pioneer's plan is the one it gets alone (same option ids), each label scoped to it.
    const calc = await latestCalc();
    expect(data.vessels[0]?.calculationId).toBe(calc.id);
    expect(BunkerPlan.parse(calc.outputs).bestOptionId).toBe("MTMLA-kestrel");
    expect(result.facts.length).toBeGreaterThan(0);
    for (const f of result.facts) {
      expect(f.label.startsWith("MV Aegean Pioneer: ")).toBe(true);
      expect(f.label).not.toMatch(/\d/);
    }
    expect(result.facts.find((f) => f.id.endsWith("_bestOptionId"))).toMatchObject({
      value: "MTMLA-kestrel",
      label: "MV Aegean Pioneer: Best option (lowest total cost, feasible)",
    });
    expect(
      result.facts.find((f) => f.id === `f_plan_bunkering_${calc.id}_options.0.totalCostUsd`)
        ?.label,
    ).toBe(
      "MV Aegean Pioneer: MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost",
    );
  });

  it("with no vessel and no open requirement anywhere it returns a fact-free result", async () => {
    await db`update bunker_requirements set status = 'ordered' where status = 'open'`;
    const result = await planBunkering(ctx(), {});
    expect(result.facts).toEqual([]);
    expect(JSON.stringify(result.data)).toMatch(/no vessel has an open bunker requirement/i);
  });

  it("a vessel with no open requirement gets a fact-free result", async () => {
    const result = await planBunkering(ctx(), { vessel: "Thessaly Star" });
    expect(result.facts).toEqual([]);
    expect(JSON.stringify(result.data)).toMatch(/no open bunker requirement/i);
  });
});
