/**
 * One proposal as the API returned it: what it is, the expected saving (signed, as returned), the
 * facts behind it as chips, and the gate and data tags. While pending it carries the decision
 * controls and shows its facts. Once decided it folds to its header, title, saving and outcome
 * (PO number and ERP state, or route/speed/ETA); the facts, the drafted messages (read-only) and
 * the audit trail open from one disclosure.
 */
import { AlertCircleIcon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Fact, RecommendationView } from "@pharos/shared";
import { useState } from "react";
import { FactChip, FactLedgerProvider } from "@/components/fact-chip";
import { FactText } from "@/components/fact-text";
import { ApprovalCard, type Decision } from "@/components/primitives/approval-card";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumber, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditTrail } from "./audit-trail";
import { ProposalDecision } from "./decision-dialog";
import { DraftsList } from "./drafts-list";

const FACTS_SHOWN = 6;

/** "+USD 18,250" / "-USD 300": the API's value with its sign made explicit. Display only. */
export function signedUsd(value: number): string {
  const text = formatNumber(Math.abs(value), "USD");
  return value < 0 ? `-${text}` : `+${text}`;
}

const SYNC: Record<NonNullable<RecommendationView["order"]>["erpSyncStatus"], string> = {
  synced: "synced",
  pending: "pending",
  failed: "not synced, will retry",
};

function Outcome({ rec }: { rec: RecommendationView }) {
  if (rec.status === "rejected")
    return <span className="text-xs text-text-2">Rejected. Nothing was written or drafted.</span>;
  if (rec.status === "failed")
    return <span className="text-xs text-alarm">The executor failed; see the audit trail.</span>;
  if (rec.order) {
    return (
      <span className="text-xs text-text-1">
        {rec.order.erpPoNumber ? (
          <>
            Purchase order <span className="font-mono">{rec.order.erpPoNumber}</span>
          </>
        ) : (
          "Purchase order written"
        )}
        <span className="text-text-2">, ERP sync: {SYNC[rec.order.erpSyncStatus]}</span>
      </span>
    );
  }
  if (rec.instruction) {
    return (
      <span className="text-xs text-text-1">
        Instruction recorded: <span className="font-mono">{rec.instruction.candidateId}</span> at{" "}
        {formatNumber(rec.instruction.speedKn, "kn")}, ETA {formatUtc(rec.instruction.eta)}
      </span>
    );
  }
  return <span className="text-xs text-text-2">Waiting for the executor.</span>;
}

function FactsBehind({ facts }: { facts: Fact[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? facts : facts.slice(0, FACTS_SHOWN);
  return (
    <section aria-label="Facts behind this proposal" className="flex flex-col">
      <h4 className="pb-1 text-xs text-text-2 font-label">Facts behind it</h4>
      <ul className="flex flex-col border border-line">
        {shown.map((f) => (
          <li
            key={f.id}
            className="flex min-h-7 items-center justify-between gap-3 border-b border-line px-2 text-xs last:border-b-0"
          >
            <span className="min-w-0 text-text-2">{f.label}</span>
            <span className="flex shrink-0 items-baseline">
              <FactChip fact={f} />
            </span>
          </li>
        ))}
      </ul>
      {facts.length > FACTS_SHOWN ? (
        <Button variant="ghost" size="sm" className="mt-1 w-fit" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show ${facts.length - FACTS_SHOWN} more`}
        </Button>
      ) : null}
    </section>
  );
}

export function RecommendationCard({
  rec,
  focal,
  linked,
  pending,
  locked,
  conflict,
  onDecide,
}: {
  rec: RecommendationView;
  focal: boolean;
  linked: boolean;
  /** The decision in flight on this card, if any. */
  pending: Decision | null;
  /** Another decision is in flight: every control waits (single-flight). */
  locked: boolean;
  /** Set when a decision found this proposal already decided; the status then comes from a refetch. */
  conflict: string | null;
  onDecide: (decision: Decision) => Promise<unknown>;
}) {
  const isPending = rec.status === "pending";
  const decided = !isPending;
  const [open, setOpen] = useState(linked);
  const drafted = rec.status !== "rejected" && rec.status !== "failed";
  const disclosure = drafted ? "Facts, drafted messages and audit trail" : "Facts and audit trail";

  return (
    <div id={`rec-${rec.id}`} className={cn(linked && "outline outline-1 outline-beacon/60")}>
      <FactLedgerProvider facts={rec.facts}>
        <ApprovalCard
          type={rec.type}
          status={rec.status}
          focal={focal}
          title={<FactText text={rec.summary} facts={rec.facts} />}
          tags={
            <>
              <span
                className={cn("text-2xs", rec.gatePassed === false ? "text-alarm" : "text-text-3")}
              >
                {rec.gatePassed === null
                  ? "gate: not asked"
                  : rec.gatePassed
                    ? "gate passed"
                    : "gate not passed"}
              </span>
              <DataTag kind="simulated" />
            </>
          }
          footer={
            isPending ? (
              <ProposalDecision
                type={rec.type}
                pending={pending}
                disabled={locked}
                onDecide={onDecide}
              />
            ) : (
              <Outcome rec={rec} />
            )
          }
        >
          <dl className="flex flex-col gap-1 text-xs">
            {rec.optionLabel ? (
              <div className="flex items-baseline gap-2">
                <dt className="text-text-3">Option</dt>
                <dd data-testid="option-name" className="text-text-1">
                  {rec.optionLabel}
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline gap-2">
              <dt className="text-text-3">Expected saving</dt>
              <dd className="text-text-1">
                {rec.expectedSaving && typeof rec.expectedSaving.value === "number" ? (
                  <FactChip fact={rec.expectedSaving}>
                    {signedUsd(rec.expectedSaving.value)}
                  </FactChip>
                ) : (
                  <span className="text-text-3">not stated</span>
                )}
              </dd>
            </div>
          </dl>
          {conflict ? (
            <p
              role="status"
              className="flex items-start gap-1.5 rounded-sm border border-line px-2 py-1.5 text-xs text-text-1"
            >
              <HugeiconsIcon
                icon={AlertCircleIcon}
                strokeWidth={2}
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-caution"
              />
              <span>{conflict}</span>
            </p>
          ) : null}
          {decided ? (
            <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
              <CollapsibleTrigger
                className={cn(
                  "-mx-1 flex h-7 w-fit items-center gap-1.5 rounded-sm px-1 text-xs text-text-2",
                  "outline-none hover:bg-ink-800 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-beacon/40",
                )}
              >
                {disclosure}
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  strokeWidth={2}
                  aria-hidden
                  className={cn(
                    "size-3 transition-transform duration-150",
                    open ? "rotate-180" : "rotate-0",
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-2">
                {rec.facts.length > 0 ? <FactsBehind facts={rec.facts} /> : null}
                {drafted ? <DraftsList recommendationId={rec.id} /> : null}
                <AuditTrail recommendationId={rec.id} />
              </CollapsibleContent>
            </Collapsible>
          ) : rec.facts.length > 0 ? (
            <FactsBehind facts={rec.facts} />
          ) : null}
        </ApprovalCard>
      </FactLedgerProvider>
    </div>
  );
}
