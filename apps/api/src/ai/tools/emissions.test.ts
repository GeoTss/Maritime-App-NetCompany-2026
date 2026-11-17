import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { ciiRating, co2Tonnes, etsCost, projectFuelOnBoard } from "@pharos/domain";
import {
  CiiInput,
  EmissionsInput,
  EtsCostInput,
  Fact,
  FactId,
  FobProjectionInput,
} from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { emissionsDef, getEmissions } from "./emissions.js";

const sql = await connectTestDb("ask_emissions");

if (!sql) {
  describe("get_emissions (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_emissions")}`, () => {});
  });
}

describe.skipIf(!sql)("get_emissions (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  beforeAll(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const latestCalc = async () => {
    const [row] = await db<
      { id: number; kind: string; inputs: Record<string, unknown>; outputs: unknown }[]
    >`select id, kind, inputs, outputs from calculations order by id desc limit 1`;
    if (!row) throw new Error("no calculation stored");
    return row;
  };

  it("input is strict", () => {
    expect(() => EmissionsInput.parse({ vessel: "Aegean Pioneer", year: 2026 })).toThrow();
    expect(() => emissionsDef.inputSchema.parse({})).toThrow();
  });

  it("stores an emissions calculation whose outputs are the domain calculators' over its inputs", async () => {
    const result = await getEmissions(ctx(), { vessel: "Aegean Pioneer" });
    const calc = await latestCalc();
    expect(calc.kind).toBe("emissions");
    const remaining = FobProjectionInput.parse(calc.inputs.remaining);
    const voyage = FobProjectionInput.parse(calc.inputs.voyage);
    const ets = EtsCostInput.parse(calc.inputs.ets);
    const cii = CiiInput.parse(calc.inputs.cii);

    const co2T = co2Tonnes(projectFuelOnBoard(remaining).requiredMt);
    const voyageCo2T = co2Tonnes(projectFuelOnBoard(voyage).requiredMt);
    expect(ets.co2T).toBe(co2T);
    expect(cii.co2T).toBe(voyageCo2T);
    expect(cii).toMatchObject({ shipType: "bulk_carrier", dwt: 58000 });
    expect(calc.outputs).toMatchObject({
      co2T,
      voyageCo2T,
      voyageNm: cii.distanceNm,
      etsCoverage: ets.coverage,
      ets: etsCost(ets),
      cii: ciiRating(cii),
    });
    // The remaining voyage is part of the whole one.
    expect(co2T).toBeGreaterThan(0);
    expect(co2T).toBeLessThanOrEqual(voyageCo2T);

    const data = result.data as { calculationId: number; voyageNo: string; ciiRating: string };
    expect(data).toMatchObject({
      calculationId: calc.id,
      voyageNo: "AP-2611",
      ciiRating: ciiRating(cii).rating,
    });
  });

  it("returns calculation facts for CO2, ETS cost and CII, with the calculation path", async () => {
    const result = await getEmissions(ctx(), { vessel: "Aegean Pioneer" });
    const calc = await latestCalc();
    const outputs = calc.outputs as {
      co2T: number;
      ets: { costUsd: number; costEur: number };
      cii: { rating: string; attained: number; required: number };
    };
    const byPath = (path: string) => {
      const f = result.facts.find((x) => x.id === `f_get_emissions_${calc.id}_${path}`);
      expect(f, path).toBeDefined();
      expect(f?.provenance).toEqual({
        source: "calculation",
        calculationId: calc.id,
        calculator: "emissions",
        path,
      });
      return f as Fact;
    };
    expect(byPath("co2T")).toMatchObject({
      label: "MV Aegean Pioneer: CO₂ from the fuel still needed this voyage",
      value: outputs.co2T,
      unit: "t CO₂",
    });
    expect(byPath("ets.costUsd")).toMatchObject({
      label: "MV Aegean Pioneer: EU ETS cost for the rest of the voyage, in USD",
      value: outputs.ets.costUsd,
      unit: "USD",
    });
    expect(byPath("ets.costEur")).toMatchObject({ value: outputs.ets.costEur, unit: "EUR" });
    expect(byPath("cii.rating")).toMatchObject({
      label: "MV Aegean Pioneer: CII rating of the voyage as planned",
      value: outputs.cii.rating,
      unit: null,
    });
    expect(byPath("cii.attained").value).toBe(outputs.cii.attained);
    expect(byPath("cii.required").value).toBe(outputs.cii.required);
    for (const path of [
      "ets.coveredCo2T",
      "ets.phaseIn",
      "etsCoverage",
      "voyageCo2T",
      "voyageNm",
    ]) {
      byPath(path);
    }
    expect(byPath("calculationId").value).toBe(calc.id);
    expect(result.facts.find((f) => f.id.endsWith("_voyages.voyageNo"))?.value).toBe("AP-2611");
    for (const f of result.facts) {
      expect(() => Fact.parse(f)).not.toThrow();
      expect(FactId.safeParse(f.id).success).toBe(true);
      expect(f.label).not.toMatch(/\d/);
    }
  });

  it("a planned voyage (not yet departed) has its whole voyage still to sail", async () => {
    await getEmissions(ctx(), { vessel: "Iberian Dawn" });
    const calc = await latestCalc();
    const outputs = calc.outputs as { co2T: number; voyageCo2T: number };
    expect(outputs.co2T).toBeCloseTo(outputs.voyageCo2T, 9);
  });

  it("an unknown vessel is a tool error", async () => {
    await expect(getEmissions(ctx(), { vessel: "Flying Dutchman" })).rejects.toThrow();
  });
});
