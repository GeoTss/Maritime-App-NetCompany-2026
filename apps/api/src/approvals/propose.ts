/**
 * A person proposes an action from a stored plan, without the assistant: the purchase order for a
 * route plan's bunker stop (or a bunker plan's option), or the voyage instruction for a route plan.
 * The same checks as `propose_action` (the option exists and is feasible, the vessel is ours), and
 * the same rule: the proposal the voyage already has is returned, never duplicated
 * (`approvals/existing.ts`). Nothing is ordered or sent; a new proposal waits for approval.
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
  const fuelOrRoute = body;
  let checked: { expectedSavingUsd: number | null };
  try {
    const { kind, outputs } = await proposalSource(deps.sql, fuelOrRoute);
    checked = checkedOption({ ...fuelOrRoute, factRefs: [], rationale: "" }, kind, outputs);
  } catch (err) {
    if (err instanceof Error) throw new ProposeError(err.message);
    throw err;
  }
  // A person's proposal cites no conversation facts; its view reads the plan's facts.
  const { id, created, status } = await insertPending(
    deps.sql,
    deps.now(),
    fuelOrRoute,
    [],
    checked.expectedSavingUsd,
  );
  return { recommendationId: id, created, status };
}
