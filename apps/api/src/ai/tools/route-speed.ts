/**
 * `plan_route_speed`: route and speed advice for a fleet vessel's current voyage, or for a ship
 * seen on AIS sailing to a named port. `planRouteSpeed` builds the optimiser input and runs
 * `optimiseRouteSpeed` (packages/domain); this tool only turns the result into citable facts.
 * The result is advice: nothing is ordered or sent.
 */
import { PlanRouteSpeedInput, type ToolResult } from "@pharos/shared";
import { ROUTE_TOOL, routePlanFacts } from "../../routing/facts.js";
import { planRouteSpeed } from "../../routing/plan.js";
import { addSubject, runTool, type ToolContext } from "./common.js";
import { defineTool } from "./define.js";

export const TOOL = ROUTE_TOOL;

export const ROUTE_NOTE =
  "This is advice from a deterministic calculation. Nothing has been ordered or sent; a voyage change needs a human to approve a proposal.";

export function planRouteSpeedFacts(ctx: ToolContext, input: PlanRouteSpeedInput) {
  return runTool(ctx, TOOL, input, async (): Promise<ToolResult> => {
    const planned = await planRouteSpeed({ sql: ctx.sql, now: ctx.now }, input);
    const { response } = planned;
    if (planned.vesselId !== null) addSubject(ctx, { kind: "vessel", vesselId: planned.vesselId });
    else if (planned.mmsi !== null) addSubject(ctx, { kind: "ais", mmsi: planned.mmsi });
    return {
      facts: routePlanFacts(planned),
      data: {
        calculationId: response.calculationId,
        bestCandidateId: response.result.bestCandidateId,
        note: ROUTE_NOTE,
      },
    };
  });
}

export const planRouteSpeedDef = defineTool({
  name: TOOL,
  description:
    "Plan route and speed for a vessel: the fleet vessel's current voyage, or a ship seen on AIS " +
    "(by name or 9-digit MMSI) sailing to a destination you name. Compares the planned or reported " +
    "route and speed with up to two sea routes, using the latest weather forecast and reported " +
    "hazards, and returns per route the distance, recommended speed, ETA, fuel, CO2, FuelEU " +
    "Maritime exposure, total cost and weather delay, plus the saving against the current plan, " +
    "and the load the fuel figures assume (displacement and load factor; for a ship seen on AIS, " +
    "its reported draught and the load condition taken from it). Returns citable facts. " +
    "Advice only: nothing is ordered or sent.",
  inputSchema: PlanRouteSpeedInput,
  run: planRouteSpeedFacts,
});
