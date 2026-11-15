/**
 * `get_emissions`: for a vessel's current voyage, the CO₂ of the fuel still to burn (from the
 * fuel-on-board projection of the remaining legs), its EU ETS cost, and the CII rating of the voyage
 * as planned (whole-voyage CO₂ over the planned distance). Every number comes from the domain
 * calculators (`co2Tonnes`, `etsCost`, `ciiRating`) and the result is stored as one calculation.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { currentVoyage, fobProjectionInput, loadWorld, voyageState } from "@pharos/db";
import {
  ciiRating,
  co2Tonnes,
  etsCost,
  etsCoverage,
  projectFuelOnBoard,
  remainingFobLegs,
  totalNm,
} from "@pharos/domain";
import {
  type CiiInput,
  EmissionsInput,
  type EtsCostInput,
  type Fact,
  type ToolResult,
} from "@pharos/shared";
import {
  calcFact,
  dbFact,
  findVessel,
  insertCalculation,
  runTool,
  type ToolContext,
} from "./common.js";

export const TOOL = "get_emissions";

/** g CO₂ per dwt and nautical mile, the unit of attained and required CII. */
const CII_UNIT = "g CO₂/dwt·nm";

export function getEmissions(ctx: ToolContext, input: EmissionsInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const vessel = findVessel(world, input.vessel);
    const voyage = currentVoyage(world, vessel.id);
    if (!voyage) {
      return {
        facts: [],
        data: { vessel: vessel.name, message: `${vessel.name} has no current voyage.` },
      };
    }
    const { path, remainingLegs } = voyageState(world, voyage.id);
    const rate = (key: string): number => {
      const r = world.referenceRates.find((x) => x.key === key);
      if (!r) throw new Error(`No ${key} reference rate.`);
      return r.value;
    };
    // The same year and rates the bunker planner prices ETS with.
    const year = world.meta.anchor.getUTCFullYear();

    const remainingFob = fobProjectionInput(world, voyage.id, remainingLegs);
    const voyageFob = fobProjectionInput(world, voyage.id, remainingFobLegs(path, 0));
    const co2T = co2Tonnes(projectFuelOnBoard(remainingFob).requiredMt);
    const voyageCo2T = co2Tonnes(projectFuelOnBoard(voyageFob).requiredMt);
    const voyageNm = totalNm(path);
    const coverage = etsCoverage(path.origin.isEu, path.destination.isEu);
    const etsInput: EtsCostInput = {
      co2T,
      coverage,
      year,
      euaPriceEur: rate("EUA"),
      eurUsd: rate("EURUSD"),
    };
    const ciiInput: CiiInput = {
      shipType: vessel.shipType,
      dwt: vessel.dwt,
      co2T: voyageCo2T,
      distanceNm: voyageNm,
      year,
    };
    const ets = etsCost(etsInput);
    const cii = ciiRating(ciiInput);
    const outputs = { co2T, etsCoverage: coverage, ets, voyageCo2T, voyageNm, cii };

    const calculationId = await insertCalculation(ctx, {
      kind: "emissions",
      inputs: { remaining: remainingFob, voyage: voyageFob, ets: etsInput, cii: ciiInput },
      outputs,
      voyageId: voyage.id,
    });
    const ref = { id: calculationId, calculator: "emissions" };
    const v = vessel.name;
    const facts: Fact[] = [
      calcFact(
        TOOL,
        ref,
        "co2T",
        `${v}: CO₂ from the fuel still needed this voyage`,
        co2T,
        "t CO₂",
      ),
      calcFact(TOOL, ref, "etsCoverage", `${v}: EU ETS coverage of the voyage`, coverage, null),
      calcFact(TOOL, ref, "ets.phaseIn", "EU ETS phase-in share for the year", ets.phaseIn, null),
      calcFact(
        TOOL,
        ref,
        "ets.coveredCo2T",
        `${v}: CO₂ covered by the EU ETS for the rest of the voyage`,
        ets.coveredCo2T,
        "t CO₂",
      ),
      calcFact(
        TOOL,
        ref,
        "ets.costEur",
        `${v}: EU ETS cost for the rest of the voyage, in EUR`,
        ets.costEur,
        "EUR",
      ),
      calcFact(
        TOOL,
        ref,
        "ets.costUsd",
        `${v}: EU ETS cost for the rest of the voyage, in USD`,
        ets.costUsd,
        "USD",
      ),
      calcFact(
        TOOL,
        ref,
        "voyageCo2T",
        `${v}: CO₂ of the whole voyage as planned`,
        voyageCo2T,
        "t CO₂",
      ),
      calcFact(
        TOOL,
        ref,
        "voyageNm",
        `${v}: distance of the whole voyage as planned`,
        voyageNm,
        "nm",
      ),
      calcFact(
        TOOL,
        ref,
        "cii.rating",
        `${v}: CII rating of the voyage as planned`,
        cii.rating,
        null,
      ),
      calcFact(
        TOOL,
        ref,
        "cii.attained",
        `${v}: attained CII of the voyage as planned`,
        cii.attained,
        CII_UNIT,
      ),
      calcFact(
        TOOL,
        ref,
        "cii.required",
        `${v}: required CII for the year`,
        cii.required,
        CII_UNIT,
      ),
      calcFact(TOOL, ref, "calculationId", "Emissions calculation id", calculationId, null),
      dbFact(
        TOOL,
        { table: "voyages", rowId: voyage.id, field: "voyageNo" },
        "Current voyage number",
        voyage.voyageNo,
        null,
      ),
    ];
    return {
      facts,
      data: {
        calculationId,
        vessel: v,
        voyageNo: voyage.voyageNo,
        ciiRating: cii.rating,
        note: "CO₂ and ETS cost cover the rest of the voyage; the CII rating covers the whole voyage as planned.",
      },
    };
  });
}

export function emissionsTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Emissions of a vessel's current voyage: CO₂ from the fuel still to burn, the EU ETS cost of " +
      "it (EUR and USD, with coverage and phase-in), and the CII rating of the voyage as planned " +
      "(attained and required CII). Stores the result as a calculation; returns citable facts.",
    inputSchema: EmissionsInput,
    run: async (input) => JSON.stringify(await getEmissions(ctx, input)),
  });
}
