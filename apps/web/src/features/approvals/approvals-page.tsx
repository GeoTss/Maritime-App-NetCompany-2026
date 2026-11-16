/**
 * The approvals queue, in two parts: proposals awaiting a decision (the top one carries the page's
 * single focal effect), then decided ones, folded to their outcome. Approve and Reject are the
 * only actions here and each asks first. A decision is one
 * POST at a time; if the proposal was already decided (409) the card shows the status the API
 * now holds, read from a refetch, never guessed.
 */
import { CheckListIcon } from "@hugeicons/core-free-icons";
import { DecisionResult, listOf, RecommendationView, ReviewReference } from "@pharos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import type { Decision } from "@/components/primitives/approval-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, describeFailure, isApiFailure } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { RecommendationCard } from "./approval-card";
import { auditKey } from "./audit-trail";
import { hasOptionFact } from "./option-name";

const Recommendations = listOf(RecommendationView);

const STATUS_WORD: Record<string, string> = {
  pending: "still awaiting approval",
  approved: "approved",
  executing: "executing",
  executed: "approved and executed",
  rejected: "rejected",
  failed: "failed",
};

export function ApprovalsPage() {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const linkedParam = Number(params.get("recommendation"));
  const linked = Number.isInteger(linkedParam) && linkedParam > 0 ? linkedParam : null;
  const [conflicts, setConflicts] = useState<Record<number, string>>({});

  const list = useQuery({
    queryKey: queryKeys.recommendations,
    queryFn: ({ signal }) => api.get("/api/recommendations", Recommendations, { signal }),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: Decision }) =>
      api.post(`/api/recommendations/${id}/${decision}`, {}, DecisionResult),
    onSuccess: (result, { id, decision }) => {
      setConflicts(({ [id]: _drop, ...rest }) => rest);
      toast.success(
        decision === "approve"
          ? result.erpPoNumber
            ? `Approved: purchase order ${result.erpPoNumber}`
            : "Approved"
          : "Rejected",
      );
    },
    onError: async (err, { id }) => {
      if (isApiFailure(err) && err.status === 409) {
        await client.refetchQueries({ queryKey: queryKeys.recommendations });
        const now = client
          .getQueryData<{ items: RecommendationView[] }>(queryKeys.recommendations)
          ?.items.find((r) => r.id === id);
        const word = now ? (STATUS_WORD[now.status] ?? now.status) : "already decided";
        setConflicts((c) => ({
          ...c,
          [id]: `Already decided elsewhere: this proposal is now ${word}.`,
        }));
        return;
      }
      toast.error(describeFailure(err));
    },
    onSettled: (_r, _e, { id }) => {
      void client.invalidateQueries({ queryKey: queryKeys.recommendations });
      void client.invalidateQueries({ queryKey: queryKeys.drafts(id) });
      void client.invalidateQueries({ queryKey: auditKey(id) });
    },
  });

  const items = list.data?.items;
  const awaiting = useMemo(() => (items ?? []).filter((r) => r.status === "pending"), [items]);
  const decided = useMemo(() => (items ?? []).filter((r) => r.status !== "pending"), [items]);
  const ordered = useMemo(() => [...awaiting, ...decided], [awaiting, decided]);
  const firstPending = awaiting[0]?.id ?? null;

  // Port and supplier names, to name an option id ("MTMLA-kestrel") beside its fact.
  const reference = useQuery({
    queryKey: queryKeys.reviewReference,
    enabled: (items ?? []).some((r) => hasOptionFact(r.facts)),
    queryFn: ({ signal }) => api.get("/api/review/reference", ReviewReference, { signal }),
  });
  const names = reference.data ?? null;

  // Arriving from an assistant link: bring that proposal into view once it is listed.
  const present = linked !== null && ordered.some((r) => r.id === linked);
  useEffect(() => {
    if (present) document.getElementById(`rec-${linked}`)?.scrollIntoView?.({ block: "center" });
  }, [present, linked]);

  const inFlight = decide.isPending ? decide.variables : null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg text-text-1 font-title">Approvals</h1>
      </header>
      <p className="max-w-[64ch] text-xs/relaxed text-text-2">
        The assistant only proposes. Nothing changes until you approve or reject, and nothing is
        ever sent to a supplier or a master: messages are drafted for you.
      </p>
      {list.isPending ? (
        <div
          role="status"
          className="flex max-w-[860px] flex-col gap-2"
          aria-label="Loading proposals"
        >
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : list.isError ? (
        <ErrorState
          error={list.error}
          title="The proposals could not be loaded"
          onRetry={() => void list.refetch()}
        />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={CheckListIcon}
          title="Nothing is waiting for a decision"
          description="Ask the assistant where to bunker or which route to sail; a proposal it makes appears here."
          action={
            <Link to="/" className="text-xs text-beacon underline underline-offset-3">
              Back to the map
            </Link>
          }
        />
      ) : (
        <div className="flex max-w-[860px] flex-col gap-6">
          {[
            {
              id: "awaiting",
              title: "Awaiting your decision",
              recs: awaiting,
              empty: "Nothing is awaiting a decision.",
            },
            { id: "decided", title: "Decided", recs: decided, empty: null },
          ].map((group) =>
            group.recs.length === 0 && group.empty === null ? null : (
              <section
                key={group.id}
                aria-labelledby={`approvals-${group.id}`}
                className="flex flex-col gap-3"
              >
                <h2
                  id={`approvals-${group.id}`}
                  className="flex items-baseline gap-2 text-xs font-medium text-text-2 font-label"
                >
                  {group.title}
                  <span className="font-normal text-text-1 tabular-nums">{group.recs.length}</span>
                </h2>
                {group.recs.length === 0 ? (
                  <p className="text-xs text-text-2">{group.empty}</p>
                ) : (
                  group.recs.map((rec) => (
                    <RecommendationCard
                      key={rec.id}
                      rec={rec}
                      focal={rec.id === firstPending}
                      linked={rec.id === linked}
                      pending={inFlight?.id === rec.id ? inFlight.decision : null}
                      locked={decide.isPending}
                      conflict={conflicts[rec.id] ?? null}
                      names={names}
                      onDecide={(decision) =>
                        decide.mutateAsync({ id: rec.id, decision }).catch(() => undefined)
                      }
                    />
                  ))
                )}
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
