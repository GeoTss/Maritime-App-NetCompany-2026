/**
 * What a proposal commits to, as four cited readouts. A purchase order reads its bunker plan's own
 * facts for the proposed option: grade and quantity, headline price, total delivered cost and the
 * delay to the voyage. A voyage instruction reads its route by name and the facts of that route by
 * output path: recommended speed, ETA and total voyage cost. Every number is the API's fact as a
 * chip; the UI adds none of its own, and a fact that is missing reads "not stated".
 */
import type { BunkerOptionView, Fact, RecommendationView } from "@pharos/shared";
import type { ReactNode } from "react";
import { FactChip } from "@/components/fact-chip";
import { cn } from "@/lib/utils";

/** The plan option a purchase order buys, or null (an instruction, or an unreadable plan). */
export function proposedOption(rec: RecommendationView): BunkerOptionView | null {
  return rec.bunkerPlan?.options.find((o) => o.optionId === rec.optionId) ?? null;
}

/** One of an option's view facts by its short name ("quantity", "EU ETS cost"). */
export const rowFact = (option: BunkerOptionView | null, name: string): Fact | null =>
  option?.rows.find((r) => r.name === name)?.fact ?? null;

/** A proposal's calculation fact by the end of its output path, e.g. ".speedKn". */
export function factAtPath(facts: Fact[], suffix: string): Fact | null {
  return (
    facts.find(
      (f) => f.provenance.source === "calculation" && f.provenance.path.endsWith(suffix),
    ) ?? null
  );
}

/**
 * The facts a purchase order is summarised by: the plan option's when the plan is readable, else
 * the proposal's own facts by output path.
 */
export function orderFacts(rec: RecommendationView) {
  const option = proposedOption(rec);
  const at = (suffix: string) => factAtPath(rec.facts, suffix);
  return {
    grade: rec.bunkerPlan?.grade ?? null,
    quantity: rowFact(option, "quantity") ?? at(".qtyMt"),
    headlinePrice: option?.headlinePrice ?? at(".headlinePriceUsdPerMt"),
    totalCost: option?.totalCost ?? at(".totalCostUsd"),
    delay: option?.delay ?? at(".delayHours"),
    etsCost: rowFact(option, "EU ETS cost") ?? at(".etsCostUsd"),
    fuelEuCost: rowFact(option, "FuelEU exposure") ?? at(".fuelEuCostUsd"),
  };
}

/** The facts a voyage instruction is summarised by, from its route's outputs. */
export function instructionFacts(rec: RecommendationView) {
  const at = (suffix: string) => factAtPath(rec.facts, suffix);
  return {
    speed: at(".speedKn"),
    eta: at(".eta"),
    totalCost: at(".totalCostUsd"),
    etsCost: at(".etsCostUsd"),
    fuelEuCost: at(".fuelEuCostUsd"),
  };
}

const NotStated = () => <span className="text-text-3">not stated</span>;

/** A cited readout, or "not stated" when the API returned no such fact. */
export const Cited = ({ fact, className }: { fact: Fact | null; className?: string }) =>
  fact ? <FactChip fact={fact} className={className} /> : <NotStated />;

/** "EU ETS (USD 441)": a cost the total counts, cited, or its name alone when it was not returned. */
function Counted({ name, fact }: { name: string; fact: Fact | null }) {
  return (
    <>
      {name}
      {fact ? (
        <>
          {" "}
          {/* The brackets stay with the figure when the line wraps. */}
          <span className="whitespace-nowrap">
            (<FactChip fact={fact} />)
          </span>
        </>
      ) : null}
    </>
  );
}

export function OrderSummary({ rec, className }: { rec: RecommendationView; className?: string }) {
  const isOrder = rec.type === "purchase_order";
  let readouts: { term: string; value: ReactNode }[];
  let counts: ReactNode;

  if (isOrder) {
    const o = orderFacts(rec);
    readouts = [
      {
        term: "Grade and quantity",
        value: (
          <>
            <Cited fact={o.quantity} />
            {o.grade ? <span className="text-text-2"> {o.grade}</span> : null}
          </>
        ),
      },
      { term: "Headline price", value: <Cited fact={o.headlinePrice} /> },
      { term: "Total delivered cost", value: <Cited fact={o.totalCost} /> },
      { term: "Delay to the voyage", value: <Cited fact={o.delay} /> },
    ];
    counts = (
      <>
        Total delivered cost counts the fuel, barge fee, deviation and delay,{" "}
        <Counted name="EU ETS" fact={o.etsCost} /> and{" "}
        <Counted name="FuelEU exposure" fact={o.fuelEuCost} />.
      </>
    );
  } else {
    const v = instructionFacts(rec);
    readouts = [
      {
        term: "Route",
        value: rec.optionLabel ? (
          <span data-testid="option-name">{rec.optionLabel}</span>
        ) : (
          <NotStated />
        ),
      },
      { term: "Recommended speed", value: <Cited fact={v.speed} /> },
      { term: "ETA", value: <Cited fact={v.eta} /> },
      { term: "Total voyage cost", value: <Cited fact={v.totalCost} /> },
    ];
    counts = (
      <>
        Total voyage cost counts the fuel, <Counted name="EU ETS" fact={v.etsCost} />,{" "}
        <Counted name="FuelEU exposure" fact={v.fuelEuCost} /> and the vessel's time.
      </>
    );
  }

  return (
    <section
      aria-label={isOrder ? "The order" : "The instruction"}
      className={cn("border border-line bg-ink-900", className)}
    >
      {/* Hairlines between cells: the grid's 1 px gaps show the line colour behind them. */}
      <dl className="grid grid-cols-2 gap-px bg-line @2xl:grid-cols-4">
        {readouts.map((r) => (
          <div key={r.term} className="flex min-w-0 flex-col gap-1 bg-ink-900 px-3 py-2.5">
            <dt className="text-2xs font-medium text-text-2 font-label">{r.term}</dt>
            <dd className="min-w-0 text-base break-words text-text-1">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-3 py-2 text-xs text-text-2">{counts}</p>
    </section>
  );
}
