/**
 * `plan_route_speed`: route and speed advice for a fleet vessel's current voyage, or for a ship
 * seen on AIS sailing to a named port. `planRouteSpeed` builds the optimiser input and runs
 * `optimiseRouteSpeed` (packages/domain); this tool only turns the result into citable facts.
 * The result is advice: nothing is ordered or sent.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type Fact, PlanRouteSpeedInput, type ToolResult } from "@pharos/shared";
import {
  ROUTE_TOOL,
  routeFactOfRow,
  routeSpeedFactRows,
  subjectLabel,
} from "../../routing/facts.js";
import { type PlannedRoute, planRouteSpeed } from "../../routing/plan.js";
import { dbFact, runTool, type ToolContext } from "./common.js";

export const TOOL = ROUTE_TOOL;

export const ROUTE_NOTE =
  "This is advice from a deterministic calculation. Nothing has been ordered or sent; a voyage change needs a human to approve a proposal.";

/** Facts for the reported hazards the plan touches or goes round (labels are untrusted text). */
function hazardFacts(planned: PlannedRoute, S: string): Fact[] {
  const { plan, response, hazards } = planned;
  const calculationId = response.calculationId;
  const best = response.result.options.find(
    (o) => o.candidateId === response.result.bestCandidateId,
  );
  const avoided = [...plan.avoidedHazardIds].sort();
  const ids = new Set([
    ...(best?.hazardIds ?? []),
    ...response.result.baseline.hazardIds,
    ...avoided,
  ]);
  const facts: Fact[] = [];
  for (const id of [...ids].sort()) {
    const row = hazards.find((h) => h.id === id);
    if (!row) continue;
    facts.push(
      dbFact(
        TOOL,
        { table: "nav_hazards", rowId: id, field: "label" },
        `Reported hazard ${id}`,
        row.label,
        null,
      ),
    );
    // The radius is the stored zone the optimiser used, not the (possibly unset) hazard column.
    const zone = plan.input.hazards.findIndex((z) => z.id === id);
    const stored = plan.input.hazards[zone];
    if (stored) {
      facts.push(
        dbFact(
          TOOL,
          {
            table: "calculations",
            rowId: calculationId,
            field: `inputs.optimiser.hazards.${zone}.radiusNm`,
          },
          `Reported hazard ${id}: keep-out radius`,
          stored.radiusNm,
          "nm",
        ),
      );
    }
  }
  for (const id of avoided) {
    facts.push(
      dbFact(
        TOOL,
        { table: "nav_hazards", rowId: id, field: "id" },
        `${S}: reported hazard avoided by the recommended route`,
        id,
        null,
      ),
    );
  }
  return facts;
}

export function planRouteSpeedFacts(ctx: ToolContext, input: PlanRouteSpeedInput) {
  return runTool(ctx, TOOL, input, async (): Promise<ToolResult> => {
    const planned = await planRouteSpeed({ sql: ctx.sql, now: ctx.now }, input);
    const { response, plan, snapshot } = planned;
    const calculationId = response.calculationId;
    const S = subjectLabel(plan, planned.mmsi);
    const rows = routeSpeedFactRows(plan, response.result, snapshot, {
      mmsi: planned.mmsi,
      calculationId,
    });
    const facts: Fact[] = rows.map((r) => routeFactOfRow(calculationId, r, snapshot));
    if (planned.mmsi && plan.subject !== S) {
      facts.push(
        dbFact(
          TOOL,
          { table: "ais_traffic", rowId: planned.mmsi, field: "name" },
          `${S}: AIS ship name`,
          plan.subject,
          null,
        ),
      );
    }
    facts.push(...hazardFacts(planned, S));
    return {
      facts,
      data: {
        calculationId: response.calculationId,
        bestCandidateId: response.result.bestCandidateId,
        note: ROUTE_NOTE,
      },
    };
  });
}

export function planRouteSpeedTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Plan route and speed for a vessel: the fleet vessel's current voyage, or a ship seen on AIS " +
      "(by name or 9-digit MMSI) sailing to a destination you name. Compares the planned or reported " +
      "route and speed with up to two sea routes, using the latest weather forecast and reported " +
      "hazards, and returns per route the distance, recommended speed, ETA, fuel, CO2, total cost " +
      "and weather delay, plus the saving against the current plan. Returns citable facts. " +
      "Advice only: nothing is ordered or sent.",
    inputSchema: PlanRouteSpeedInput,
    run: async (input) => JSON.stringify(await planRouteSpeedFacts(ctx, input)),
  });
}
