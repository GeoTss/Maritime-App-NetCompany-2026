/**
 * Every option of a bunker plan ranked twice: on the left by headline price, on the right by total
 * delivered cost. A line joins each option's two places, so the option that is cheapest to buy but
 * dearest to take visibly crosses the one the plan recommends.
 *
 * Nothing here is calculated. The left order is a sort of the headline price facts the API
 * returned; the right order is the plan's own rank. The drawing is an image whose text alternative
 * names both ranks of every option; the figures beside it are fact chips in HTML, so each stays
 * focusable and opens its source.
 */
import type { BunkerOptionView, BunkerPlanView } from "@pharos/shared";
import { FactChip } from "@/components/fact-chip";
import { cn } from "@/lib/utils";

/** Height of one option's row, in px: the dots sit at its middle, beside its two labels. */
const ROW = 48;

const numeric = (o: BunkerOptionView) =>
  typeof o.headlinePrice.value === "number" ? o.headlinePrice.value : Number.POSITIVE_INFINITY;

/** The options by headline price, cheapest first (a stable sort: ties keep the plan's order). */
export function byHeadlinePrice(options: BunkerOptionView[]): BunkerOptionView[] {
  return [...options].sort((a, b) => {
    const x = numeric(a);
    const y = numeric(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** "1st", "2nd", "3rd", "11th": a place in a ranking, in words. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

const placeName = (o: BunkerOptionView) => `${o.supplier} at ${o.port.name}`;

function describe(plan: BunkerPlanView, headline: BunkerOptionView[]): string {
  const each = plan.options.map((o) => {
    const notes = [
      `${ordinal(headline.indexOf(o) + 1)} by headline price`,
      `${ordinal(o.rank)} by total delivered cost`,
      ...(o.best ? ["recommended"] : []),
      ...(o.feasible ? [] : ["not feasible"]),
    ];
    return `${placeName(o)}: ${notes.join(", ")}`;
  });
  return `Ranked by headline price against ranked by total delivered cost. ${each.join("; ")}.`;
}

function caption(plan: BunkerPlanView): string {
  const n = plan.options.length;
  const infeasible = plan.options.filter((o) => !o.feasible).length;
  const which =
    n === 1
      ? `The one option in bunker plan ${plan.calculationId}`
      : `All ${n} options from bunker plan ${plan.calculationId}`;
  const feasible =
    infeasible === 0
      ? n === 1
        ? ", feasible"
        : ", each feasible"
      : `; ${infeasible} not feasible`;
  return `${which}${feasible}. Each figure opens its source.`;
}

export function PriceVsTotalChart({
  plan,
  className,
}: {
  plan: BunkerPlanView;
  className?: string;
}) {
  const n = plan.options.length;
  if (n === 0) return null;
  const headline = byHeadlinePrice(plan.options);
  const middle = (index: number) => index * ROW + ROW / 2;
  // The recommended option's line is drawn last, so it sits on top where lines cross.
  const drawOrder = [...plan.options.filter((o) => !o.best), ...plan.options.filter((o) => o.best)];

  return (
    <figure className={cn("m-0 border border-line bg-ink-900 px-4 pt-3.5 pb-3", className)}>
      <div
        className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] gap-x-3 @md:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] @2xl:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]"
        style={{ gridTemplateRows: `auto repeat(${n}, ${ROW}px)` }}
      >
        <p className="col-start-1 row-start-1 pb-2 text-right text-2xs font-medium text-text-2 font-label">
          Ranked by headline price
        </p>
        <p className="col-start-3 row-start-1 pb-2 text-2xs font-medium text-text-2 font-label">
          Ranked by total delivered cost
        </p>

        <svg
          role="img"
          aria-label={describe(plan, headline)}
          width="100%"
          height={n * ROW}
          className="col-start-2 block overflow-visible"
          style={{ gridRow: `2 / span ${n}` }}
        >
          {drawOrder.map((o) => {
            const left = middle(headline.indexOf(o));
            const right = middle(plan.options.indexOf(o));
            const dot = o.best ? "fill-go" : "fill-text-3";
            return (
              <g key={o.optionId}>
                <line
                  data-best={o.best}
                  x1="0"
                  y1={left}
                  x2="100%"
                  y2={right}
                  strokeWidth={o.best ? 2.5 : 1.5}
                  strokeDasharray={o.feasible ? undefined : "3 3"}
                  className={o.best ? "stroke-go" : "stroke-text-3"}
                />
                <circle cx="0" cy={left} r={o.best ? 4 : 3.5} className={dot} />
                <circle cx="100%" cy={right} r={o.best ? 4 : 3.5} className={dot} />
              </g>
            );
          })}
        </svg>

        <div data-column="headline" className="contents">
          {headline.map((o, i) => (
            <div
              key={o.optionId}
              data-option={o.optionId}
              className="col-start-1 flex min-w-0 flex-col items-end justify-center text-right"
              style={{ gridRow: i + 2 }}
            >
              <FactChip
                fact={o.headlinePrice}
                className={cn("text-sm", o.best && "font-semibold")}
              />
              <span className="max-w-full truncate text-2xs text-text-2" title={placeName(o)}>
                {o.feasible ? null : <span className="text-alarm">not feasible, </span>}
                {o.supplier}, {o.port.name}
              </span>
            </div>
          ))}
        </div>

        <div data-column="total" className="contents">
          {plan.options.map((o, i) => (
            <div
              key={o.optionId}
              data-option={o.optionId}
              className="col-start-3 flex min-w-0 flex-col items-start justify-center"
              style={{ gridRow: i + 2 }}
            >
              <FactChip
                fact={o.totalCost}
                className={cn("text-sm", o.best && "font-semibold text-go")}
              />
              <span className="max-w-full truncate text-2xs text-text-2" title={o.supplier}>
                <FactChip fact={o.delay} /> delay, {o.supplier}
              </span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-2xs text-text-2">{caption(plan)}</figcaption>
    </figure>
  );
}
