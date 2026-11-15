/**
 * `propose_action`: the agent's only write. It inserts a *pending* recommendation that points at a
 * stored calculation and one of its options; nothing is ordered or sent. The input carries no
 * quantity, price or speed (`ProposedAction` is strict), every cited fact must be one of that
 * calculation's, and the expected saving is read from the calculation, never taken from the model.
 * Only the executor acts, after a human approves.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BunkerPlan, ProposeActionInput, ProposedAction, type ToolResult } from "@pharos/shared";
import { dbFact, json, runTool, type ToolContext } from "./common.js";

export const TOOL = "propose_action";

export async function proposeAction(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const action = ProposedAction.parse(input);
    if (action.type !== "purchase_order") {
      throw new Error(
        "voyage_instruction proposals are not supported yet: only a bunker plan option can be proposed, as a purchase_order.",
      );
    }
    const unknown = action.factRefs.filter((id) => !ctx.ledger.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `factRefs ${unknown.join(", ")} were not returned earlier in this conversation.`,
      );
    }

    const [calc] = await ctx.sql<{ kind: string; outputs: unknown }[]>`
      select kind, outputs from calculations where id = ${action.calculationId}`;
    if (!calc) throw new Error(`Calculation ${action.calculationId} does not exist.`);
    if (calc.kind !== "bunker_plan") {
      throw new Error(`Calculation ${action.calculationId} is a ${calc.kind}, not a bunker plan.`);
    }
    const ofCalculation = (id: string) => {
      const p = ctx.ledger.get(id)?.provenance;
      return p?.source === "calculation" && p.calculationId === action.calculationId;
    };
    if (![...ctx.ledger.keys()].some(ofCalculation)) {
      throw new Error(
        `Calculation ${action.calculationId} was not computed in this conversation; call plan_bunkering first.`,
      );
    }
    // The proposal cites the plan it proposes from, not another plan's (or a db) fact.
    const foreign = action.factRefs.filter((id) => !ofCalculation(id));
    if (foreign.length > 0) {
      throw new Error(
        `factRefs ${foreign.join(", ")} are not facts of calculation ${action.calculationId}; ` +
          "cite only facts of the plan you propose from.",
      );
    }
    const plan = BunkerPlan.parse(calc.outputs);
    const option = plan.options.find((o) => o.optionId === action.optionId);
    if (!option) {
      throw new Error(`Calculation ${action.calculationId} has no option ${action.optionId}.`);
    }
    if (!option.feasible) {
      throw new Error(
        `Option ${action.optionId} is not feasible (${option.reasons.join(", ")}); it cannot be proposed.`,
      );
    }

    const [existing] = await ctx.sql<{ id: number }[]>`
      select id from recommendations
      where calculation_id = ${action.calculationId} and option_id = ${action.optionId}
        and type = ${action.type} and status = 'pending'
      order by id limit 1`;
    let id = existing?.id;
    if (id === undefined) {
      // The saving is the plan's (best option vs cheapest headline); another option gets none.
      const expectedSavingUsd =
        action.optionId === plan.bestOptionId ? plan.savingVsCheapestHeadlineUsd : null;
      const [row] = await ctx.sql<{ id: number }[]>`
        insert into recommendations (type, calculation_id, option_id, message_id, fact_refs,
                                     expected_saving_usd, status, decided_by, decided_at, created_at)
        values (${action.type}, ${action.calculationId}, ${action.optionId}, null,
                ${json(action.factRefs)}::jsonb, ${expectedSavingUsd}, 'pending', null, null,
                ${ctx.now().toISOString()}::timestamptz)
        returning id`;
      if (!row) throw new Error("recommendations insert returned no row");
      id = row.id;
    }
    if (!ctx.recommendationIds.includes(id)) ctx.recommendationIds.push(id);

    return {
      facts: [
        dbFact(
          TOOL,
          { table: "recommendations", rowId: id, field: "id" },
          "Pending recommendation id",
          id,
          null,
        ),
      ],
      data: {
        recommendationId: id,
        status: "pending",
        optionId: action.optionId,
        note: "Pending human approval. Nothing has been ordered or sent.",
      },
    };
  });
}

export function proposeActionTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Propose a purchase order for one feasible option of a stored bunker plan, for a human to " +
      "approve. Creates a pending recommendation only: nothing is ordered or sent. Takes the plan's " +
      "calculationId and optionId, and factRefs that are facts of that same plan; quantities and " +
      "prices come from the stored plan, never from you.",
    inputSchema: ProposeActionInput,
    run: async (input) => JSON.stringify(await proposeAction(ctx, input)),
  });
}
