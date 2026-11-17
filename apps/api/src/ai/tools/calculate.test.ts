import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DOMAIN_CODE_VERSION } from "@pharos/domain";
import { CalculateInput, Fact } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { calculate, calculateDef } from "./calculate.js";
import { createToolContext, type ToolContext } from "./common.js";

const sql = await connectTestDb("ask_calculate");

if (!sql) {
  describe("calculate (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_calculate")}`, () => {});
  });
}

/** A fact as an earlier tool returned it (db provenance; the value is what matters here). */
const known = (id: string, label: string, value: number | string, unit: string | null): Fact => ({
  id,
  label,
  value,
  unit,
  provenance: { source: "db", table: "quote_lines", rowId: 1, field: "pricePerMt" },
});

const KESTREL = known("f_test_1_kestrel", "Kestrel headline price", 738, "USD/mt");
const STRAIT = known("f_test_2_strait", "Strait Line headline price", 712, "USD/mt");
const EUR_FEE = known("f_test_3_fee", "Nordwind barge fee", 3000, "EUR");
const SUPPLIER = known("f_test_4_supplier", "Kestrel supplier", "Kestrel Marine Fuels", null);

describe.skipIf(!sql)("calculate (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  let ctx: ToolContext;

  beforeEach(async () => {
    await prepareAskFixture(db);
    ctx = createToolContext({
      sql: db,
      now: () => ASK_FIXTURE_NOW,
      priorFacts: [KESTREL, STRAIT, EUR_FEE, SUPPLIER],
    });
  });
  afterAll(async () => {
    await db.end();
  });

  const calcRows = () =>
    db<
      {
        id: number;
        kind: string;
        inputs: unknown;
        outputs: unknown;
        code_version: string;
        voyage_id: number | null;
        operand_fact_ids: string[] | null;
      }[]
    >`select id, kind, inputs, outputs, code_version, voyage_id, operand_fact_ids
      from calculations order by id`;

  it("subtracts two ledger facts in domain code and stores the calculation with its lineage", async () => {
    const result = await calculate(ctx, { op: "subtract", operands: [KESTREL.id, STRAIT.id] });
    const rows = await calcRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      kind: "calculate",
      code_version: DOMAIN_CODE_VERSION,
      voyage_id: null,
      operand_fact_ids: [KESTREL.id, STRAIT.id],
      outputs: { value: 26, unit: "USD/mt" },
      inputs: {
        op: "subtract",
        operands: [
          { factId: KESTREL.id, value: 738, unit: "USD/mt" },
          { factId: STRAIT.id, value: 712, unit: "USD/mt" },
        ],
      },
    });

    expect(result.facts).toHaveLength(1);
    const fact = Fact.parse(result.facts[0]);
    expect(fact).toEqual({
      id: `f_calc:${row?.id}:value`,
      label: "subtract of Kestrel headline price and Strait Line headline price",
      value: 26,
      unit: "USD/mt",
      provenance: { source: "derived", operation: "subtract", operands: [KESTREL.id, STRAIT.id] },
    });
    // The derived fact joins the ledger, so the answer (and a later calculate) can use it.
    expect(ctx.ledger.get(fact.id)).toEqual(fact);
    expect(result.data).toMatchObject({ calculationId: row?.id, factId: fact.id, op: "subtract" });
  });

  it("an unknown operand is a tool error the model sees, and stores no calculation", async () => {
    await expect(
      calculate(ctx, { op: "subtract", operands: [KESTREL.id, "f_plan_bunkering_99_x"] }),
    ).rejects.toThrow(/f_plan_bunkering_99_x.*not returned earlier in this conversation/);
    expect(await calcRows()).toHaveLength(0);
    expect(ctx.calls.at(-1)).toMatchObject({ tool: "calculate", isError: true });
  });

  it("a non-numeric operand is a tool error, and stores no calculation", async () => {
    await expect(
      calculate(ctx, { op: "add", operands: [KESTREL.id, SUPPLIER.id] }),
    ).rejects.toThrow(/f_test_4_supplier.*not a number/);
    expect(await calcRows()).toHaveLength(0);
  });

  it("a unit mismatch from the domain is a tool error, and stores no calculation", async () => {
    await expect(calculate(ctx, { op: "add", operands: [KESTREL.id, EUR_FEE.id] })).rejects.toThrow(
      /unit_mismatch/,
    );
    expect(await calcRows()).toHaveLength(0);
  });

  it("difference and percent_change give derived facts that parse", async () => {
    const diff = await calculate(ctx, { op: "difference", operands: [STRAIT.id, KESTREL.id] });
    expect(diff.facts[0]).toMatchObject({ value: 26, unit: "USD/mt" });
    expect(() => Fact.parse(diff.facts[0])).not.toThrow();
    const pct = await calculate(ctx, { op: "percent_change", operands: [STRAIT.id, KESTREL.id] });
    expect(pct.facts[0]?.unit).toBe("%");
    expect(pct.facts[0]?.value as number).toBeCloseTo(3.6517, 4);
    expect(pct.facts[0]?.label).toBe(
      "percent_change of Strait Line headline price and Kestrel headline price",
    );
  });

  it("a derived fact can be an operand of a later calculate", async () => {
    const first = await calculate(ctx, { op: "subtract", operands: [KESTREL.id, STRAIT.id] });
    const id = first.facts[0]?.id ?? "";
    const again = await calculate(ctx, { op: "sum", operands: [id, id, STRAIT.id] });
    expect(again.facts[0]?.value).toBe(764);
    const [, second] = await calcRows();
    expect(second?.operand_fact_ids).toEqual([id, id, STRAIT.id]);
  });

  it("its description makes a percentage difference one percent_change call, cited, with no extra divide", () => {
    const { description } = calculateDef;
    expect(description).toMatch(/percentage difference is one percent_change call/);
    expect(description).toMatch(/cite the fact it returns and do not also divide/);
  });

  it("input is strict: fact ids only, and binary ops take exactly two", () => {
    expect(() => CalculateInput.parse({ op: "subtract", operands: [738, 712] })).toThrow();
    expect(() =>
      calculateDef.inputSchema.parse({
        op: "subtract",
        operands: [KESTREL.id, STRAIT.id, EUR_FEE.id],
      }),
    ).toThrow();
    expect(() =>
      calculateDef.inputSchema.parse({ op: "add", operands: [KESTREL.id], value: 5 }),
    ).toThrow();
  });
});
