/**
 * `plan_route_speed`: route and speed advice for a fleet vessel's current voyage, or for a ship
 * seen on AIS sailing to a named port. `planRouteSpeed` builds the optimiser input and runs
 * `optimiseRouteSpeed` (packages/domain); this tool only turns the result into citable facts.
 * The result is advice: nothing is ordered or sent.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type Fact, type NavHazard, PlanRouteSpeedInput, type ToolResult } from "@pharos/shared";
import { CALCULATION_ID_PATH, routeSpeedFactRows, WEATHER_RUN_PATH } from "../../routing/facts.js";
import { type PlannedRoute, planRouteSpeed } from "../../routing/plan.js";
import { calcFact, dbFact, factId, runTool, type ToolContext } from "./common.js";

export const TOOL = "plan_route_speed";
const CALCULATOR = "route_speed";

export const ROUTE_NOTE =
  "This is advice from a deterministic calculation. Nothing has been ordered or sent; a voyage change needs a human to approve a proposal.";

/** Facts for the reported hazards the plan touches or goes round (labels are untrusted AIS text). */
function hazardFacts(planned: PlannedRoute): Fact[] {
  const { plan, response, hazards } = planned;
  const best = response.result.options.find(
    (o) => o.candidateId === response.result.bestCandidateId,
  );
  const ids = new Set([
    ...(best?.hazardIds ?? []),
    ...response.result.baseline.hazardIds,
    ...plan.avoidedHazardIds,
  ]);
  const facts: Fact[] = [];
  for (const id of [...ids].sort()) {
    const row: NavHazard | undefined = hazards.find((h) => h.id === id);
    const zone = plan.input.hazards.find((z) => z.id === id);
    if (!row) continue;
    const labelFact: Fact =
      row.source === "ais" && row.mmsi
        ? {
            id: factId(TOOL, id, "nav_hazards.label"),
            label: `Reported hazard ${id}`,
            value: row.label,
            unit: null,
            provenance: { source: "ais", mmsi: row.mmsi, ts: row.observedAt.toISOString() },
          }
        : dbFact(
            TOOL,
            { table: "nav_hazards", rowId: id, field: "label" },
            `Reported hazard ${id}`,
            row.label,
            null,
          );
    facts.push(labelFact);
    if (zone) {
      facts.push(
        dbFact(
          TOOL,
          { table: "nav_hazards", rowId: id, field: "radiusNm" },
          `Reported hazard ${id}: keep-out radius`,
          zone.radiusNm,
          "nm",
        ),
      );
    }
  }
  for (const id of plan.avoidedHazardIds) {
    facts.push(
      dbFact(
        TOOL,
        { table: "nav_hazards", rowId: id, field: "id" },
        `${plan.subject}: reported hazard avoided by the recommended route`,
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
    const calc = { id: response.calculationId, calculator: CALCULATOR };
    const rows = routeSpeedFactRows(plan, response.result, snapshot, {
      mmsi: planned.mmsi,
      calculationId: response.calculationId,
    });
    const facts: Fact[] = rows.map((r) => {
      if (r.path === WEATHER_RUN_PATH && snapshot) {
        return {
          id: factId(TOOL, response.calculationId, r.path),
          label: r.label,
          value: r.value,
          unit: r.unit,
          provenance: {
            source: "weather",
            snapshotId: snapshot.id,
            modelRun: snapshot.modelRun.toISOString(),
          },
        };
      }
      if (r.path === CALCULATION_ID_PATH) {
        return dbFact(
          TOOL,
          { table: "calculations", rowId: response.calculationId, field: "id" },
          r.label,
          r.value,
          r.unit,
        );
      }
      return calcFact(TOOL, calc, r.path, r.label, r.value, r.unit);
    });
    facts.push(...hazardFacts(planned));
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
