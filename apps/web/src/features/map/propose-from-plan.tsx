/**
 * Under a fleet vessel's recommended plan: propose what the plan implies without asking the
 * assistant. A plan that calls at a bunker port proposes the purchase order for the stop's quote
 * and the voyage instruction; a plan without a stop, the voyage instruction alone.
 *
 * A proposal is pending: it waits on Approvals, and nothing is ordered or sent until someone
 * approves it there (approval keeps its own confirmation), so these buttons ask nothing first.
 * The toast names the proposal and opens it; a refusal (409) shows the API's reason as returned.
 */
import type { ProposeBody, RecommendedPlan } from "@pharos/shared";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeFailure } from "@/lib/api";
import { useProposeRecommendation } from "@/lib/queries";

type Kind = ProposeBody["type"];

const NOUN: Record<Kind, string> = {
  purchase_order: "purchase order",
  voyage_instruction: "voyage instruction",
};

const UNTIL_APPROVED: Record<Kind, string> = {
  purchase_order: "Purchase order: nothing is ordered until you approve it.",
  voyage_instruction: "Voyage instruction: nothing is sent until you approve it.",
};

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
  const order = useProposeRecommendation();
  const instruction = useProposeRecommendation();

  const propose = (mutation: typeof order, type: Kind) =>
    mutation.mutate(
      { type, calculationId, optionId: plan.optionId },
      {
        onSuccess: ({ recommendationId: id, created }) =>
          toast.success(
            created
              ? `Proposal ${id} is waiting for your decision`
              : `Proposal ${id} was already waiting for your decision`,
            {
              description: UNTIL_APPROVED[type],
              action: {
                label: "Review and decide",
                onClick: () => navigate(`/approvals?recommendation=${id}`),
              },
            },
          ),
        onError: (err) =>
          toast.error(`The ${NOUN[type]} was not proposed`, {
            description: describeFailure(err),
          }),
      },
    );

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5" data-testid="plan-propose">
      <div className="flex flex-wrap items-center gap-2">
        {plan.kind === "stop" ? (
          <Button
            size="sm"
            disabled={order.isPending}
            aria-busy={order.isPending || undefined}
            onClick={() => propose(order, "purchase_order")}
          >
            Propose purchase order
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={instruction.isPending}
          aria-busy={instruction.isPending || undefined}
          onClick={() => propose(instruction, "voyage_instruction")}
        >
          Propose voyage instruction
        </Button>
      </div>
      <p className="text-xs text-text-2">
        A proposal waits on Approvals; nothing is ordered or sent until you approve it.
      </p>
    </div>
  );
}
