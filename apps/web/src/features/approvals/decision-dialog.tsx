/**
 * The decision controls of one proposal. Approve and Reject are the only controls in the console
 * that change anything; each opens a confirmation (the shared `DecisionButtons` alert dialog)
 * that says exactly what will happen, and nothing is ever sent to an outside party.
 */
import type { Fact, RecommendationView } from "@pharos/shared";
import type { ReactNode } from "react";
import { type Decision, DecisionButtons } from "@/components/primitives/approval-card";
import { formatNumber } from "@/lib/format";
import { instructionFacts, orderFacts, proposedOption, rowFact } from "./order-summary";

export const APPROVE_CONSEQUENCE: Record<RecommendationView["type"], string> = {
  purchase_order:
    "Approving pushes the order to the ERP simulator and drafts a supplier confirmation (not sent).",
  voyage_instruction:
    "Approving records the route and speed instruction and drafts a message to the master (not sent).",
};

export const REJECT_CONSEQUENCE =
  "Rejecting closes this proposal. Nothing is written to the ERP, no instruction is recorded and nothing is drafted.";

/** The Approve trigger's words: what is approved, and an ellipsis because a confirmation follows. */
export const APPROVE_LABEL: Record<RecommendationView["type"], string> = {
  purchase_order: "Approve purchase order…",
  voyage_instruction: "Approve voyage instruction…",
};

const text = (f: Fact) =>
  typeof f.value === "number" ? formatNumber(f.value, f.unit) : String(f.value);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1 text-sm">
      <dt className="text-text-2">{label}</dt>
      <dd className="text-text-1 tabular-nums">{value}</dd>
    </div>
  );
}

/** The order or instruction restated for the confirm: title, and the figures as the API returned them. */
function restate(rec: RecommendationView): { title: ReactNode; rows: ReactNode } {
  const fallback = { title: "Approve this proposal?", rows: null };
  const label = rec.optionLabel;
  if (!label) return fallback;
  if (rec.type === "purchase_order") {
    const f = orderFacts(rec);
    if (f.kind === "stop_plan") {
      // Bought at a route plan's bunker stop: the fuel and the barge fee, as the plan cites them.
      if (!f.quantity) return fallback;
      return {
        title: `Order ${text(f.quantity)} from ${label}?`,
        rows: (
          <dl>
            {f.fuelBought ? (
              <Row label="Cost of the fuel bought" value={text(f.fuelBought)} />
            ) : null}
            {f.bargeFee ? <Row label="Barge fee" value={text(f.bargeFee)} /> : null}
          </dl>
        ),
      };
    }
    const option = proposedOption(rec);
    if (!f.quantity || !f.grade) return fallback;
    const price = rowFact(option, "effective price (total cost per mt)");
    const margin = rec.bunkerPlan?.marginVsRunnerUp ?? null;
    return {
      title: `Order ${text(f.quantity)} ${f.grade} from ${label}?`,
      rows: (
        <dl>
          {f.totalCost ? (
            <Row
              label="Total delivered cost"
              value={price ? `${text(f.totalCost)} (${text(price)})` : text(f.totalCost)}
            />
          ) : null}
          {margin && option?.best ? (
            <Row label="Against the runner-up" value={text(margin)} />
          ) : null}
          {f.delay ? <Row label="Delay" value={text(f.delay)} /> : null}
        </dl>
      ),
    };
  }
  const f = instructionFacts(rec);
  if (!f.speed) return fallback;
  const subject = f.speed.label.split(",")[0];
  return {
    title: `Instruct ${subject ?? "the vessel"} to sail ${label} at ${text(f.speed)}?`,
    rows: null,
  };
}

export function ProposalDecision({
  rec,
  pending,
  disabled,
  approveBlocked = null,
  onDecide,
}: {
  rec: RecommendationView;
  pending: Decision | null;
  disabled: boolean;
  /** Approve is off: the id of the reason shown beside the controls. */
  approveBlocked?: { reasonId: string } | null;
  onDecide: (decision: Decision) => Promise<unknown>;
}) {
  const { type } = rec;
  const { title, rows } = restate(rec);
  const kind = type === "purchase_order" ? "Approve purchase order" : "Approve voyage instruction";
  return (
    <DecisionButtons
      pending={pending}
      disabled={disabled}
      approveDisabled={approveBlocked !== null}
      approveDescribedBy={approveBlocked?.reasonId}
      approveConsequence={APPROVE_CONSEQUENCE[type]}
      rejectConsequence={REJECT_CONSEQUENCE}
      confirmApproveLabel={
        type === "purchase_order"
          ? "Approve and create the order"
          : "Approve and record the instruction"
      }
      confirmRejectLabel="Reject"
      approveLabel={APPROVE_LABEL[type]}
      rejectLabel="Reject…"
      approveTitle={title}
      approveSummary={rows}
      approveName={rec.optionLabel ? `${kind}, ${rec.optionLabel}` : undefined}
      onApprove={() => onDecide("approve")}
      onReject={() => onDecide("reject")}
    />
  );
}
