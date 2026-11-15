/**
 * `propose_action`: the agent's only write. It inserts a *pending* recommendation that points at a
 * stored calculation and one of its options; nothing is ordered, changed or sent. The input
 * carries no quantity, price, speed or ETA (`ProposedAction` is strict), every cited fact must be
 * one of that calculation's, and the expected saving is read from the calculation, never taken from
 * the model. Only the executor acts, after a human approves.
 *
 * - `purchase_order`: one feasible option of a `bunker_plan` (from `plan_bunkering`).
 * - `voyage_instruction`: one feasible route of a `route_speed` plan of a fleet vessel's voyage
 *   (from `plan_route_speed`); a plan for a ship seen on AIS is refused.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  BunkerPlan,
  type Id,
  ProposeActionInput,
  ProposedAction,
  RouteSpeedResult,
  type ToolResult,
} from "@pharos/shared";
import { dbFact, json, runTool, type ToolContext } from "./common.js";

export const TOOL = "propose_action";

/** What each proposal type needs: the calculation kind it is proposed from and the tool that makes it. */
const SOURCE = {
  purchase_order: { kind: "bunker_plan", tool: "plan_bunkering" },
  voyage_instruction: { kind: "route_speed", tool: "plan_route_speed" },
} as const;

const NOTE = {
  purchase_order: "Pending human approval. Nothing has been ordered or sent.",
  voyage_instruction:
    "Pending human approval. No voyage change has been made and nothing has been sent to the vessel.",
} as const;

const OWN_VESSELS_ONLY = "Pharos can only instruct the operator's own vessels.";

/** The option the proposal points at, checked against the stored calculation, and its saving. */
function checkedOption(
  action: ProposedAction,
  outputs: unknown,
): { expectedSavingUsd: number | null } {
  const id = action.calculationId;
  if (action.type === "purchase_order") {
    const plan = BunkerPlan.parse(outputs);
    const option = plan.options.find((o) => o.optionId === action.optionId);
    if (!option) throw new Error(`Calculation ${id} has no option ${action.optionId}.`);
    if (!option.feasible) {
      throw new Error(
        `Option ${action.optionId} is not feasible (${option.reasons.join(", ")}); it cannot be proposed.`,
      );
    }
    // The saving is the plan's (best option vs cheapest headline); another option gets none.
    return {
      expectedSavingUsd:
        action.optionId === plan.bestOptionId ? plan.savingVsCheapestHeadlineUsd : null,
    };
  }
  const result = RouteSpeedResult.parse(outputs);
  const option = result.options.find((o) => o.candidateId === action.optionId);
  if (!option) {
    const ids = result.options.map((o) => o.candidateId).join(", ");
    throw new Error(`Calculation ${id} has no route ${action.optionId}; its routes are ${ids}.`);
  }
  if (!option.feasible) {
    throw new Error(
      `Route ${action.optionId} is not feasible (${option.reasons.join(", ")}); it cannot be proposed.`,
    );
  }
  // The saving is the plan's (recommended route and speed vs the current plan); another route gets none.
  return {
    expectedSavingUsd:
      action.optionId === result.bestCandidateId ? result.savingVsBaselineUsd : null,
  };
}

export async function proposeAction(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const action = ProposedAction.parse(input);
    const source = SOURCE[action.type];
    const unknown = action.factRefs.filter((id) => !ctx.ledger.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `factRefs ${unknown.join(", ")} were not returned earlier in this conversation.`,
      );
    }

    const [calc] = await ctx.sql<{ kind: string; outputs: unknown; voyage_id: number | null }[]>`
      select kind, outputs, voyage_id from calculations where id = ${action.calculationId}`;
    if (!calc) throw new Error(`Calculation ${action.calculationId} does not exist.`);
    if (calc.kind !== source.kind) {
      throw new Error(
        `A ${action.type} is proposed from a ${source.kind} calculation (${source.tool}); ` +
          `calculation ${action.calculationId} is a ${calc.kind}.`,
      );
    }
    // A route plan for a ship seen on AIS has no voyage of ours: never instruct another ship.
    if (action.type === "voyage_instruction" && calc.voyage_id === null) {
      throw new Error(OWN_VESSELS_ONLY);
    }
    // A fact of the calculation: one of its outputs, or a stored input read from its own row.
    const ofCalculation = (id: string) => {
      const p = ctx.ledger.get(id)?.provenance;
      if (p?.source === "calculation") return p.calculationId === action.calculationId;
      return p?.source === "db" && p.table === "calculations" && p.rowId === action.calculationId;
    };
    if (![...ctx.ledger.keys()].some(ofCalculation)) {
      throw new Error(
        `Calculation ${action.calculationId} was not computed in this conversation; call ${source.tool} first.`,
      );
    }
    // The proposal cites the calculation it proposes from, not another one's (or a db) fact.
    const foreign = action.factRefs.filter((id) => !ofCalculation(id));
    if (foreign.length > 0) {
      throw new Error(
        `factRefs ${foreign.join(", ")} are not facts of calculation ${action.calculationId}; ` +
          "cite only facts of the plan you propose from.",
      );
    }
    const { expectedSavingUsd } = checkedOption(action, calc.outputs);

    const [existing] = await ctx.sql<{ id: number }[]>`
      select id from recommendations
      where calculation_id = ${action.calculationId} and option_id = ${action.optionId}
        and type = ${action.type} and status = 'pending'
      order by id limit 1`;
    let id: Id | undefined = existing?.id;
    if (id === undefined) {
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
        note: NOTE[action.type],
      },
    };
  });
}

export function proposeActionTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Propose an action for a human to approve: a purchase order (type purchase_order) for one " +
      "feasible option of a stored bunker plan, or a voyage instruction (type voyage_instruction) " +
      "for one feasible route of a stored route plan of a fleet vessel. Use it only when the " +
      "operator asks you to decide (where or from whom to buy, which offer to take, a " +
      "recommendation or an order) or to instruct the master (prepare or issue the voyage " +
      "instruction, put the route and speed into effect), never when they only look something up, " +
      "compare, ask which route or speed is best, ask for a calculation or say not to order or " +
      "instruct yet. Never for a ship seen on AIS. Creates a pending recommendation only: nothing " +
      "is ordered, changed or sent. Takes the plan's calculationId and optionId (a bunker plan's " +
      "optionId, or a route plan's route id), and factRefs that are facts of that same plan; " +
      "quantities, prices, speeds and ETAs come from the stored plan, never from you.",
    inputSchema: ProposeActionInput,
    run: async (input) => JSON.stringify(await proposeAction(ctx, input)),
  });
}
