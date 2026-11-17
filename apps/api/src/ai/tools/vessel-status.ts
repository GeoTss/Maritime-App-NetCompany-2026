/**
 * `get_vessel_status`: a vessel's fuel on board (latest noon report), its fuel-on-board projection
 * over the rest of the voyage (computed by `projectFuelOnBoard`, stored as a calculation), and its
 * next port call.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { currentVoyage, fobProjectionInput, loadWorld, voyageState } from "@pharos/db";
import { DOMAIN_CODE_VERSION, projectFuelOnBoard } from "@pharos/domain";
import {
  type Fact,
  FUEL_GRADES,
  type FuelGrade,
  type ToolResult,
  VesselStatusInput,
} from "@pharos/shared";
import { calcFact } from "../../facts/core.js";
import { VESSEL_TOOL, vesselRowFacts } from "../../facts/vessel.js";
import { findVessel, json, runTool, type ToolContext } from "./common.js";

export const TOOL = VESSEL_TOOL;

export function getVesselStatus(ctx: ToolContext, input: VesselStatusInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const vessel = findVessel(world, input.vessel);
    const row = vesselRowFacts(world, vessel, ctx.now());
    const facts: Fact[] = [row.name, row.imo];
    const voyage = currentVoyage(world, vessel.id);
    if (!voyage) {
      return {
        facts,
        data: {
          vessel: { name: vessel.name, imo: vessel.imo },
          voyage: null,
          message: `${vessel.name} has no current voyage.`,
        },
      };
    }
    // The latest noon report and the legs still to sail, as the planner sees them.
    const { remainingLegs } = voyageState(world, voyage.id);
    if (!row.robMt || !row.voyageNo) throw new Error("a vessel with a voyage has no fuel facts");
    facts.push(...FUEL_GRADES.map((g) => (row.robMt as Record<FuelGrade, Fact>)[g]), row.voyageNo);

    const fobInput = fobProjectionInput(world, voyage.id, remainingLegs);
    const fob = projectFuelOnBoard(fobInput);
    const [calc] = await ctx.sql<{ id: number }[]>`
      insert into calculations (kind, inputs, outputs, code_version, voyage_id, weather_snapshot_id, created_at)
      values ('fob_projection', ${json(fobInput)}::jsonb, ${json(fob)}::jsonb, ${DOMAIN_CODE_VERSION},
              ${voyage.id}, null, ${ctx.now().toISOString()}::timestamptz)
      returning id`;
    if (!calc) throw new Error("calculations insert returned no row");
    const ref = { id: calc.id, calculator: "projectFuelOnBoard" };
    for (const g of FUEL_GRADES) {
      facts.push(
        calcFact(
          TOOL,
          ref,
          `requiredMt.${g}`,
          `${g} needed for the rest of the voyage`,
          fob.requiredMt[g],
          "mt",
        ),
        calcFact(
          TOOL,
          ref,
          `safetyMarginMt.${g}`,
          `${g} safety margin to keep on arrival`,
          fob.safetyMarginMt[g],
          "mt",
        ),
        calcFact(
          TOOL,
          ref,
          `shortfallMt.${g}`,
          `${g} shortfall to keep the margin`,
          fob.shortfallMt[g],
          "mt",
        ),
      );
    }

    if (row.nextPort && row.nextPortEta) facts.push(row.nextPort, row.nextPortEta);
    // The ETA fact's row is the next port call itself.
    const nextCallId =
      row.nextPortEta?.provenance.source === "db" ? row.nextPortEta.provenance.rowId : null;
    const next = world.portCalls.find((c) => c.id === nextCallId);

    return {
      facts,
      data: {
        vessel: { name: vessel.name, imo: vessel.imo },
        voyage: { voyageNo: voyage.voyageNo, status: voyage.status },
        fobCalculationId: calc.id,
        gradesBelowMargin: FUEL_GRADES.filter((g) => fob.belowMarginAtLeg[g] !== null),
        nextPortCall:
          next && row.nextPort ? { port: row.nextPort.value, purpose: next.purpose } : null,
      },
    };
  });
}

export function vesselStatusTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Fuel status of one fleet vessel: remaining on board per grade from the latest noon report, " +
      "the fuel-on-board projection for the rest of the current voyage (fuel needed, safety margin, " +
      "shortfall per grade), and the next port call with its ETA. Returns citable facts.",
    inputSchema: VesselStatusInput,
    run: async (input) => JSON.stringify(await getVesselStatus(ctx, input)),
  });
}
