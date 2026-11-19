/**
 * One proposal, in two forms. `QueueRow` is its line in the approvals queue: kind, status, the
 * summary as a link that selects it, and its two headline figures as fact chips. `ProposalDetail`
 * is the decision itself:
 * - the header (kind, status, release gate, simulated data) and the summary;
 * - the order (or instruction) as four cited facts;
 * - for a purchase order, why this option and not the cheapest price: every option of the plan by
 *   headline price against total delivered cost, and the margin over the runner-up as a fact;
 * - the facts behind it, the drafted messages and the audit trail, behind disclosures;
 * - a sticky bar that says in words what approving does, with Reject and Approve. Once decided,
 *   the bar shows the outcome (PO number and ERP state, or route, speed and ETA).
 *
 * Every number is the API's fact as a chip. The detail's ledger holds the proposal's facts and the
 * whole plan's, so a derived fact (the margin) resolves its operands.
 */
import { AlertCircleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { BunkerPlanView, Fact, ProposeBody, RecommendationView } from "@pharos/shared";
import { type ReactNode, useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { FactChip, FactLedgerProvider } from "@/components/fact-chip";
import { FactText } from "@/components/fact-text";
import {
  type Decision,
  RECOMMENDATION_KIND,
  StatusWord,
} from "@/components/primitives/approval-card";
import { DataTag } from "@/components/source-badge";
import { BorderBeam } from "@/components/ui/border-beam";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumber, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditTrail } from "./audit-trail";
import { ProposalDecision } from "./decision-dialog";
import { approveHeld, DependencyLine, orderToPropose } from "./dependency-line";
import { DraftsList } from "./drafts-list";
import {
  instructionFacts,
  isStopPlanOrder,
  OrderSummary,
  orderFacts,
  proposedOption,
} from "./order-summary";
import { byHeadlinePrice, PriceVsTotalChart } from "./price-vs-total-chart";

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

/** The executor has run (or is running): its drafts may exist. */
const DRAFTED_STATUSES = new Set<RecommendationView["status"]>([
  "approved",
  "executing",
  "executed",
]);

/**
 * The calculation a proposal comes from: an order bought at a route plan's bunker stop comes from
 * that route plan, not a bunker plan.
 */
const planName = (rec: RecommendationView) =>
  `${rec.type === "purchase_order" && !isStopPlanOrder(rec) ? "bunker" : "route"} plan ${rec.calculationId}`;

/** Every fact of a bunker plan view: each option's rows and the margin. */
export function planFacts(plan: BunkerPlanView): Fact[] {
  const facts = plan.options.flatMap((o) => [
    o.headlinePrice,
    o.totalCost,
    o.delay,
    ...o.rows.map((r) => r.fact),
  ]);
  return plan.marginVsRunnerUp ? [...facts, plan.marginVsRunnerUp] : facts;
}

// ---- The queue row -----------------------------------------------------------------------------

/** A row's two figures: quantity and total for an order, speed and ETA for an instruction. */
type Figure = { key: string; prefix?: string; fact: Fact };

function rowFigures(rec: RecommendationView): Figure[] {
  let figures: { key: string; prefix?: string; fact: Fact | null }[];
  if (rec.type === "purchase_order") {
    // A route-plan stop's order: the cost of the fuel bought, never the whole plan's total.
    const o = orderFacts(rec);
    figures = [
      { key: "qty", fact: o.quantity },
      { key: "total", fact: o.kind === "stop_plan" ? o.fuelBought : o.totalCost },
    ];
  } else {
    const v = instructionFacts(rec);
    figures = [
      { key: "speed", fact: v.speed },
      { key: "eta", prefix: "ETA ", fact: v.eta },
    ];
  }
  return figures.filter((f): f is Figure => f.fact !== null);
}

export function QueueRow({ rec, selected }: { rec: RecommendationView; selected: boolean }) {
  const figures = rowFigures(rec);
  return (
    <li
      id={`queue-${rec.id}`}
      data-recommendation-id={rec.id}
      className={cn("relative border-b border-line", selected ? "bg-ink-800" : "hover:bg-ink-850")}
    >
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-beacon" /> : null}
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <span className="flex items-center gap-2 text-2xs font-medium font-label">
          <span className="text-text-2">{RECOMMENDATION_KIND[rec.type]}</span>
          <StatusWord status={rec.status} />
        </span>
        {/* The whole row selects (the link's ::after covers it); its chips sit above and open. */}
        <Link
          to={{ search: `?recommendation=${rec.id}` }}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "text-sm font-medium text-pretty text-text-1 outline-none",
            "after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-beacon/60",
          )}
        >
          {rec.summary}
        </Link>
        <span className="pointer-events-none relative flex items-baseline justify-between gap-3 text-xs text-text-2 [&_[data-slot=fact-chip]]:pointer-events-auto">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            {figures.map((f, i) => (
              <span key={f.key} className="flex items-baseline gap-x-1.5">
                {i > 0 ? (
                  <span aria-hidden className="text-text-3">
                    ·
                  </span>
                ) : null}
                <span>
                  {f.prefix}
                  <FactChip fact={f.fact} />
                </span>
              </span>
            ))}
          </span>
          <span className="shrink-0 text-text-3">{planName(rec)}</span>
        </span>
      </div>
    </li>
  );
}

// ---- The decision ------------------------------------------------------------------------------

function Outcome({ rec }: { rec: RecommendationView }) {
  if (rec.status === "rejected")
    return <span className="text-xs text-text-2">Rejected. Nothing was written or drafted.</span>;
  if (rec.status === "failed")
    return <span className="text-xs text-alarm">The executor failed; see the audit trail.</span>;
  if (rec.order) {
    const orderWord = rec.type === "security_order" ? "Security order" : "Purchase order";
    return (
      <span className="text-xs text-text-1">
        {rec.order.erpPoNumber ? (
          <>
            {orderWord} <span className="font-mono">{rec.order.erpPoNumber}</span>
          </>
        ) : (
          `${orderWord} written`
        )}
        <span className="text-text-2">, ERP sync: {SYNC[rec.order.erpSyncStatus]}</span>
      </span>
    );
  }
  if (rec.instruction) {
    const stop = rec.instruction.stop;
    return (
      <span className="text-xs text-text-1">
        Instruction recorded: {stop ? "" : `route ${rec.instruction.candidateId}`}
        {rec.optionLabel ? `${stop ? "" : ", "}${rec.optionLabel}` : ""}, at{" "}
        {formatNumber(rec.instruction.speedKn, "kn")}, ETA {formatUtc(rec.instruction.eta)}
        {stop ? (
          <>
            ; bunker stop at {stop.portName}, arrive {formatUtc(stop.arriveAt)}, depart{" "}
            {formatUtc(stop.departAt)}
          </>
        ) : null}
      </span>
    );
  }
  return <span className="text-xs text-text-2">Waiting for the executor.</span>;
}

/** What approving does, in words, before the confirmation says it again. */
function approveInWords(rec: RecommendationView): string {
  if (rec.type === "voyage_instruction") {
    const what = rec.dependsOn
      ? "The route, speed and bunker stop instruction is recorded"
      : "The route and speed instruction is recorded";
    return `${what}. The message to the master stays a draft; nothing is sent. You confirm in one more step.`;
  }
  if (rec.type === "security_order") {
    return `A security order is created in the ERP simulator for ${rec.optionLabel ?? "the team"}. The confirmation to the provider stays a draft; nothing goes to the provider. You confirm in one more step.`;
  }
  const supplier = proposedOption(rec)?.supplier;
  return `A purchase order is created in the ERP simulator. The confirmation to ${supplier ?? "the supplier"} stays a draft; nothing goes to the supplier. You confirm in one more step.`;
}

function DetailHeader({ rec }: { rec: RecommendationView }) {
  const pending = rec.status === "pending";
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-2xs font-medium font-label">
      <span className="text-text-2">{RECOMMENDATION_KIND[rec.type]}</span>
      <StatusWord status={rec.status} text={pending ? "awaiting your decision" : undefined} />
      <span className={cn("ml-auto", rec.gatePassed === false ? "text-alarm" : "text-text-3")}>
        {rec.gatePassed === null
          ? "release gate: not asked"
          : rec.gatePassed
            ? "release gate passed"
            : "release gate not passed"}
      </span>
      <DataTag kind="simulated" />
    </div>
  );
}

function DetailMeta({ rec }: { rec: RecommendationView }) {
  const plan = rec.bunkerPlan;
  const mapLink = plan
    ? `/?${new URLSearchParams({
        ...(plan.vesselId !== null ? { vessel: String(plan.vesselId) } : {}),
        bunkerPlan: String(plan.calculationId),
      })}`
    : null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <div className="flex items-baseline gap-1.5">
        <dt className="text-text-2">Expected saving</dt>
        <dd className="text-text-1">
          {rec.expectedSaving && typeof rec.expectedSaving.value === "number" ? (
            <FactChip fact={rec.expectedSaving}>{signedUsd(rec.expectedSaving.value)}</FactChip>
          ) : (
            <span className="text-text-3">not stated</span>
          )}
        </dd>
      </div>
      <div className="flex items-baseline gap-1.5">
        <dt className="text-text-2">From</dt>
        <dd className="text-text-1">
          {planName(rec)}
          {plan?.voyageNo ? (
            <>
              , voyage <span className="font-mono text-2xs">{plan.voyageNo}</span>
            </>
          ) : null}
          {mapLink ? (
            <>
              {" "}
              <Link to={mapLink} className="text-beacon underline-offset-3 hover:underline">
                Show on the map
              </Link>
            </>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}

/** "Why Kestrel Marine Fuels, not the cheapest price": the plan's options and the runner-up margin. */
function WhyThisOption({ rec, plan }: { rec: RecommendationView; plan: BunkerPlanView }) {
  const headingId = useId();
  // The why and the margin are claims about the plan's best option: they are made only when the
  // order is for that option. An order for another feasible option (propose_action allows it), or
  // a view that lacks the best option, gets the comparison alone.
  const chosen = proposedOption(rec);
  const best = chosen?.best ? chosen : null;
  const cheapest = byHeadlinePrice(plan.options)[0] ?? null;
  const heading = !best
    ? "The options compared"
    : cheapest && cheapest.optionId !== best.optionId
      ? `Why ${best.supplier}, not the cheapest price`
      : `Why ${best.supplier}`;
  const margin = best ? plan.marginVsRunnerUp : null;
  // The runner-up is the option whose total the margin subtracts from (its first operand).
  const runnerUpTotal =
    margin?.provenance.source === "derived" ? margin.provenance.operands[0] : undefined;
  const runnerUp = plan.options.find((o) => o.totalCost.id === runnerUpTotal) ?? null;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId} className="text-base font-medium text-text-1 font-title">
        {heading}
      </h3>
      {margin ? (
        <p className="mt-1 max-w-[72ch] text-xs text-text-2">
          <FactChip fact={margin} className="text-beacon" /> less than the runner-up
          {runnerUp ? `, ${runnerUp.supplier},` : ""} in total delivered cost, once delay and carbon
          are counted.
        </p>
      ) : null}
      <PriceVsTotalChart plan={plan} className="mt-3" />
    </section>
  );
}

function FactRow({ name, fact }: { name: string; fact: Fact }) {
  return (
    <li className="flex min-h-7 items-center justify-between gap-3 border-b border-line px-2 text-xs last:border-b-0">
      <span className="min-w-0 text-text-2">{name}</span>
      <span className="flex shrink-0 items-baseline">
        <FactChip fact={fact} />
      </span>
    </li>
  );
}

function FactGroup({
  title,
  tag,
  rows,
}: {
  title: string;
  tag?: ReactNode;
  rows: { name: string; fact: Fact }[];
}) {
  const id = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of read-only facts, not form controls (fieldset).
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <h4 id={id} className="text-xs font-medium text-text-1">
          {title}
        </h4>
        {tag}
      </div>
      <ul className="flex flex-col border border-line">
        {rows.map((r) => (
          <FactRow key={r.fact.id} name={r.name} fact={r.fact} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The facts behind the proposal. A purchase order with a readable plan groups them by option,
 * named by the plan's short field names, then the plan-wide ones; otherwise one list by label.
 */
function FactsBehind({ rec }: { rec: RecommendationView }) {
  const plan = rec.bunkerPlan;
  if (!plan) {
    return (
      <ul className="flex flex-col border border-line">
        {rec.facts.map((f) => (
          <FactRow key={f.id} name={f.label} fact={f} />
        ))}
      </ul>
    );
  }
  const inOptions = new Set(plan.options.flatMap((o) => o.rows.map((r) => r.fact.id)));
  const planWide = rec.facts.filter((f) => !inOptions.has(f.id));
  if (plan.marginVsRunnerUp && !planWide.some((f) => f.id === plan.marginVsRunnerUp?.id)) {
    planWide.push(plan.marginVsRunnerUp);
  }
  return (
    <div className="flex flex-col gap-3">
      {plan.options.map((o) => (
        <FactGroup
          key={o.optionId}
          title={`${o.supplier} at ${o.port.name}`}
          tag={
            o.best ? (
              <span className="text-2xs text-beacon">recommended</span>
            ) : o.feasible ? null : (
              <span className="text-2xs text-alarm">not feasible</span>
            )
          }
          rows={o.rows}
        />
      ))}
      {planWide.length > 0 ? (
        <FactGroup
          title="Across the plan"
          rows={planWide.map((f) => ({ name: f.label, fact: f }))}
        />
      ) : null}
    </div>
  );
}

function Disclosure({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-line">
      <CollapsibleTrigger
        className={cn(
          "flex min-h-9 w-full items-center gap-2 py-1.5 text-left text-sm font-medium text-text-1",
          "rounded-sm outline-none hover:bg-ink-850 focus-visible:ring-2 focus-visible:ring-beacon/40",
        )}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-text-2 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        {title}
        {hint ? <span className="text-xs font-normal text-text-3">{hint}</span> : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ActionBar({
  rec,
  pending,
  locked,
  conflict,
  onDecide,
}: {
  rec: RecommendationView;
  pending: Decision | null;
  locked: boolean;
  conflict: string | null;
  onDecide: (decision: Decision) => Promise<unknown>;
}) {
  const id = useId();
  const reasonId = useId();
  const isPending = rec.status === "pending";
  const held = approveHeld(rec);
  return (
    <section
      aria-labelledby={id}
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line-strong bg-ink-900 px-4 py-3 sm:px-6"
    >
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
        <h3 id={id} className="text-sm font-medium text-text-1">
          {isPending ? "If you approve" : "Outcome"}
        </h3>
        {conflict ? (
          <p role="status" className="flex items-start gap-1.5 text-xs text-text-1">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              strokeWidth={2}
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-caution"
            />
            <span>{conflict}</span>
          </p>
        ) : null}
        {isPending ? (
          <p className="max-w-[72ch] text-xs text-text-2">{approveInWords(rec)}</p>
        ) : (
          <p>
            <Outcome rec={rec} />
          </p>
        )}
      </div>
      {isPending ? (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          {held ? (
            <p
              id={reasonId}
              data-testid="approve-blocked"
              className="flex max-w-[44ch] items-start gap-1.5 text-xs text-text-2"
            >
              <HugeiconsIcon
                icon={AlertCircleIcon}
                strokeWidth={2}
                aria-hidden
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  held.blocked ? "text-alarm" : "text-text-2",
                )}
              />
              <span>{held.text}</span>
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <ProposalDecision
              rec={rec}
              pending={pending}
              disabled={locked}
              approveBlocked={held ? { reasonId } : null}
              onDecide={onDecide}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ProposalDetail({
  rec,
  focal,
  pending,
  locked,
  conflict,
  onDecide,
  proposing = false,
  onPropose,
}: {
  rec: RecommendationView;
  /** The page's one focal effect: on the selected decision while it awaits one. */
  focal: boolean;
  /** The decision in flight on this proposal, if any. */
  pending: Decision | null;
  /** Another decision is in flight: every control waits (single-flight). */
  locked: boolean;
  /** Set when a decision found this proposal already decided; the status then comes from a refetch. */
  conflict: string | null;
  onDecide: (decision: Decision) => Promise<unknown>;
  /** A proposal made from this one (an instruction's purchase order) is in flight. */
  proposing?: boolean;
  /** Proposes the purchase order an instruction waits for, when none is live. */
  onPropose?: (body: ProposeBody) => void;
}) {
  const headingId = useId();
  const order = onPropose ? orderToPropose(rec) : null;
  const plan = rec.bunkerPlan;
  const ledger = useMemo(() => [...rec.facts, ...(plan ? planFacts(plan) : [])], [rec.facts, plan]);
  const isOrder = rec.type === "purchase_order";
  const factCount = plan
    ? new Set([...planFacts(plan), ...rec.facts].map((f) => f.id)).size
    : rec.facts.length;

  return (
    <FactLedgerProvider facts={ledger}>
      <article
        aria-labelledby={headingId}
        data-recommendation-id={rec.id}
        data-status={rec.status}
        className="relative flex min-w-0 flex-1 flex-col @3xl/approvals:min-h-0"
      >
        {focal && rec.status === "pending" ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
            <BorderBeam size={64} duration={8} />
          </div>
        ) : null}
        <div className="flex flex-1 flex-col @3xl/approvals:min-h-0 @3xl/approvals:overflow-auto">
          <div className="@container flex-1 px-4 pt-5 pb-6 sm:px-6">
            <div className="flex max-w-[920px] flex-col">
              <DetailHeader rec={rec} />
              <h2
                id={headingId}
                className="mt-2 text-lg font-medium text-balance text-text-1 font-title @lg:text-xl"
              >
                <FactText text={rec.summary} facts={rec.facts} />
              </h2>
              <DetailMeta rec={rec} />
              <OrderSummary rec={rec} className="mt-5" />
              {rec.dependsOn ? (
                <DependencyLine
                  dep={rec.dependsOn}
                  propose={
                    order && onPropose
                      ? { pending: proposing, onPropose: () => onPropose(order) }
                      : null
                  }
                  className="mt-3"
                />
              ) : null}
              {isOrder && plan && plan.options.length > 0 ? (
                <WhyThisOption rec={rec} plan={plan} />
              ) : null}
              <div className="mt-6 border-t border-line">
                <Disclosure
                  title="Facts behind it"
                  hint={`${factCount} facts${plan ? ", grouped by option" : ""}`}
                >
                  <FactsBehind rec={rec} />
                </Disclosure>
                {DRAFTED_STATUSES.has(rec.status) ? (
                  <Disclosure title="Drafted messages" hint="never sent">
                    <DraftsList
                      recommendationId={rec.id}
                      heading={false}
                      emptyText="Nothing is drafted yet."
                    />
                  </Disclosure>
                ) : null}
                <Disclosure title="Audit trail">
                  <AuditTrail
                    recommendationId={rec.id}
                    heading={false}
                    emptyText="No events recorded yet."
                  />
                </Disclosure>
              </div>
            </div>
          </div>
          <ActionBar
            rec={rec}
            pending={pending}
            locked={locked}
            conflict={conflict}
            onDecide={onDecide}
          />
        </div>
      </article>
    </FactLedgerProvider>
  );
}
