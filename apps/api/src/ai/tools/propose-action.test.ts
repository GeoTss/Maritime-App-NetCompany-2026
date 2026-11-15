import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { BunkerPlan, type Fact, ProposeActionInput } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext, type ToolContext } from "./common.js";
import { planBunkering } from "./plan-bunkering.js";
import { proposeAction, proposeActionTool } from "./propose-action.js";
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
    const { description } = proposeActionTool(ctx) as { description?: string };
    expect(description).toMatch(/only when the operator asks you to decide/);
    expect(description).toMatch(/never when they only look something up, compare/);
  });

  it("rejects a model-typed quantity, price or speed (strict input)", () => {
    const tool = proposeActionTool(ctx);
    for (const extra of [{ qtyMt: 300 }, { pricePerMt: 700 }, { speedKn: 11 }]) {
      expect(() => ProposeActionInput.parse({ ...valid(), ...extra })).toThrow();
      expect(() => tool.parse?.({ ...valid(), ...extra })).toThrow();
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

  it("a feasible option that is not the best is proposed without an expected saving", async () => {
    const other = plan.options.find((o) => o.feasible && o.optionId !== plan.bestOptionId);
    expect(other).toBeDefined();
    if (!other) throw new Error("the demo plan has no second feasible option");
    await proposeAction(ctx, { ...valid(), optionId: other.optionId });
    const [row] = await recommendations();
    expect(row?.expected_saving_usd).toBeNull();
  });

  it("only bunker plans back a purchase order; voyage instructions are not supported yet", async () => {
    await expect(proposeAction(ctx, { ...valid(), type: "voyage_instruction" })).rejects.toThrow(
      /voyage_instruction/,
    );
  });
});
