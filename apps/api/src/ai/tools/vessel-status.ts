/**
 * `get_vessel_status`: a vessel's fuel on board (latest noon report), its fuel-on-board projection
 * over the rest of the voyage (computed by `projectFuelOnBoard`, stored as a calculation), and its
 * next port call.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { currentVoyage, fobProjectionInput, loadWorld, voyageState } from "@pharos/db";
import { DOMAIN_CODE_VERSION, projectFuelOnBoard } from "@pharos/domain";
import { type Fact, FUEL_GRADES, type ToolResult, VesselStatusInput } from "@pharos/shared";
import { calcFact, dbFact, findVessel, json, runTool, type ToolContext } from "./common.js";

export const TOOL = "get_vessel_status";

export function getVesselStatus(ctx: ToolContext, input: VesselStatusInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const vessel = findVessel(world, input.vessel);
    const facts: Fact[] = [
      dbFact(
        TOOL,
        { table: "vessels", rowId: vessel.id, field: "name" },
        "Vessel name",
        vessel.name,
        null,
      ),
      dbFact(
        TOOL,
        { table: "vessels", rowId: vessel.id, field: "imo" },
        `IMO of ${vessel.name}`,
        vessel.imo,
        null,
      ),
    ];
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
    const { report, remainingLegs } = voyageState(world, voyage.id);
    facts.push(
      ...FUEL_GRADES.map((g) =>
        dbFact(
          TOOL,
          { table: "noon_reports", rowId: report.id, field: `robMt.${g}` },
          `${g} remaining on board (latest noon report)`,
          report.robMt[g],
          "mt",
        ),
      ),
      dbFact(
        TOOL,
        { table: "voyages", rowId: voyage.id, field: "voyageNo" },
        "Current voyage number",
        voyage.voyageNo,
        null,
      ),
    );

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

    const now = ctx.now().getTime();
    const next = world.portCalls
      .filter((c) => c.voyageId === voyage.id && c.eta.getTime() >= now)
      .sort((a, b) => a.eta.getTime() - b.eta.getTime())[0];
    const nextPort = next ? world.ports.find((p) => p.id === next.portId) : undefined;
    if (next && nextPort) {
      facts.push(
        dbFact(
          TOOL,
          { table: "ports", rowId: nextPort.id, field: "name" },
          "Next port",
          nextPort.name,
          null,
        ),
        dbFact(
          TOOL,
          { table: "port_calls", rowId: next.id, field: "eta" },
          `ETA at ${nextPort.name} (UTC)`,
          next.eta.toISOString(),
          null,
        ),
      );
    }

    return {
      facts,
      data: {
        vessel: { name: vessel.name, imo: vessel.imo },
        voyage: { voyageNo: voyage.voyageNo, status: voyage.status },
        fobCalculationId: calc.id,
        gradesBelowMargin: FUEL_GRADES.filter((g) => fob.belowMarginAtLeg[g] !== null),
        nextPortCall: next && nextPort ? { port: nextPort.name, purpose: next.purpose } : null,
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
