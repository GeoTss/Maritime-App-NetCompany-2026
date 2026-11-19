/**
 * Approvals: a queue beside one decision. The queue lists proposals awaiting a decision (oldest
 * first, the order they were proposed) and then decided ones (newest first). The selection lives
 * in `?recommendation=<id>` (ruling U6), the assistant's deep link: by default the first awaiting
 * proposal, else the newest decided one. A link to a proposal that is not listed says so.
 *
 * Approve and Reject are the only decisions here and each asks first. A decision is one POST at a
 * time; deciding pins the selection, so the outcome stays in view. If the proposal was already
 * decided (409) the detail shows the status the API now holds, read from a refetch, never guessed.
 * An instruction that waits for a purchase order nobody has proposed (or whose order was
 * rejected) can propose it: the order joins the queue pending and is selected, and nothing is
 * ordered until it is approved. A refusal (409) says why in a toast.
 * Below 768 px of canvas the queue stacks above the decision.
 */
import { CheckListIcon } from "@hugeicons/core-free-icons";
import { DecisionResult, listOf, type ProposeBody, RecommendationView } from "@pharos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import type { Decision } from "@/components/primitives/approval-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, describeFailure, isApiFailure } from "@/lib/api";
import { queryKeys, useProposeRecommendation } from "@/lib/queries";
import { ProposalDetail, QueueRow } from "./approval-card";
import { auditKey } from "./audit-trail";

const Recommendations = listOf(RecommendationView);

const STATUS_WORD: Record<string, string> = {
  pending: "still awaiting approval",
  approved: "approved",
  executing: "executing",
  executed: "approved and executed",
  rejected: "rejected",
  failed: "failed",
};

/**
 * An awaiting instruction that waits for an awaiting purchase order moves to just after that
 * order, so the queue reads in the order the decisions can be made.
 */
function ordersFirst(awaiting: RecommendationView[]): RecommendationView[] {
  const waits = (r: RecommendationView) =>
    r.dependsOn?.recommendationId != null &&
    awaiting.some((o) => o.id === r.dependsOn?.recommendationId)
      ? r.dependsOn.recommendationId
      : null;
  const out: RecommendationView[] = [];
  for (const r of awaiting) {
    if (waits(r) !== null) continue;
    out.push(r);
    out.push(...awaiting.filter((w) => waits(w) === r.id));
  }
  // An instruction whose order itself waits elsewhere keeps its place at the end.
  out.push(...awaiting.filter((r) => !out.includes(r)));
  return out;
}

/**
 * The queue's two parts. Ids are issued in the order proposals are made, so they order the queue:
 * awaiting ascending (oldest first), with an instruction after the order it waits for; decided
 * descending (newest first).
 */
export function queueOrder(items: RecommendationView[]): {
  awaiting: RecommendationView[];
  decided: RecommendationView[];
} {
  return {
    awaiting: ordersFirst(
      items.filter((r) => r.status === "pending").sort((a, b) => (a.id < b.id ? -1 : 1)),
    ),
    decided: items.filter((r) => r.status !== "pending").sort((a, b) => (a.id > b.id ? -1 : 1)),
  };
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-1 border-b border-line px-3 pt-3.5 pb-2.5">
      <h1 className="text-base font-medium text-text-1 font-title">Approvals</h1>
      <p className="text-xs text-text-2">
        The assistant proposes; nothing is ordered or sent until you approve.
      </p>
    </div>
  );
}

function QueueSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-1.5">
        <h2 id={id} className="text-sm font-medium text-text-1 font-title">
          {title}
        </h2>
        <span className="text-xs text-text-3 tabular-nums">{count}</span>
      </div>
      {children}
    </section>
  );
}

export function ApprovalsPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
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
      // An approved order or instruction changes the vessel's alert and the voyage's route.
      void client.invalidateQueries({ queryKey: queryKeys.vessels });
      void client.invalidateQueries({ queryKey: ["voyages"] });
      void client.invalidateQueries({ queryKey: queryKeys.drafts(id) });
      void client.invalidateQueries({ queryKey: auditKey(id) });
    },
  });

  const propose = useProposeRecommendation();
  const onPropose = (body: ProposeBody) =>
    propose.mutate(body, {
      onSuccess: ({ recommendationId: id, created }) => {
        // The list is refetched by now, so the new order is in the queue: select it.
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set("recommendation", String(id));
          return next;
        });
        toast.success(
          created
            ? `Proposal ${id} is waiting for your decision`
            : `Proposal ${id} was already waiting for your decision`,
          { description: "Nothing is ordered until you approve it." },
        );
      },
      onError: (err) =>
        toast.error(
          `The ${body.type === "security_order" ? "security order" : "purchase order"} was not proposed`,
          {
            description: describeFailure(err),
          },
        ),
    });

  const items = list.data?.items;
  const { awaiting, decided } = useMemo(() => queueOrder(items ?? []), [items]);
  const fallback = awaiting[0] ?? decided[0] ?? null;
  const selected =
    linked === null ? fallback : ((items ?? []).find((r) => r.id === linked) ?? null);
  const selectedId = selected?.id ?? null;

  // Arriving from an assistant link: bring the selected proposal's row into view in the queue.
  useEffect(() => {
    if (selectedId !== null) {
      document.getElementById(`queue-${selectedId}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [selectedId]);

  const inFlight = decide.isPending ? decide.variables : null;

  const onDecide = (id: number) => (decision: Decision) => {
    // Pin the selection first, so the outcome stays in view when the list refetches.
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("recommendation", String(id));
        return next;
      },
      { replace: true },
    );
    return decide.mutateAsync({ id, decision }).catch(() => undefined);
  };

  if (list.isPending || list.isError || (items ?? []).length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader />
        <div className="p-3">
          {list.isPending ? (
            <div
              role="status"
              className="flex max-w-[860px] flex-col gap-2"
              aria-label="Loading proposals"
            >
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : list.isError ? (
            <ErrorState
              error={list.error}
              title="The proposals could not be loaded"
              onRetry={() => void list.refetch()}
            />
          ) : (
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
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="@container/approvals h-full">
      <div className="flex min-h-full flex-col @3xl/approvals:h-full @3xl/approvals:flex-row">
        <aside
          aria-label="Approval queue"
          className="shrink-0 border-b border-line bg-ink-900 @3xl/approvals:w-[300px] @3xl/approvals:overflow-auto @3xl/approvals:border-r @3xl/approvals:border-b-0"
        >
          <PageHeader />
          <QueueSection title="Awaiting your decision" count={awaiting.length}>
            {awaiting.length === 0 ? (
              <p className="px-3 pb-3 text-xs text-text-2">Nothing is awaiting a decision.</p>
            ) : (
              <ul className="border-t border-line">
                {awaiting.map((rec) => (
                  <QueueRow key={rec.id} rec={rec} selected={rec.id === selectedId} />
                ))}
              </ul>
            )}
          </QueueSection>
          <QueueSection title="Decided" count={decided.length}>
            {decided.length === 0 ? (
              <p className="px-3 pb-4 text-xs text-text-2">
                Approved and rejected proposals land here with their audit trail.
              </p>
            ) : (
              <ul className="border-t border-line">
                {decided.map((rec) => (
                  <QueueRow key={rec.id} rec={rec} selected={rec.id === selectedId} />
                ))}
              </ul>
            )}
          </QueueSection>
        </aside>

        {selected ? (
          <ProposalDetail
            key={selected.id}
            rec={selected}
            focal={selected.status === "pending"}
            pending={inFlight?.id === selected.id ? inFlight.decision : null}
            locked={decide.isPending}
            conflict={conflicts[selected.id] ?? null}
            onDecide={onDecide(selected.id)}
            proposing={propose.isPending}
            onPropose={onPropose}
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 px-4 py-5 sm:px-6">
            <p role="status" className="text-base font-medium text-text-1">
              Proposal {linked} is not in the list.
            </p>
            <p className="text-xs text-text-2">Choose one from the queue.</p>
            {fallback ? (
              <Link
                to={{ search: `?recommendation=${fallback.id}` }}
                className="text-xs text-beacon underline-offset-3 hover:underline"
              >
                {fallback.status === "pending"
                  ? "Open the first awaiting proposal"
                  : "Open the newest decided proposal"}
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
