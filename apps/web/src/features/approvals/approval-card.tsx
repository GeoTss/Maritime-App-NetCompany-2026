/**
 * One proposal as the API returned it: what it is, the expected saving (signed, as returned), the
 * facts behind it as chips, and the gate and data tags. While pending it carries the decision
 * controls; afterwards the outcome (PO number and ERP state, or route/speed/ETA), the drafted
 * messages (read-only) and the audit trail.
 */
import type { RecommendationView } from "@pharos/shared";
import { useState } from "react";
import { FactChip, FactLedgerProvider } from "@/components/fact-chip";
import { FactText } from "@/components/fact-text";
import { ApprovalCard, type Decision } from "@/components/primitives/approval-card";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
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
        <span className="text-text-2"> · ERP sync: {SYNC[rec.order.erpSyncStatus]}</span>
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
  const [all, setAll] = useState(false);
  const isPending = rec.status === "pending";
  const shown = all ? rec.facts : rec.facts.slice(0, FACTS_SHOWN);
  const savingFact =
    rec.expectedSavingUsd === null
      ? undefined
      : rec.facts.find((f) => f.value === rec.expectedSavingUsd);
  const decided = rec.status !== "pending";

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
          <dl className="flex items-baseline gap-2 text-xs">
            <dt className="text-text-3">Expected saving</dt>
            <dd className="text-text-1">
              {rec.expectedSavingUsd === null ? (
                <span className="text-text-3">not stated</span>
              ) : savingFact ? (
                <FactChip fact={savingFact}>{signedUsd(rec.expectedSavingUsd)}</FactChip>
              ) : (
                signedUsd(rec.expectedSavingUsd)
              )}
            </dd>
          </dl>
          {conflict ? (
            <p role="status" className="border-l-2 border-caution pl-2 text-xs text-text-1">
              {conflict}
            </p>
          ) : null}
          {rec.facts.length > 0 ? (
            <section aria-label="Facts behind this proposal" className="flex flex-col">
              <h4 className="pb-1 text-xs text-text-2 font-label">Facts behind it</h4>
              <ul className="flex flex-col border border-line">
                {shown.map((f) => (
                  <li
                    key={f.id}
                    className="flex min-h-7 items-center justify-between gap-3 border-b border-line px-2 text-xs last:border-b-0"
                  >
                    <span className="min-w-0 text-text-2">{f.label}</span>
                    <FactChip fact={f} />
                  </li>
                ))}
              </ul>
              {rec.facts.length > FACTS_SHOWN ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-fit"
                  onClick={() => setAll((a) => !a)}
                >
                  {all ? "Show fewer" : `Show ${rec.facts.length - FACTS_SHOWN} more`}
                </Button>
              ) : null}
            </section>
          ) : null}
          {decided ? (
            <>
              {rec.status !== "rejected" && rec.status !== "failed" ? (
                <DraftsList recommendationId={rec.id} />
              ) : null}
              <AuditTrail recommendationId={rec.id} />
            </>
          ) : null}
        </ApprovalCard>
      </FactLedgerProvider>
    </div>
  );
}
