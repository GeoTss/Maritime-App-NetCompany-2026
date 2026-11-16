/**
 * The decision controls of one proposal. Approve and Reject are the only controls in the console
 * that change anything; each opens a confirmation (the shared `DecisionButtons` alert dialog)
 * that says exactly what will happen, and nothing is ever sent to an outside party.
 */
import type { RecommendationView } from "@pharos/shared";
import { type Decision, DecisionButtons } from "@/components/primitives/approval-card";

export const APPROVE_CONSEQUENCE: Record<RecommendationView["type"], string> = {
  purchase_order:
    "Approving pushes the order to the ERP simulator and drafts a supplier confirmation (not sent).",
  voyage_instruction:
    "Approving records the route and speed instruction and drafts a message to the master (not sent).",
};

export const REJECT_CONSEQUENCE =
  "Rejecting closes this proposal. Nothing is written to the ERP, no instruction is recorded and nothing is drafted.";

export function ProposalDecision({
  type,
  pending,
  disabled,
  onDecide,
}: {
  type: RecommendationView["type"];
  pending: Decision | null;
  disabled: boolean;
  onDecide: (decision: Decision) => Promise<unknown>;
}) {
  return (
    <DecisionButtons
      pending={pending}
      disabled={disabled}
      approveConsequence={APPROVE_CONSEQUENCE[type]}
      rejectConsequence={REJECT_CONSEQUENCE}
      confirmApproveLabel="Approve"
      confirmRejectLabel="Reject"
      onApprove={() => onDecide("approve")}
      onReject={() => onDecide("reject")}
    />
  );
}
