/**
 * An agent proposal waiting for a person (Beautiful UI's approval-card pattern, composed from
 * shadcn `alert-dialog` and `button`). The card lays out what was proposed and its facts; the
 * `DecisionButtons` are the only controls in the console that commit a business action, and each
 * asks first, in words, what will happen.
 */
import type { RecommendationStatus, RecommendationView } from "@pharos/shared";

type RecommendationType = RecommendationView["type"];

import type { ReactNode } from "react";
import { type FlagKind, StateFlag } from "@/components/primitives/state-flag";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const RECOMMENDATION_KIND: Record<RecommendationType, string> = {
  purchase_order: "Purchase order",
  voyage_instruction: "Voyage instruction",
  security_order: "Security order",
};

/** A proposal's status in words, with the hue whose job it is. */
export const RECOMMENDATION_STATUS: Record<RecommendationStatus, { text: string; tone: string }> = {
  pending: { text: "awaiting approval", tone: "text-caution" },
  approved: { text: "approved", tone: "text-text-1" },
  executing: { text: "executing", tone: "text-text-2" },
  executed: { text: "executed", tone: "text-text-1" },
  rejected: { text: "rejected", tone: "text-alarm" },
  failed: { text: "failed", tone: "text-alarm" },
};

/** The flag that stands beside each status word (none for the in-between states). */
export const RECOMMENDATION_FLAG: Partial<Record<RecommendationStatus, FlagKind>> = {
  pending: "K",
  approved: "C",
  executed: "C",
  rejected: "N",
};

/** A status word with its flag beside it. */
export function StatusWord({ status, text }: { status: RecommendationStatus; text?: string }) {
  const s = RECOMMENDATION_STATUS[status];
  const flag = RECOMMENDATION_FLAG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", s.tone)}>
      {flag ? <StateFlag kind={flag} /> : null}
      {text ?? s.text}
    </span>
  );
}

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
  return (
    <article
      data-status={status}
      className={cn("relative flex flex-col border border-line bg-ink-900", className)}
    >
      {focal && status === "pending" ? <BorderBeam size={64} duration={8} /> : null}
      <header className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5">
        <span className="text-xs text-text-2 font-label">{RECOMMENDATION_KIND[type]}</span>
        <span className="text-xs">
          <StatusWord status={status} />
        </span>
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
  approveLabel = "Approve",
  rejectLabel = "Reject",
  approveTitle = "Approve this proposal?",
  approveSummary,
  approveName,
  pending = null,
  disabled = false,
  approveDisabled = false,
  approveDescribedBy,
}: {
  onApprove: () => Promise<unknown> | undefined;
  onReject: () => Promise<unknown> | undefined;
  /** What approving does, in full, e.g. "Writes a purchase order and pushes it to the ERP simulator." */
  approveConsequence: ReactNode;
  rejectConsequence: ReactNode;
  confirmApproveLabel?: string;
  confirmRejectLabel?: string;
  /** The triggers' words, e.g. "Approve purchase order…" (the ellipsis: a confirmation follows). */
  approveLabel?: string;
  rejectLabel?: string;
  /** The approve confirmation's title: the order restated, e.g. "Order 300 mt LSMGO from … at …?". */
  approveTitle?: ReactNode;
  /** Rows between the title and the consequence (the figures the approver is agreeing to). */
  approveSummary?: ReactNode;
  /** The Approve trigger's accessible name, so each proposal's button is distinct. */
  approveName?: string;
  /** The decision in flight, if any: both controls wait (single-flight). */
  pending?: Decision | null;
  disabled?: boolean;
  /** Approve alone is off (e.g. it waits for another approval); Reject stays open. */
  approveDisabled?: boolean;
  /** The id of the text beside the controls that says why Approve is off. */
  approveDescribedBy?: string;
}) {
  const busy = pending !== null || disabled;

  // Each button is the Radix trigger of its own dialog, so closing it returns focus to the button.
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            disabled={busy}
            className="hover:border-alarm/60 hover:text-alarm"
          >
            {pending === "reject" ? "Rejecting…" : rejectLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this proposal?</AlertDialogTitle>
            <AlertDialogDescription>{rejectConsequence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it pending</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void onReject()}>
              {confirmRejectLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="commit"
            disabled={busy || approveDisabled}
            aria-label={pending ? undefined : approveName}
            aria-describedby={approveDisabled ? approveDescribedBy : undefined}
          >
            {pending === "approve" ? "Approving…" : approveLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{approveTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                {approveSummary}
                <p>{approveConsequence}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it pending</AlertDialogCancel>
            <AlertDialogAction variant="commit" onClick={() => void onApprove()}>
              {confirmApproveLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
