/**
 * The evaluation page, a scorecard: it opens with the four claims (held-out counts, as published),
 * then one table per suite with held-out and dev side by side and an interval bar per metric.
 * Counts are "k of N" in the readout voice, intervals are the published 95% intervals; nothing is
 * recomputed here and nothing animates. Bar positions are display only (a published rate or bound
 * placed on its group's axis). Metrics the API marks `expectedZero` read as counts of failures
 * (0 is good), never as a success percentage. Atkinson Hyperlegible Mono only for what you would
 * copy: model ids, prompt versions.
 */
import { Analytics01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { EvalSummary } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { DataTag } from "@/components/source-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiFailure } from "@/lib/api";
import { formatNumber, formatUtc } from "@/lib/format";
import { queryKeys } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Suite = EvalSummary["suites"][number];
type Metric = Suite["metrics"][number];

const SUITE_TITLE: Record<Suite["suite"], string> = {
  extraction: "Quote extraction",
  qa: "Questions and answers",
};

const pct = (rate: number) => formatNumber(rate * 100, "%");
const count = (n: number) => n.toLocaleString("en-US");

/** The axis a metric's bar sits on, by group (percent). */
interface Axis {
  min: number;
  max: number;
  heading: string;
  ticks: string[];
}
const AXES = {
  accuracy: { min: 50, max: 100, heading: "Accuracy", ticks: ["50%", "75%", "100%"] },
  zero: { min: 0, max: 25, heading: "Should be zero", ticks: ["0%", "12.5%", "25%"] },
  workload: { min: 0, max: 50, heading: "Workload", ticks: ["0%", "25%", "50%"] },
} satisfies Record<string, Axis>;
type AxisKey = keyof typeof AXES;

const WORKLOAD_KEYS = new Set(["reviewQueue", "repaired"]);
const axisOf = (m: Metric): AxisKey =>
  m.expectedZero ? "zero" : WORKLOAD_KEYS.has(m.key) ? "workload" : "accuracy";

/** Rows folded under "N more" in the answers suite; the rest are the claims worth reading first. */
const FOLDED = { qa: new Set(["noAction", "proposedBest", "unauthorised", "repaired", "errors"]) };

const position = (value: number, axis: Axis) =>
  Math.min(100, Math.max(0, ((value * 100 - axis.min) / (axis.max - axis.min)) * 100));
const startsBelow = (m: Metric | undefined, axis: Axis) =>
  !!m?.ci95 && axis.min > 0 && m.ci95[0] * 100 < axis.min;

/** One metric's interval on a group axis. Held-out: filled, with the published rate as a tick; dev: outlined. */
function IntervalBar({ ho, dev, axis }: { ho?: Metric; dev?: Metric; axis: Axis }) {
  const span = (m: Metric) => {
    const [lo, hi] = m.ci95 as [number, number];
    const left = position(lo, axis);
    return { left: `${left}%`, width: `${Math.max(position(hi, axis) - left, 1)}%` };
  };
  const clipped = startsBelow(ho, axis) || startsBelow(dev, axis);
  return (
    <span aria-hidden={!clipped} className="relative block h-5 w-full">
      <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {ho?.ci95 ? (
        <span
          className="absolute top-[3px] h-1.5 bg-text-1/35"
          style={span(ho)}
          data-bar="heldout"
        />
      ) : null}
      {ho?.rate != null ? (
        <span
          className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-text-1"
          style={{ left: `${position(ho.rate, axis)}%` }}
        />
      ) : null}
      {dev?.ci95 ? (
        <span
          className="absolute top-3 box-border h-1.5 border border-text-3"
          style={span(dev)}
          data-bar="dev"
        />
      ) : null}
      {clipped ? (
        <span className="absolute -left-3 top-0.5 text-2xs text-text-2">
          <span aria-hidden>{"\u2039"}</span>
          <span className="sr-only">interval starts below the axis</span>
        </span>
      ) : null}
    </span>
  );
}

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 @2xl:grid-cols-[minmax(11rem,1.3fr)_9.5rem_8rem_minmax(12rem,2fr)]";

/** A published count and its rate; a metric the split did not publish reads "not run". */
function Reading({ metric, split }: { metric?: Metric; split: "heldout" | "dev" }) {
  if (!metric) return <span className="text-xs text-text-3">not run</span>;
  const bad = metric.expectedZero && metric.k > 0;
  return (
    <span className="flex flex-wrap items-baseline justify-end gap-x-2">
      <span
        data-testid="k-of-n"
        data-split={split}
        className={cn(
          "font-readout text-sm tabular-nums whitespace-nowrap",
          bad ? "text-alarm" : "text-text-1",
        )}
      >
        {count(metric.k)}
        <span className="text-xs text-text-2"> of </span>
        {count(metric.n)}
      </span>
      {metric.rate !== null && !metric.expectedZero ? (
        <span className="text-xs text-text-2 tabular-nums">{pct(metric.rate)}</span>
      ) : null}
    </span>
  );
}

/** The published interval as text (read aloud; the bar is a picture of it). */
function IntervalText({ metric, who }: { metric?: Metric; who: string }) {
  if (!metric) return null;
  if (!metric.ci95) return <span className="sr-only">{who}: no interval</span>;
  return (
    <span className="sr-only">
      <span>{who} </span>
      <span>
        {metric.expectedZero
          ? `${metric.k === 0 ? "none observed; " : ""}95% upper bound ${pct(metric.ci95[1])}`
          : `95% interval ${pct(metric.ci95[0])} to ${pct(metric.ci95[1])}`}
      </span>
      {". "}
    </span>
  );
}

function ScoreRow({ ho, dev, axis }: { ho?: Metric; dev?: Metric; axis: Axis }) {
  const m = (ho ?? dev) as Metric;
  return (
    <li data-metric={m.key} className={cn(ROW_GRID, "min-h-8 border-t border-line py-1 text-sm")}>
      <div className="min-w-0">
        <div className="text-text-1">{m.label}</div>
        {m.expectedZero ? (
          <div className="text-2xs text-text-3">Target is 0; lower is better</div>
        ) : null}
      </div>
      <div className="text-right @2xl:text-right">
        <Reading metric={ho} split="heldout" />
      </div>
      <div className="col-span-2 text-left text-text-2 @2xl:col-span-1 @2xl:text-right">
        <Reading metric={dev} split="dev" />
      </div>
      <div className="col-span-2 @2xl:col-span-1">
        <IntervalBar ho={ho} dev={dev} axis={axis} />
        <IntervalText metric={ho} who="Held-out" />
        <IntervalText metric={dev} who="Dev" />
      </div>
    </li>
  );
}

function AxisHead({ axis, withSplits }: { axis: Axis; withSplits: boolean }) {
  return (
    <div className={cn(ROW_GRID, "mt-2 h-6 text-2xs font-medium text-text-2")} aria-hidden>
      <span>{axis.heading}</span>
      <span className="hidden text-right @2xl:block">{withSplits ? "Held-out" : ""}</span>
      <span className="hidden text-right @2xl:block">{withSplits ? "Dev" : ""}</span>
      <span className="hidden justify-between @2xl:flex">
        {axis.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </span>
    </div>
  );
}

const seconds = (s: number) => `${s.toFixed(1)} s`;
const costPerItem = (usd: number) => `USD ${usd.toFixed(4)}`;

/** One run entry: what ran, when, on which split. Its lead figure is a published count, as published. */
function EntrySection({ suite, heldoutPending }: { suite: Suite; heldoutPending: boolean }) {
  const id = `${suite.suite}-${suite.split}`;
  const heading = `${id}-title`;
  const lead = suite.metrics[0];
  return (
    <section
      id={id}
      data-suite={suite.suite}
      data-split={suite.split}
      aria-labelledby={heading}
      className="flex min-w-0 flex-col gap-2 border border-line bg-ink-900 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={heading} className="text-xs font-medium text-text-1">
          {suite.split === "heldout" ? "Held-out run" : "Dev run"}
        </h3>
        <DataTag kind={suite.split === "heldout" ? "heldout-split" : "dev-split"} />
        {suite.mode === "live" ? <DataTag kind="live-run" /> : null}
        {heldoutPending ? <span className="text-2xs text-text-3">held-out pending</span> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="min-w-0">
          <dt className="text-2xs text-text-3">Model</dt>
          <dd className="font-mono text-text-1 [overflow-wrap:anywhere]">{suite.model}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-text-3">Prompt version</dt>
          <dd className="font-mono text-text-1 [overflow-wrap:anywhere]">{suite.promptVersion}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-text-3">Run date</dt>
          <dd className="text-text-1">
            <time dateTime={suite.runAt}>{formatUtc(suite.runAt)}</time>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-text-3">Cost per item</dt>
          <dd className="text-text-1 tabular-nums">{costPerItem(suite.costUsdPerItem)}</dd>
        </div>
      </dl>
      {suite.latency.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {suite.latency.map((l) => (
            <li key={l.key} className="flex items-baseline gap-1.5">
              <span className="text-text-2">{l.label}</span>
              <span className="text-text-1 tabular-nums">{seconds(l.seconds)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {lead ? (
        <p className="border-t border-line pt-2 text-xs text-text-2">
          {lead.label}:{" "}
          <span className="text-text-1 tabular-nums">
            {count(lead.k)} of {count(lead.n)}
          </span>
          {lead.ci95 ? (
            <span className="tabular-nums">
              {" "}
              (95% interval {pct(lead.ci95[0])} to {pct(lead.ci95[1])})
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

const SUITE_ORDER: Suite["suite"][] = ["extraction", "qa"];

/** Display order only: suites in a fixed order, the held-out entry before the dev entry. */
const ordered = (suites: Suite[]) =>
  [...suites].sort(
    (a, b) =>
      SUITE_ORDER.indexOf(a.suite) - SUITE_ORDER.indexOf(b.suite) ||
      (a.split === b.split ? 0 : a.split === "heldout" ? -1 : 1),
  );

/** One suite: its run entries, then the held-out and dev readings of every metric side by side. */
function SuiteBlock({ suite, entries }: { suite: Suite["suite"]; entries: Suite[] }) {
  const ho = entries.find((e) => e.split === "heldout");
  const dev = entries.find((e) => e.split === "dev");
  const keys: string[] = [];
  for (const e of [ho, dev]) {
    for (const m of e?.metrics ?? []) if (!keys.includes(m.key)) keys.push(m.key);
  }
  const pair = (key: string) => {
    const h = ho?.metrics.find((m) => m.key === key);
    const d = dev?.metrics.find((m) => m.key === key);
    return { key, ho: h, dev: d, axis: axisOf((h ?? d) as Metric) };
  };
  const rows = keys.map(pair);
  const foldSet = FOLDED[suite as keyof typeof FOLDED];
  const folded = rows.filter((r) => foldSet?.has(r.key));
  const shown = rows.filter((r) => !foldSet?.has(r.key));
  const withSplits = !!ho && !!dev;
  const heading = `${suite}-heading`;

  const group = (list: typeof rows) =>
    (Object.keys(AXES) as AxisKey[]).map((a) => {
      const inGroup = list.filter((r) => r.axis === a);
      return inGroup.length ? (
        <div key={a}>
          <AxisHead axis={AXES[a]} withSplits={withSplits} />
          <ul>
            {inGroup.map((r) => (
              <ScoreRow key={r.key} ho={r.ho} dev={r.dev} axis={AXES[a]} />
            ))}
          </ul>
        </div>
      ) : null;
    });

  return (
    <div className="@container flex flex-col gap-3">
      <h2
        id={heading}
        className="border-b border-line-strong pb-2 text-base font-medium text-text-1"
      >
        {SUITE_TITLE[suite]}
      </h2>
      <div className="grid gap-3 @2xl:grid-cols-2">
        {entries.map((e) => (
          <EntrySection
            key={`${e.suite}-${e.split}`}
            suite={e}
            heldoutPending={e.split === "dev" && !ho}
          />
        ))}
      </div>
      <div>
        {group(shown)}
        {folded.length > 0 ? (
          <Collapsible className="mt-2 border-t border-line">
            <CollapsibleTrigger className="group flex h-8 w-full items-center gap-2 text-xs text-text-2 hover:text-text-1">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={14}
                className="transition-transform group-data-[state=open]:rotate-90"
              />
              {folded.length} more
            </CollapsibleTrigger>
            <CollapsibleContent>{group(folded)}</CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
}

/** The four claims, read from the held-out entries by metric key. A missing metric is "not published". */
const CLAIMS: { suite: Suite["suite"]; key: string; text: string }[] = [
  { suite: "qa", key: "grounded", text: "answers where every number is a tool fact" },
  { suite: "qa", key: "answerAccuracy", text: "answers judged correct" },
  {
    suite: "extraction",
    key: "unsafeAutoAccepts",
    text: "emails auto-accepted with a wrong critical field",
  },
  { suite: "extraction", key: "critical", text: "critical quote fields read correctly" },
];

function Headline({ suites }: { suites: Suite[] }) {
  const held = suites.filter((s) => s.split === "heldout");
  if (held.length === 0) return null;
  return (
    <section
      aria-label="Headline results, held-out"
      className="mb-8 grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] border border-line bg-ink-900"
    >
      {CLAIMS.map((c) => {
        const m = held.find((s) => s.suite === c.suite)?.metrics.find((x) => x.key === c.key);
        return (
          <div
            key={`${c.suite}-${c.key}`}
            data-claim={c.key}
            className="min-w-0 border-b border-r border-line px-4 py-3"
          >
            {m ? (
              <>
                <div
                  data-testid="headline-count"
                  className="whitespace-nowrap font-readout text-3xl tabular-nums text-text-1"
                >
                  {count(m.k)}
                  <span className="text-sm text-text-2"> of </span>
                  {count(m.n)}
                </div>
                <div className="mt-1 text-sm font-medium text-text-1">{c.text}</div>
                <div className="mt-0.5 text-xs text-text-2 tabular-nums">
                  {m.ci95
                    ? m.expectedZero
                      ? `${m.k === 0 ? "none observed; " : ""}at most ${pct(m.ci95[1])} (95%)`
                      : `95% interval ${pct(m.ci95[0])} to ${pct(m.ci95[1])}`
                    : "no interval published"}
                </div>
              </>
            ) : (
              <>
                <div className="font-readout text-xl text-text-3">not published</div>
                <div className="mt-1 text-sm font-medium text-text-1">{c.text}</div>
              </>
            )}
          </div>
        );
      })}
      <p className="col-span-full flex flex-wrap items-center gap-x-3 px-4 py-2 text-xs text-text-2">
        <span>Held-out sets, run once</span>
        {held.map((s) => (
          <span key={s.suite}>
            <span className="font-mono text-2xs text-text-1">{s.model}</span> · {formatUtc(s.runAt)}
          </span>
        ))}
      </p>
    </section>
  );
}

export function EvaluationPage() {
  const summary = useQuery({
    queryKey: queryKeys.evalSummary,
    queryFn: ({ signal }) => api.get("/api/eval/summary", EvalSummary, { signal }),
  });

  let body: React.ReactNode;
  if (summary.isPending) {
    body = <Skeleton className="h-64 w-full max-w-4xl" />;
  } else if (summary.isError) {
    body =
      isApiFailure(summary.error) && summary.error.error === "no_published_summary" ? (
        <EmptyState
          icon={Analytics01Icon}
          title="No evaluation summary is published yet"
          description={
            <>
              Run the benchmarks live, then publish them with{" "}
              <code className="font-mono text-text-1">npm run eval:publish</code> (pass the
              extraction and Q&amp;A report directories). The summary appears here once the API
              serves the published file.
            </>
          }
        />
      ) : (
        <ErrorState
          error={summary.error}
          title="The evaluation summary could not be loaded"
          onRetry={() => summary.refetch()}
        />
      );
  } else {
    body = (
      <div className="flex max-w-6xl flex-col">
        <Headline suites={summary.data.suites} />
        <div className="flex flex-col gap-10">
          {SUITE_ORDER.map((name) => {
            const entries = ordered(summary.data.suites).filter((s) => s.suite === name);
            return entries.length ? <SuiteBlock key={name} suite={name} entries={entries} /> : null;
          })}
        </div>
        <p className="mt-8 text-2xs text-text-3">
          Published {formatUtc(summary.data.generatedAt)} from live runs. Counts and intervals are
          shown as published. A mark at the left edge of a bar says the interval starts below the
          axis; with a few questions, a perfect score still has a wide interval.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-y-auto p-3 md:p-4">
      <header className="mb-4 max-w-[60ch]">
        <h1 className="text-lg font-medium text-text-1">Evaluation</h1>
        <p className="text-xs/relaxed text-text-2">
          Measured accuracy of extraction and answers, from published live runs; each section names
          its split.
        </p>
      </header>
      {body}
    </div>
  );
}
