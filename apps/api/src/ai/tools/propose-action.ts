/**
 * `propose_action`: the agent's only write. It inserts a *pending* recommendation that points at a
 * stored calculation and one of its options; nothing is ordered, changed or sent. The input
 * carries no quantity, price, speed or ETA (`ProposedAction` is strict), every cited fact must be
 * one of that calculation's, and the expected saving is read from the calculation, never taken from
 * the model. Only the executor acts, after a human approves.
 *
 * - `purchase_order`: one feasible option of a `bunker_plan` (from `plan_bunkering`), or one
 *   feasible bunker stop of a fleet vessel's `route_speed` plan (from `plan_route_speed`).
 * - `voyage_instruction`: one feasible route (fuel included) or one feasible bunker stop plan of a
 *   `route_speed` plan of a fleet vessel's voyage; a plan for a ship seen on AIS is refused.
 *
 * One call inserts at most one row. An instruction on a bunker stop never creates the purchase
 * order it needs (a proposal nobody asked for); it reports the matching order, if any, through
 * the one dependency rule in `approvals/dependency.ts`, and says when that order is not approved.
 */
import {
  BunkerPlan,
  type Id,
  ProposeActionInput,
  ProposedAction,
  type RecommendationStatus,
  RouteSpeedResult,
  type ToolResult,
} from "@pharos/shared";
import { orderDependencyOf } from "../../approvals/dependency.js";
import { existingProposal } from "../../approvals/existing.js";
import { dbFact } from "../../facts/core.js";
import { json, runTool, type ToolContext } from "./common.js";
import { defineTool } from "./define.js";

export const TOOL = "propose_action";

/** The tool that makes each calculation kind a proposal can come from. */
const TOOL_OF = { bunker_plan: "plan_bunkering", route_speed: "plan_route_speed" } as const;
type SourceKind = keyof typeof TOOL_OF;

/** The calculation kinds each proposal type is proposed from. */
const SOURCES: Record<ProposedAction["type"], readonly SourceKind[]> = {
  purchase_order: ["bunker_plan", "route_speed"],
  voyage_instruction: ["route_speed"],
  security_order: ["route_speed"],
};

const sourceList = (kinds: readonly SourceKind[]) =>
  kinds.map((k) => `${k} (${TOOL_OF[k]})`).join(" or ");

const NOTE = {
  purchase_order: "Pending human approval. Nothing has been ordered or sent.",
  voyage_instruction:
    "Pending human approval. No voyage change has been made and nothing has been sent to the vessel.",
  security_order:
    "Pending human approval. No security team has been ordered and nothing has been sent.",
} as const;

const OWN_VESSELS_ONLY = "Pharos can only instruct the operator's own vessels.";

/** Why a stop plan of a route calculation cannot be proposed, or null when it can. */
function refuseStop(stop: RouteSpeedResult["stopPlans"][number]): string | null {
  if (!stop.feasible) {
    return `Bunker stop ${stop.optionId} is not feasible (${stop.reasons.join(", ")}); it cannot be proposed.`;
  }
  if (stop.quoteId === null) {
    return `Bunker stop ${stop.optionId} is not a received quote; it cannot be proposed.`;
  }
  return null;
}

/** The option the proposal points at, checked against the stored calculation, and its saving. */
export function checkedOption(
  action: ProposedAction,
  kind: SourceKind,
  outputs: unknown,
): { expectedSavingUsd: number | null } {
  const id = action.calculationId;
  if (kind === "bunker_plan") {
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
  if (action.type === "security_order") {
    // A security order buys the team a route option's security plan chose (Track 3).
    const option = result.options.find((o) => o.candidateId === action.optionId);
    if (!option) throw new Error(`Calculation ${id} has no route ${action.optionId}.`);
    if (!option.security?.needsTeam || option.security.quoteId === null) {
      throw new Error(
        `Route ${action.optionId} ${option.security?.needsTeam ? "has no security quote that covers it" : "needs no security team"}; no security order can be proposed.`,
      );
    }
    if (!option.feasible) {
      throw new Error(
        `Route ${action.optionId} is not feasible (${option.reasons.join(", ")}); it cannot be proposed.`,
      );
    }
    return { expectedSavingUsd: null };
  }
  const stops = result.stopPlans.map((s) => s.optionId).join(", ") || "none";
  const stop = result.stopPlans.find((s) => s.optionId === action.optionId);
  if (action.type === "purchase_order") {
    // A route plan's purchase order buys at one of its bunker stops, never on a route.
    if (!stop) {
      throw new Error(
        `Calculation ${id} has no bunker stop ${action.optionId}; its bunker stops are ${stops}.`,
      );
    }
    const why = refuseStop(stop);
    if (why) throw new Error(why);
    return { expectedSavingUsd: null };
  }
  if (stop) {
    const why = refuseStop(stop);
    if (why) throw new Error(why);
    // A stop plan has no saving against the current plan (which runs short).
    return { expectedSavingUsd: null };
  }
  const option = result.options.find((o) => o.candidateId === action.optionId);
  if (!option) {
    const ids = result.options.map((o) => o.candidateId).join(", ");
    throw new Error(
      `Calculation ${id} has no route ${action.optionId}; its routes are ${ids} and its bunker stops are ${stops}.`,
    );
  }
  // Fuel included: a route that runs short of fuel (insufficient_fuel) is not feasible.
  if (!option.feasible) {
    const recommended = result.plan ? ` The recommended plan is ${result.plan.optionId}.` : "";
    throw new Error(
      `Route ${action.optionId} is not feasible (${option.reasons.join(", ")}); it cannot be proposed.${recommended}`,
    );
  }
  // The saving is the plan's (recommended route and speed vs the current plan); another route gets none.
  return {
    expectedSavingUsd:
      action.optionId === result.bestCandidateId ? result.savingVsBaselineUsd : null,
  };
}

/** What a proposal names: its type, the stored plan and the option in it. */
export type ProposalTarget = Pick<ProposedAction, "type" | "calculationId" | "optionId">;

/**
 * The stored calculation a proposal comes from, checked: it exists, is of a kind the proposal type
 * is proposed from, and (for a voyage instruction) belongs to a voyage of ours.
 */
export async function proposalSource(
  sql: ToolContext["sql"],
  action: ProposalTarget,
): Promise<{ kind: SourceKind; outputs: unknown }> {
  const sources = SOURCES[action.type];
  const [calc] = await sql<{ kind: string; outputs: unknown; voyage_id: number | null }[]>`
    select kind, outputs, voyage_id from calculations where id = ${action.calculationId}`;
  if (!calc) throw new Error(`Calculation ${action.calculationId} does not exist.`);
  const kind = sources.find((k) => k === calc.kind);
  if (!kind) {
    throw new Error(
      `A ${action.type} is proposed from a ${sourceList(sources)} calculation; ` +
        `calculation ${action.calculationId} is a ${calc.kind}.`,
    );
  }
  // A route plan for a ship seen on AIS has no voyage of ours: never instruct another ship.
  if (
    (action.type === "voyage_instruction" || action.type === "security_order") &&
    calc.voyage_id === null
  ) {
    throw new Error(OWN_VESSELS_ONLY);
  }
  return { kind, outputs: calc.outputs };
}

/**
 * The recommendation for the target: the one the voyage already has for it (`existingProposal`:
 * waiting, approved or carried out, even when proposed from an earlier plan), or a new pending row.
 * Never a second order for a quote or a second copy of the instruction in force.
 */
export async function insertPending(
  sql: ToolContext["sql"],
  now: Date,
  action: ProposalTarget,
  factRefs: string[],
  expectedSavingUsd: number | null,
): Promise<{ id: Id; created: boolean; status: RecommendationStatus }> {
  const existing = await existingProposal(sql, action);
  if (existing) return { id: existing.recommendationId, created: false, status: existing.status };
  const [row] = await sql<{ id: number }[]>`
    insert into recommendations (type, calculation_id, option_id, message_id, fact_refs,
                                 expected_saving_usd, status, decided_by, decided_at, created_at)
    values (${action.type}, ${action.calculationId}, ${action.optionId}, null,
            ${json(factRefs)}::jsonb, ${expectedSavingUsd}, 'pending', null, null,
            ${now.toISOString()}::timestamptz)
    returning id`;
  if (!row) throw new Error("recommendations insert returned no row");
  return { id: row.id, created: true, status: "pending" };
}

export async function proposeAction(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const action = ProposedAction.parse(input);
    const unknown = action.factRefs.filter((id) => !ctx.ledger.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `factRefs ${unknown.join(", ")} were not returned earlier in this conversation.`,
      );
    }

    const { kind, outputs } = await proposalSource(ctx.sql, action);
    // A fact of the calculation: one of its outputs, or a stored input read from its own row.
    const ofCalculation = (id: string) => {
      const p = ctx.ledger.get(id)?.provenance;
      if (p?.source === "calculation") return p.calculationId === action.calculationId;
      return p?.source === "db" && p.table === "calculations" && p.rowId === action.calculationId;
    };
    if (![...ctx.ledger.keys()].some(ofCalculation)) {
      throw new Error(
        `Calculation ${action.calculationId} was not computed in this conversation; call ${TOOL_OF[kind]} first.`,
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
    const { expectedSavingUsd } = checkedOption(action, kind, outputs);
    const { id, status } = await insertPending(
      ctx.sql,
      ctx.now(),
      action,
      action.factRefs,
      expectedSavingUsd,
    );
    if (!ctx.recommendationIds.includes(id)) ctx.recommendationIds.push(id);

    const facts = [
      dbFact(
        TOOL,
        { table: "recommendations", rowId: id, field: "id" },
        "Pending recommendation id",
        id,
        null,
      ),
    ];
    const data: Record<string, unknown> = {
      recommendationId: id,
      status,
      optionId: action.optionId,
      // The voyage already has this proposal decided: say so, never "pending".
      note:
        status === "pending"
          ? NOTE[action.type]
          : `Proposal ${id} for this was already made and is ${status}. Nothing new was proposed.`,
    };
    if (action.type === "voyage_instruction") {
      // A bunker stop's instruction waits for the purchase order for its quote (never made here).
      const dependency = await orderDependencyOf(ctx.sql, {
        type: action.type,
        calculation_id: action.calculationId,
        option_id: action.optionId,
      });
      data.dependsOnRecommendationId = dependency?.recommendationId ?? null;
      if (status === "pending" && dependency && !dependency.satisfied) {
        const what =
          dependency.orderType === "security_order" ? "security order" : "purchase order";
        data.note = `${NOTE.voyage_instruction} Needs an approved ${what} for ${dependency.optionLabel} before it can be approved.`;
      }
      if (dependency?.recommendationId != null) {
        facts.push(
          dbFact(
            TOOL,
            { table: "recommendations", rowId: dependency.recommendationId, field: "id" },
            dependency.orderType === "security_order"
              ? "Security order proposal the instruction depends on"
              : "Purchase order proposal the instruction depends on",
            dependency.recommendationId,
            null,
          ),
        );
      }
    }
    return { facts, data };
  });
}

export const proposeActionDef = defineTool({
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
    "optionId; for a route plan, the recommended plan's id: a route id, or a bunker stop id " +
    "such as MTMLA-kestrel when the route needs a bunker stop), and factRefs that are facts of " +
    "that same plan; quantities, prices, speeds and ETAs come from the stored plan, never from " +
    "you. A voyage instruction with a bunker stop waits for an approved purchase order for that " +
    "stop's quote; never propose that order unless the operator asks for it.",
  inputSchema: ProposeActionInput,
  run: proposeAction,
});
