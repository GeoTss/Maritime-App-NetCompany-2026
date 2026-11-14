/**
 * `plan_bunkering`: ranks the received quotes for a vessel's open bunker requirement by total
 * delivered cost. The planner input is built from the world and the quotes, `planBunkers` computes
 * the plan, and the plan is stored as a calculation that every fact (and any proposal) points at.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type BunkerOffer, buildBunkerPlanInput, loadWorld, optionIdFor } from "@pharos/db";
import { DOMAIN_CODE_VERSION, planBunkers } from "@pharos/domain";
import type { BunkerOptionResult, Fact, Quote, ToolResult } from "@pharos/shared";
import { z } from "zod";
import {
  calcFact,
  currentVoyage,
  dbFact,
  findVessel,
  json,
  runTool,
  type ToolContext,
} from "./common.js";

export const TOOL = "plan_bunkering";

export const PlanBunkeringInput = z
  .object({
    vessel: z
      .string()
      .trim()
      .min(1)
      .describe('Vessel name (e.g. "Aegean Pioneer") or 7-digit IMO.'),
  })
  .strict();
export type PlanBunkeringInput = z.infer<typeof PlanBunkeringInput>;

/** Option fields returned as facts, with their units. */
const OPTION_FACTS: [keyof BunkerOptionResult, string, string | null][] = [
  ["rank", "rank by total cost", null],
  ["feasible", "feasible", null],
  ["qtyMt", "quantity", "mt"],
  ["headlinePriceUsdPerMt", "headline price", "USD/mt"],
  ["totalCostUsd", "total delivered cost", "USD"],
  ["delayHours", "delay", "h"],
  ["etsCostUsd", "EU ETS cost", "USD"],
];

export function planBunkering(ctx: ToolContext, input: PlanBunkeringInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const vessel = findVessel(world, input.vessel);
    const voyage = currentVoyage(world, vessel);
    const requirement = voyage
      ? world.bunkerRequirements
          .filter((r) => r.voyageId === voyage.id && r.status === "open")
          .sort((a, b) => a.id - b.id)[0]
      : undefined;
    if (!voyage || !requirement) {
      return {
        facts: [],
        data: { vessel: vessel.name, message: `${vessel.name} has no open bunker requirement.` },
      };
    }

    // The latest received quote per supplier and port (one option each), oldest first.
    const latest = new Map<string, Quote>();
    for (const q of world.quotes
      .filter((q) => q.requirementId === requirement.id && q.status === "received")
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id)) {
      latest.set(`${q.supplierId}:${q.portId}`, q);
    }
    const offers: BunkerOffer[] = [];
    for (const q of [...latest.values()].sort((a, b) => a.id - b.id)) {
      const line = world.quoteLines.find(
        (l) => l.quoteId === q.id && l.grade === requirement.grade,
      );
      const port = world.ports.find((p) => p.id === q.portId);
      const supplier = world.suppliers.find((s) => s.id === q.supplierId);
      if (!line || !port || !supplier) continue;
      offers.push({
        optionId: optionIdFor(port, supplier),
        quoteId: q.id,
        supplierId: supplier.id,
        portId: port.id,
        currency: q.currency,
        pricePerMt: line.pricePerMt,
        bargeFee: q.bargeFee,
        qtyMt: line.qtyMt,
      });
    }
    if (offers.length === 0) {
      return {
        facts: [],
        data: {
          vessel: vessel.name,
          grade: requirement.grade,
          message: `No received quotes for ${vessel.name}'s open ${requirement.grade} requirement yet.`,
        },
      };
    }

    const planInput = buildBunkerPlanInput(world, voyage.id, offers);
    const plan = planBunkers(planInput);
    const [calc] = await ctx.sql<{ id: number }[]>`
      insert into calculations (kind, inputs, outputs, code_version, voyage_id, weather_snapshot_id, created_at)
      values ('bunker_plan', ${json(planInput)}::jsonb, ${json(plan)}::jsonb, ${DOMAIN_CODE_VERSION},
              ${voyage.id}, null, ${ctx.now().toISOString()}::timestamptz)
      returning id`;
    if (!calc) throw new Error("calculations insert returned no row");
    const ref = { id: calc.id, calculator: "planBunkers" };

    const describe = (optionId: string) => {
      const offer = offers.find((o) => o.optionId === optionId);
      const supplier = world.suppliers.find((s) => s.id === offer?.supplierId)?.name ?? "?";
      const port = world.ports.find((p) => p.id === offer?.portId)?.name ?? "?";
      return { supplier, port };
    };

    const facts: Fact[] = plan.options.flatMap((o, i) => {
      const { supplier, port } = describe(o.optionId);
      return OPTION_FACTS.map(([field, label, unit]) =>
        calcFact(
          TOOL,
          ref,
          `options[${i}].${field}`,
          `${o.optionId} (${supplier}, ${port}): ${label}`,
          o[field] as number | boolean,
          unit,
        ),
      );
    });
    if (plan.bestOptionId !== null) {
      facts.push(
        calcFact(
          TOOL,
          ref,
          "bestOptionId",
          "Best option (lowest total cost, feasible)",
          plan.bestOptionId,
          null,
        ),
      );
    }
    if (plan.cheapestHeadlineOptionId !== null) {
      facts.push(
        calcFact(
          TOOL,
          ref,
          "cheapestHeadlineOptionId",
          "Option with the cheapest headline price",
          plan.cheapestHeadlineOptionId,
          null,
        ),
      );
    }
    if (plan.savingVsCheapestHeadlineUsd !== null) {
      facts.push(
        calcFact(
          TOOL,
          ref,
          "savingVsCheapestHeadlineUsd",
          "Saving of the best option against the cheapest headline price, in total cost",
          plan.savingVsCheapestHeadlineUsd,
          "USD",
        ),
      );
    }
    // The ids an answer may mention ("plan 3", "voyage AP-2611"), citable like any other number.
    facts.push(
      calcFact(TOOL, ref, "calculationId", "Bunker plan calculation id", calc.id, null),
      dbFact(
        TOOL,
        { table: "voyages", rowId: voyage.id, field: "voyageNo" },
        "Voyage number",
        voyage.voyageNo,
        null,
      ),
    );

    return {
      facts,
      data: {
        calculationId: calc.id,
        vessel: vessel.name,
        voyageNo: voyage.voyageNo,
        grade: requirement.grade,
        bestOptionId: plan.bestOptionId,
        cheapestHeadlineOptionId: plan.cheapestHeadlineOptionId,
        options: plan.options.map((o) => ({
          optionId: o.optionId,
          ...describe(o.optionId),
          feasible: o.feasible,
          infeasibleReasons: o.reasons,
        })),
      },
    };
  });
}

export function planBunkeringTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Bunker plan for a vessel's open fuel requirement: ranks every received supplier quote by total " +
      "delivered cost (fuel, barge fee, deviation, delay and EU ETS cost) and checks feasibility " +
      "(quantity, tank space, safety margin, berth window). Stores the plan as a calculation and " +
      "returns its calculationId, the best option and citable facts per option.",
    inputSchema: PlanBunkeringInput,
    run: async (input) => JSON.stringify(await planBunkering(ctx, input)),
  });
}
