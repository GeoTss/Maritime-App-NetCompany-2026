/**
 * A proposal an answer created, as a hairline card fed by `GET /api/recommendations/:id`: its kind,
 * its state, the summary and a link to the approvals screen, where it is decided. The card itself
 * changes nothing. While the proposal cannot be read, it still names it and links to it.
 */
import { RecommendationView } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { FactText } from "@/components/fact-text";
import { RECOMMENDATION_KIND } from "@/components/primitives/approval-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STATE: Record<RecommendationView["status"], { text: string; tone: string }> = {
  pending: { text: "awaiting your decision", tone: "text-caution" },
  approved: { text: "approved", tone: "text-text-1" },
  executing: { text: "executing", tone: "text-text-2" },
  executed: { text: "executed", tone: "text-text-1" },
  rejected: { text: "rejected", tone: "text-alarm" },
  failed: { text: "failed", tone: "text-alarm" },
};

/** What holds until the operator approves, in the words of the approval dialog. */
const UNTIL_APPROVED: Record<RecommendationView["type"], string> = {
  purchase_order: "Nothing is ordered until you approve.",
  voyage_instruction: "Nothing is recorded until you approve.",
};

const useRecommendation = (id: number) =>
  useQuery({
    queryKey: queryKeys.recommendation(id),
    queryFn: ({ signal }) => api.get(`/api/recommendations/${id}`, RecommendationView, { signal }),
  });

export function ProposalLink({ id }: { id: number }) {
  const query = useRecommendation(id);
  const rec = query.data;
  const awaiting = rec === undefined || rec.status === "pending";
  const state = rec ? STATE[rec.status] : null;

  return (
    <article
      aria-label={`Proposal ${id}`}
      data-status={rec?.status}
      className={cn(
        "flex max-w-[60ch] flex-col gap-1 border px-3 py-2.5",
        awaiting ? "border-caution/50" : "border-line",
      )}
    >
      <p className="text-2xs font-medium font-label">
        {rec && state ? (
          <>
            <span className="text-text-2">{RECOMMENDATION_KIND[rec.type]}</span>
            <span className="text-text-3"> · </span>
            <span className={state.tone}>{state.text}</span>
          </>
        ) : (
          <span className="text-text-2">Proposal {id}</span>
        )}
      </p>
      {rec ? (
        <p className="text-sm font-medium text-text-1">
          <FactText text={rec.summary} facts={rec.facts} />
        </p>
      ) : query.isError ? (
        <p className="text-xs text-text-2">
          Its details could not be loaded here. The approvals screen has it.
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {rec && awaiting ? (
          <span className="text-xs text-text-2">{UNTIL_APPROVED[rec.type]}</span>
        ) : null}
        <Button asChild variant="default" className="ml-auto">
          <Link to={`/approvals?recommendation=${id}`}>
            {awaiting ? "Review and decide" : "Open in approvals"}
          </Link>
        </Button>
      </div>
    </article>
  );
}
