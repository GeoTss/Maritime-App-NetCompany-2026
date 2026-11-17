/**
 * A person proposes an action from a stored plan, without the assistant: the purchase order for a
 * route plan's bunker stop (or a bunker plan's option), or the voyage instruction for a route plan.
 * The same checks as `propose_action` (the option exists and is feasible, the vessel is ours), and
 * the same rule: one pending proposal per plan, option and type. Nothing is ordered or sent; the
 * proposal waits for approval like any other.
 */
import type { Sql } from "@pharos/db";
import type { ProposeBody, ProposeResult } from "@pharos/shared";
import { checkedOption, insertPending, proposalSource } from "../ai/tools/propose-action.js";

/** A proposal the stored plan does not allow; the message is the reason, for the operator. */
export class ProposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposeError";
  }
}

export async function proposeFromPlan(
  deps: { sql: Sql; now: () => Date },
  body: ProposeBody,
): Promise<ProposeResult> {
  let checked: { expectedSavingUsd: number | null };
  try {
    const { kind, outputs } = await proposalSource(deps.sql, body);
    checked = checkedOption({ ...body, factRefs: [], rationale: "" }, kind, outputs);
  } catch (err) {
    if (err instanceof Error) throw new ProposeError(err.message);
    throw err;
  }
  // A person's proposal cites no conversation facts; its view reads the plan's facts.
  const { id, created } = await insertPending(
    deps.sql,
    deps.now(),
    body,
    [],
    checked.expectedSavingUsd,
  );
  return { recommendationId: id, created };
}
