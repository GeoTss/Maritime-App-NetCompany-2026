/**
 * The evaluation page: the measured accuracy of extraction and answers, exactly as published.
 * Counts are "k of N" in the readout voice, the interval is the published 95% interval; nothing
 * is recomputed here and nothing animates. Metrics the API marks `expectedZero` read as counts
 * of failures (0 is good), never as a success percentage. Measurements set in Atkinson Hyperlegible Next with
 * tabular figures; Atkinson Hyperlegible Mono only for what you would copy: model ids, prompt versions, run times.
 */
import { Analytics01Icon } from "@hugeicons/core-free-icons";
import { EvalSummary } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { DataTag } from "@/components/source-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiFailure } from "@/lib/api";
import { formatNumber, formatUtcFull } from "@/lib/format";
import { queryKeys } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Suite = EvalSummary["suites"][number];
type Metric = Suite["metrics"][number];

const SUITE_TITLE: Record<Suite["suite"], string> = {
  extraction: "Quote extraction",
  qa: "Questions and answers",
};

const pct = (rate: number) => formatNumber(rate * 100, "%");

/**
 * A thin interval on a 0 to 100% track, drawn from the published ci95; the tick is the published
 * rate. Slate, not beacon: the bar is a reading, not something to act on.
 */
function IntervalBar({ metric }: { metric: Metric }) {
  if (!metric.ci95) return <span className="text-2xs text-text-3">no interval</span>;
  const [lo, hi] = metric.ci95;
  const left = `${lo * 100}%`;
  const width = `${Math.max((hi - lo) * 100, 0.6)}%`;
  return (
    <span
      role="img"
      aria-label={`95% interval ${pct(lo)} to ${pct(hi)}`}
      className="relative block h-2 w-full min-w-24 rounded-sm bg-ink-800"
    >
      <span className="absolute inset-y-0 rounded-sm bg-plan/60" style={{ left, width }} />
      {metric.rate !== null ? (
        <span
          className="absolute -inset-y-0.5 w-px bg-text-1"
          style={{ left: `${metric.rate * 100}%` }}
        />
      ) : null}
    </span>
  );
}

function MetricRow({ metric }: { metric: Metric }) {
  const { expectedZero, label } = metric;
  const bad = expectedZero && metric.k > 0;
  return (
    <li
      data-metric={metric.key}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line py-2 md:grid-cols-[minmax(0,1.4fr)_11rem_minmax(0,1.6fr)]"
    >
      <div className="min-w-0">
        <div className="text-xs text-text-1">{label}</div>
        {expectedZero ? (
          <div className="text-2xs text-text-3">Target is 0; lower is better</div>
        ) : null}
      </div>
      <div className="flex items-baseline justify-end gap-2 md:justify-start">
        <span
          data-testid="k-of-n"
          className={cn("text-2xl font-readout tabular-nums", bad ? "text-alarm" : "text-text-1")}
        >
          {metric.k}
          <span className="text-xs text-text-2"> of </span>
          {metric.n}
        </span>
        {metric.rate !== null && !expectedZero ? (
          <span className="text-xs text-text-2 tabular-nums">{pct(metric.rate)}</span>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
        {expectedZero ? (
          <span className="text-xs text-text-2 tabular-nums">
            {metric.k === 0 ? "none observed; " : ""}
            {metric.ci95 ? `95% upper bound ${pct(metric.ci95[1])}` : "no interval"}
          </span>
        ) : (
          <>
            <IntervalBar metric={metric} />
            {metric.ci95 ? (
              <span className="text-xs text-text-3 tabular-nums">
                95% interval {pct(metric.ci95[0])} to {pct(metric.ci95[1])}
              </span>
            ) : null}
          </>
        )}
      </div>
    </li>
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

const seconds = (s: number) => `${s.toFixed(1)} s`;
const costPerItem = (usd: number) => `USD ${usd.toFixed(4)}`;

function SuiteSection({ suite, heldoutPending }: { suite: Suite; heldoutPending: boolean }) {
  const id = `${suite.suite}-${suite.split}`;
  const heading = `${id}-title`;
  return (
    <section
      id={id}
      data-suite={suite.suite}
      data-split={suite.split}
      aria-labelledby={heading}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={heading} className="text-sm font-medium text-text-1">
          {SUITE_TITLE[suite.suite]}
        </h2>
        <DataTag kind={suite.split === "heldout" ? "heldout-split" : "dev-split"} />
        {heldoutPending ? <span className="text-2xs text-text-3">held-out pending</span> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
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
          <dd className="flex flex-wrap items-center gap-1.5 text-text-1">
            <time dateTime={suite.runAt}>{formatUtcFull(suite.runAt)}</time>
            {suite.mode === "live" ? <DataTag kind="live-run" /> : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-text-3">Cost per item</dt>
          <dd className="text-text-1 tabular-nums">{costPerItem(suite.costUsdPerItem)}</dd>
        </div>
      </dl>
      <ul className="border-t border-line">
        {suite.metrics.map((m) => (
          <MetricRow key={m.key} metric={m} />
        ))}
      </ul>
      {suite.latency.length > 0 ? (
        <div>
          <h3 className="mb-1 text-2xs text-text-3">Latency</h3>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {suite.latency.map((l) => (
              <li key={l.key} className="flex items-baseline gap-2">
                <span className="text-text-2">{l.label}</span>
                <span className="text-text-1 tabular-nums">{seconds(l.seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
      <div className="flex max-w-4xl flex-col gap-8">
        {ordered(summary.data.suites).map((s) => (
          <SuiteSection
            key={`${s.suite}-${s.split}`}
            suite={s}
            heldoutPending={
              s.split === "dev" &&
              !summary.data.suites.some((o) => o.suite === s.suite && o.split === "heldout")
            }
          />
        ))}
        <p className="text-2xs text-text-3">
          Published {formatUtcFull(summary.data.generatedAt)} from live runs. Rates and intervals
          are shown as published.
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
