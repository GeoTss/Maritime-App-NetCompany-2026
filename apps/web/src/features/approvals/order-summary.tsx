/**
 * What a proposal commits to, as four cited readouts. A purchase order reads its bunker plan's own
 * facts for the proposed option: grade and quantity, headline price, total delivered cost and the
 * delay to the voyage. A voyage instruction reads its route by name and the facts of that one route
 * option by output path: recommended speed, ETA and total voyage cost. Every number is the API's fact as a
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

/** A route option's or a stop plan's own field: `options[1].eta`, `stopPlans[0].speedKn`. */
const OPTION_PATH = /^((?:options|stopPlans)\[\d+\])\.([A-Za-z]+)$/;

/**
 * Reads a proposal's calculation facts of ONE option, by field (`options[i].<field>`, or
 * `stopPlans[i].<field>` for an instruction that calls at a bunker port). The option
 * is the single index under which the key fields are cited. If they are cited under more than one
 * option (another route's total beside this one's), which one the proposal is cannot be told from
 * the facts, so every field reads null ("not stated") rather than a guess. Facts of other fields
 * under other options do not matter: only the key fields decide.
 */
export function oneOptionFacts(facts: Fact[], keys: readonly string[]) {
  const byPath = new Map<string, Fact>();
  const indices = new Set<string>();
  for (const f of facts) {
    if (f.provenance.source !== "calculation") continue;
    const [, index, field] = OPTION_PATH.exec(f.provenance.path) ?? [];
    if (index === undefined || field === undefined) continue;
    if (!byPath.has(f.provenance.path)) byPath.set(f.provenance.path, f);
    if (keys.includes(field)) indices.add(index);
  }
  const index = indices.size === 1 ? ([...indices][0] ?? null) : null;
  return (field: string): Fact | null =>
    index === null ? null : (byPath.get(`${index}.${field}`) ?? null);
}

/**
 * The facts a purchase order is summarised by: the plan option's when the plan is readable, else
 * the proposal's own facts of one option (see `oneOptionFacts`).
 */
export function orderFacts(rec: RecommendationView) {
  const option = proposedOption(rec);
  const at = oneOptionFacts(rec.facts, [
    "qtyMt",
    "headlinePriceUsdPerMt",
    "totalCostUsd",
    "delayHours",
  ]);
  return {
    grade: rec.bunkerPlan?.grade ?? null,
    quantity: rowFact(option, "quantity") ?? at("qtyMt"),
    headlinePrice: option?.headlinePrice ?? at("headlinePriceUsdPerMt"),
    totalCost: option?.totalCost ?? at("totalCostUsd"),
    delay: option?.delay ?? at("delayHours"),
    etsCost: rowFact(option, "EU ETS cost") ?? at("etsCostUsd"),
    fuelEuCost: rowFact(option, "FuelEU exposure") ?? at("fuelEuCostUsd"),
  };
}

/**
 * The facts a voyage instruction is summarised by: speed, ETA and total voyage cost of one route
 * option, and that option's EU ETS and FuelEU costs.
 */
export function instructionFacts(rec: RecommendationView) {
  const at = oneOptionFacts(rec.facts, ["speedKn", "eta", "totalCostUsd"]);
  return {
    speed: at("speedKn"),
    eta: at("eta"),
    totalCost: at("totalCostUsd"),
    etsCost: at("etsCostUsd"),
    fuelEuCost: at("fuelEuCostUsd"),
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
      {
        term: rec.dependsOn ? "Plan total" : "Total voyage cost",
        value: <Cited fact={v.totalCost} />,
      },
    ];
    // An instruction with a bunker stop is the plan's total: the voyage and the fuel it buys.
    counts = rec.dependsOn ? (
      <>
        Plan total counts the voyage (fuel burned, EU ETS, FuelEU exposure and the vessel's time),
        the fuel bought at the stop and the barge fee.
      </>
    ) : (
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
