/**
 * Under a fleet vessel's recommended plan: propose what the plan implies without asking the
 * assistant. A plan that calls at a bunker port proposes the purchase order for the stop's quote
 * and the voyage instruction; a plan without a stop, the voyage instruction alone.
 *
 * What the voyage already has is read first (`usePlanProposals`): an order or instruction that is
 * waiting, approved or carried out is shown with its state and a link, never offered again, even
 * when it was proposed from an earlier plan. A new proposal is pending: it waits on Approvals, and
 * nothing is ordered or sent until someone approves it there. A refusal (409) shows the API's
 * reason as returned.
 */
import type { PlanProposal, ProposeBody, RecommendedPlan } from "@pharos/shared";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { StateFlag } from "@/components/primitives/state-flag";
import { Button } from "@/components/ui/button";
import { describeFailure } from "@/lib/api";
import { usePlanProposals, useProposeRecommendation } from "@/lib/queries";

type Kind = ProposeBody["type"];

const NOUN: Record<Kind, string> = {
  purchase_order: "purchase order",
  voyage_instruction: "voyage instruction",
  security_order: "security order",
};

const TITLE: Record<Kind, string> = {
  purchase_order: "Purchase order",
  voyage_instruction: "Voyage instruction",
  security_order: "Security order",
};

const UNTIL_APPROVED: Record<Kind, string> = {
  purchase_order: "Purchase order: nothing is ordered until you approve it.",
  voyage_instruction: "Voyage instruction: nothing is sent until you approve it.",
  security_order: "Security order: no team is ordered until you approve it.",
};

/** Where an existing proposal stands, in the operator's words. */
const STATE: Record<PlanProposal["status"], string> = {
  pending: "waiting for your decision",
  approved: "approved",
  executing: "approved, being carried out",
  executed: "approved and carried out",
  failed: "approved, but it failed: retry it on Approvals",
  rejected: "rejected",
};

const approvalsPath = (id: number) => `/approvals?recommendation=${id}`;

/** One line for a proposal the voyage already has: what it is, where it stands, and the way to it. */
function Existing({ type, proposal }: { type: Kind; proposal: PlanProposal }) {
  const waiting = proposal.status === "pending";
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid={`plan-existing-${type}`}
      data-status={proposal.status}
    >
      {waiting ? <StateFlag kind="K" /> : null}
      <span className="text-text-1">
        {TITLE[type]}: {STATE[proposal.status]}
      </span>
      <Button asChild size="sm" variant={waiting ? "default" : "outline"} className="ml-auto">
        <Link to={approvalsPath(proposal.recommendationId)}>
          {waiting ? "Review and decide" : `Open proposal ${proposal.recommendationId}`}
        </Link>
      </Button>
    </li>
  );
}

export function ProposeFromPlan({
  calculationId,
  plan,
}: {
  /** The stored route plan the proposal comes from. */
  calculationId: number;
  /** Its recommended plan: a stop plan's option id or a route's candidate id. */
  plan: RecommendedPlan;
}) {
  const navigate = useNavigate();
  const existing = usePlanProposals(calculationId, plan.optionId);
  const order = useProposeRecommendation();
  const instruction = useProposeRecommendation();

  const propose = (mutation: typeof order, type: Kind) =>
    mutation.mutate(
      { type, calculationId, optionId: plan.optionId },
      {
        onSuccess: ({ recommendationId: id, created, status }) =>
          toast.success(
            created
              ? `Proposal ${id} is waiting for your decision`
              : status === "pending"
                ? `Proposal ${id} was already waiting for your decision`
                : `This ${NOUN[type]} already exists: proposal ${id}, ${STATE[status]}`,
            {
              description: status === "pending" ? UNTIL_APPROVED[type] : undefined,
              action: {
                label: status === "pending" ? "Review and decide" : "Open",
                onClick: () => navigate(approvalsPath(id)),
              },
            },
          ),
        onError: (err) =>
          toast.error(`The ${NOUN[type]} was not proposed`, {
            description: describeFailure(err),
          }),
      },
    );

  const kinds: { type: Kind; mutation: typeof order; has: PlanProposal | null }[] = [
    ...(plan.kind === "stop"
      ? [
          {
            type: "purchase_order" as const,
            mutation: order,
            has: existing.data?.purchaseOrder ?? null,
          },
        ]
      : []),
    {
      type: "voyage_instruction" as const,
      mutation: instruction,
      has: existing.data?.voyageInstruction ?? null,
    },
  ];
  // Another instruction is in force: one proposed from this plan would replace it.
  const inForce = existing.data?.instructionInForce ?? null;
  const open = kinds.filter((k) => k.has === null);
  const done = kinds.filter((k) => k.has !== null);

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5" data-testid="plan-propose">
      {done.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-xs">
          {done.map((k) =>
            k.has ? <Existing key={k.type} type={k.type} proposal={k.has} /> : null,
          )}
        </ul>
      ) : null}
      {open.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {open.map((k) => (
              <Button
                key={k.type}
                size="sm"
                disabled={k.mutation.isPending || existing.isPending}
                aria-busy={k.mutation.isPending || undefined}
                onClick={() => propose(k.mutation, k.type)}
              >
                Propose {k.type === "voyage_instruction" && inForce ? "updated " : ""}
                {NOUN[k.type]}
              </Button>
            ))}
          </div>
          {inForce && open.some((k) => k.type === "voyage_instruction") ? (
            <p className="text-xs text-text-2" data-testid="plan-replaces">
              The vessel sails on the instruction of{" "}
              <Link
                to={approvalsPath(inForce.recommendationId)}
                className="text-beacon underline-offset-2 hover:underline"
              >
                proposal {inForce.recommendationId}
              </Link>
              . This plan differs from it; a new instruction replaces it once approved.
            </p>
          ) : null}
          <p className="text-xs text-text-2">
            A proposal waits on Approvals; nothing is ordered or sent until you approve it.
          </p>
        </>
      ) : (
        <p className="text-xs text-text-2">
          This plan is already proposed; planning again changes nothing until you decide.
        </p>
      )}
    </div>
  );
}
