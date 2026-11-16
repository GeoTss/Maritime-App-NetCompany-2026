/**
 * An agent proposal waiting for a person (Beautiful UI's approval-card pattern, composed from
 * shadcn `alert-dialog` and `button`). The card lays out what was proposed and its facts; the
 * `DecisionButtons` are the only controls in the console that commit a business action, and each
 * asks first, in words, what will happen.
 */
import type { RecommendationStatus, RecommendationView } from "@pharos/shared";

type RecommendationType = RecommendationView["type"];

import { type ReactNode, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const RECOMMENDATION_KIND: Record<RecommendationType, string> = {
  purchase_order: "Purchase order",
  voyage_instruction: "Voyage instruction",
};

const STATUS: Record<RecommendationStatus, { text: string; tone: string }> = {
  pending: { text: "awaiting approval", tone: "text-caution" },
  approved: { text: "approved", tone: "text-go" },
  executing: { text: "executing", tone: "text-text-2" },
  executed: { text: "executed", tone: "text-go" },
  rejected: { text: "rejected", tone: "text-alarm" },
  failed: { text: "failed", tone: "text-alarm" },
};

export function ApprovalCard({
  type,
  status,
  title,
  summary,
  tags,
  children,
  footer,
  focal = false,
  className,
}: {
  type: RecommendationType;
  status: RecommendationStatus;
  /** One line: what this proposal does (e.g. the supplier and port). */
  title: ReactNode;
  /** The proposal's summary as the API returned it. */
  summary?: ReactNode;
  /** Honesty tags: "simulated data", gate status. */
  tags?: ReactNode;
  /** The proposal's facts, as chips. */
  children?: ReactNode;
  /** `DecisionButtons` while pending; the outcome afterwards. */
  footer?: ReactNode;
  /** The page's one focal effect: the top card of the pending queue. */
  focal?: boolean;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <article
      data-status={status}
      className={cn("relative flex flex-col border border-line bg-ink-900", className)}
    >
      {focal && status === "pending" ? <BorderBeam size={64} duration={8} /> : null}
      <header className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5">
        <span className="text-xs text-text-2 font-label">{RECOMMENDATION_KIND[type]}</span>
        <span className={cn("text-xs whitespace-nowrap", s.tone)}>{s.text}</span>
        {tags ? (
          <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">{tags}</span>
        ) : null}
      </header>
      <div className="flex flex-col gap-2 p-3">
        <h3 className="text-base text-balance text-text-1 font-title">{title}</h3>
        {summary ? <div className="max-w-[72ch] text-sm text-text-2">{summary}</div> : null}
        {children}
      </div>
      {footer ? (
        <footer className="flex min-h-11 items-center gap-2 border-t border-line px-3 py-2">
          {footer}
        </footer>
      ) : null}
    </article>
  );
}

export type Decision = "approve" | "reject";

export function DecisionButtons({
  onApprove,
  onReject,
  approveConsequence,
  rejectConsequence,
  confirmApproveLabel = "Approve",
  confirmRejectLabel = "Reject",
  pending = null,
  disabled = false,
}: {
  onApprove: () => Promise<unknown> | undefined;
  onReject: () => Promise<unknown> | undefined;
  /** What approving does, in full, e.g. "Writes a purchase order and pushes it to the ERP simulator." */
  approveConsequence: ReactNode;
  rejectConsequence: ReactNode;
  confirmApproveLabel?: string;
  confirmRejectLabel?: string;
  /** The decision in flight, if any: both controls wait (single-flight). */
  pending?: Decision | null;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState<Decision | null>(null);
  const busy = pending !== null || disabled;

  const confirm = () => {
    const decision = asking;
    setAsking(null);
    if (decision === "approve") void onApprove();
    if (decision === "reject") void onReject();
  };

  return (
    <>
      <Button variant="commit" disabled={busy} onClick={() => setAsking("approve")}>
        {pending === "approve" ? "Approving…" : "Approve"}
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => setAsking("reject")}
        className="hover:border-alarm/60 hover:text-alarm"
      >
        {pending === "reject" ? "Rejecting…" : "Reject"}
      </Button>
      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {asking === "reject" ? "Reject this proposal?" : "Approve this proposal?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {asking === "reject" ? rejectConsequence : approveConsequence}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it pending</AlertDialogCancel>
            {asking === "reject" ? (
              <AlertDialogAction variant="destructive" onClick={confirm}>
                {confirmRejectLabel}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction variant="commit" onClick={confirm}>
                {confirmApproveLabel}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
