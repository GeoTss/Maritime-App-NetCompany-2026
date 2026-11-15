/**
 * The recommendation state machine, pure. Every status change in the executor goes through
 * `transition`, so an illegal move (approve after reject, execute a pending recommendation) is
 * one `TransitionError` the routes turn into 409.
 *
 *   pending -approve-> approved -start-> executing -succeed-> executed
 *   executing -fail-> failed -retry-> executing
 *   pending -reject-> rejected
 */
import type { RecommendationStatus } from "@pharos/shared";

export type ApprovalEvent = "approve" | "reject" | "start" | "succeed" | "fail" | "retry";

export class TransitionError extends Error {
  override name = "TransitionError";
  constructor(
    readonly from: RecommendationStatus,
    readonly event: ApprovalEvent,
  ) {
    super(`Cannot ${event} a recommendation that is ${from}.`);
  }
}

const TABLE: Readonly<
  Partial<Record<RecommendationStatus, Partial<Record<ApprovalEvent, RecommendationStatus>>>>
> = {
  pending: { approve: "approved", reject: "rejected" },
  approved: { start: "executing" },
  executing: { succeed: "executed", fail: "failed" },
  failed: { retry: "executing" },
};

export function transition(from: RecommendationStatus, event: ApprovalEvent): RecommendationStatus {
  const to = TABLE[from]?.[event];
  if (to === undefined) throw new TransitionError(from, event);
  return to;
}
