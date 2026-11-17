/**
 * `get_vessel_status`: a vessel's fuel on board (latest noon report), its fuel on board along the
 * rest of the current plan (the one fuel calculation, `projectFuelAlongTrack` via
 * `currentPlanFuel`, on the latest weather snapshot; stored as a calculation), and its next port call.
 */
import { currentPlanFuel, currentVoyage, loadWorld, TRACK_STEP_NM } from "@pharos/db";
import { DOMAIN_CODE_VERSION } from "@pharos/domain";
import { latestWeatherSnapshot } from "@pharos/integrations";
import {
  type Fact,
  FUEL_GRADES,
  type FuelGrade,
  type ToolResult,
  VesselStatusInput,
} from "@pharos/shared";
import { calcFact } from "../../facts/core.js";
import { VESSEL_TOOL, vesselRowFacts } from "../../facts/vessel.js";
import { addSubject, findVessel, json, runTool, type ToolContext } from "./common.js";
import { defineTool } from "./define.js";

export const TOOL = VESSEL_TOOL;

export function getVesselStatus(ctx: ToolContext, input: VesselStatusInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const vessel = findVessel(world, input.vessel);
    addSubject(ctx, { kind: "vessel", vesselId: vessel.id });
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
    if (!row.robMt || !row.voyageNo) throw new Error("a vessel with a voyage has no fuel facts");
    facts.push(...FUEL_GRADES.map((g) => (row.robMt as Record<FuelGrade, Fact>)[g]), row.voyageNo);

    const snapshot = await latestWeatherSnapshot(ctx.sql);
    const track = currentPlanFuel(world, voyage.id, snapshot?.grid ?? null);
    const per = <T>(f: (g: FuelGrade) => T) =>
      Object.fromEntries(FUEL_GRADES.map((g) => [g, f(g)])) as Record<FuelGrade, T>;
    // The flat fields keep the fact paths get_vessel_status has always cited; `track` is the whole
    // projection (breakpoints, probes) for anything that needs more.
    const fob = {
      requiredMt: per((g) => track.grades[g].neededMt),
      safetyMarginMt: per((g) => track.grades[g].marginMt),
      shortfallMt: per((g) => track.grades[g].shortfallMt),
      belowMarginAtNm: per((g) => track.grades[g].belowMarginAt?.nm ?? null),
      belowMarginAt: per((g) => track.grades[g].belowMarginAt?.at ?? null),
      runsDryAtNm: per((g) => track.grades[g].runsDryAt?.nm ?? null),
      runsDryAt: per((g) => track.grades[g].runsDryAt?.at ?? null),
      track,
    };
    const inputs = {
      voyageId: voyage.id,
      stepNm: TRACK_STEP_NM,
      weatherSnapshotId: snapshot?.id ?? null,
    };
    const [calc] = await ctx.sql<{ id: number }[]>`
      insert into calculations (kind, inputs, outputs, code_version, voyage_id, weather_snapshot_id, created_at)
      values ('fob_projection', ${json(inputs)}::jsonb, ${json(fob)}::jsonb, ${DOMAIN_CODE_VERSION},
              ${voyage.id}, ${snapshot?.id ?? null}, ${ctx.now().toISOString()}::timestamptz)
      returning id`;
    if (!calc) throw new Error("calculations insert returned no row");
    const ref = { id: calc.id, calculator: "projectFuelAlongTrack" };
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
      const below = fob.belowMarginAtNm[g];
      const belowAt = fob.belowMarginAt[g];
      if (below !== null && belowAt !== null) {
        facts.push(
          calcFact(
            TOOL,
            ref,
            `belowMarginAtNm.${g}`,
            `${g} drops below its safety margin, distance along the current plan`,
            below,
            "nm",
          ),
          calcFact(
            TOOL,
            ref,
            `belowMarginAt.${g}`,
            `${g} drops below its safety margin at (UTC)`,
            belowAt,
            null,
          ),
        );
      }
      const dry = fob.runsDryAtNm[g];
      const dryAt = fob.runsDryAt[g];
      if (dry !== null && dryAt !== null) {
        facts.push(
          calcFact(
            TOOL,
            ref,
            `runsDryAtNm.${g}`,
            `${g} runs out, distance along the current plan`,
            dry,
            "nm",
          ),
          calcFact(TOOL, ref, `runsDryAt.${g}`, `${g} runs out at (UTC)`, dryAt, null),
        );
      }
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
        gradesBelowMargin: FUEL_GRADES.filter((g) => fob.belowMarginAtNm[g] !== null),
        gradesRunningOut: FUEL_GRADES.filter((g) => fob.runsDryAtNm[g] !== null),
        nextPortCall:
          next && row.nextPort ? { port: row.nextPort.value, purpose: next.purpose } : null,
      },
    };
  });
}

export const vesselStatusDef = defineTool({
  name: TOOL,
  description:
    "Fuel status of one fleet vessel: remaining on board per grade from the latest noon report, " +
    "fuel on board along the rest of the current plan at the planned speed (fuel needed, safety " +
    "margin, shortfall per grade, and where a grade drops below its margin or runs out), and the " +
    "next port call with its ETA. Returns citable facts.",
  inputSchema: VesselStatusInput,
  run: getVesselStatus,
});
