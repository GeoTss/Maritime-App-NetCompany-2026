/**
 * The extraction scorecard: graded case runs summed into headline metrics, each as k/N with a
 * 95 % Wilson interval, plus latency and cost per email and the run-to-run variance of the hard
 * cases. Headline metrics use each case's first run only; errors (API, truncation, refusal,
 * replay miss) are listed apart and are in no accuracy denominator.
 */
import { TARGET_EMAIL_MS } from "../lib/targets.js";
import {
  type CaseGrade,
  type ErrorKind,
  GRADED_FIELDS,
  type GradedField,
  isCritical,
  type PredictedQuote,
  type Verdict,
} from "./grade.js";

/** Two-sided 95 % normal quantile. */
const Z95 = 1.959963984540054;

/** Wilson score interval for k successes in n trials; null when n is 0. */
export function wilson(
  k: number,
  n: number,
  z: number = Z95,
): { low: number; high: number } | null {
  if (n === 0) return null;
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) {
    throw new Error(`wilson: need integers 0 <= k <= n, got ${k}/${n}`);
  }
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denom = 1 + z2 / n;
  return {
    low: k === 0 ? 0 : (centre - spread) / denom,
    high: k === n ? 1 : (centre + spread) / denom,
  };
}

export interface Rate {
  k: number;
  n: number;
  /** k / n; null when n is 0 (not measured). */
  rate: number | null;
  ci95: { low: number; high: number } | null;
}

export const rateOf = (k: number, n: number): Rate => ({
  k,
  n,
  rate: n === 0 ? null : k / n,
  ci95: wilson(k, n),
});

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? null;
}

export interface Dist {
  n: number;
  mean: number | null;
  p90: number | null;
}

const dist = (values: readonly number[]): Dist => ({
  n: values.length,
  mean: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
  p90: percentile(values, 0.9),
});

/** One run of one case: its grade and what it took. */
export interface GradedRun {
  /** 1 for the first run of a case; 2.. for `--repeat-hard` repeats. */
  run: number;
  grade: CaseGrade;
  /** Wall time of ingest + processing for this email. */
  latencyMs: number;
  /** Sum of `llm_calls.latency_ms` (0 in replay and for the oracle / empty extractors). */
  llmLatencyMs: number;
  /** Sum of `llm_calls.cost_usd`, priced from the API's usage. */
  costUsd: number;
}

export type FieldTally = Rate & { wrong: number; missing: number; critical: boolean };

export interface VarianceRow {
  id: string;
  truthStatus: CaseGrade["truthStatus"];
  runs: number;
  /** Status per run in run order; an errored run shows `error: <kind>`. */
  statuses: string[];
  /** Every run gave the same kind and critical values; null when a run errored. */
  criticalAgreed: boolean | null;
  criticalAllCorrect: (boolean | null)[];
  unsafeRuns: number;
  /** Truth needs_review only, over its graded runs: sent to review / a listed check failed. */
  reviewedRuns: { k: number; n: number } | null;
  reviewCheckMatchedRuns: { k: number; n: number } | null;
}

export interface Variance {
  cases: VarianceRow[];
  /** Over every graded run (first and repeats) of the repeated truth-needs_review cases. */
  needsReviewRecall: Rate;
  reviewCheckMatched: Rate;
}

export interface Scorecard {
  /** Cases with a first run (errors included). */
  cases: number;
  /** Cases graded: first runs without an error. */
  graded: number;
  errors: { id: string; kind: ErrorKind; message: string }[];
  /** Graded `failed` cases (an unusable output or a pipeline fault), with the stored message. */
  failures: { id: string; message: string }[];
  kind: {
    quotePrecision: Rate;
    quoteRecall: Rate;
    notAQuotePrecision: Rate;
    notAQuoteRecall: Rate;
  };
  fields: Record<GradedField, FieldTally>;
  /** Every critical field instance of every truth-quote case; `cases` is how many cases. */
  critical: Rate & { wrong: number; missing: number; cases: number };
  /** Field misses by field and verdict, most frequent first, with the case ids. */
  fieldErrors: { field: GradedField; verdict: Exclude<Verdict, "correct">; ids: string[] }[];
  unsafeAutoAccepts: Rate & { ids: string[] };
  /** Status needs_review or failed (what the review queue lists), over graded cases. */
  reviewQueue: Rate;
  /** Over truth-extracted cases. */
  falseReview: Rate & { ids: string[] };
  /**
   * Over truth needs_review cases: sent to review, i.e. status needs_review or failed (what the
   * review queue lists). Extracted or not_a_quote is a miss: no human sees it. Small N on dev, so
   * read it with its interval.
   */
  needsReviewRecall: Rate & { missedIds: string[] };
  /** Over truth needs_review cases: at least one of the truth's review checks failed. */
  reviewCheckMatched: Rate & { missedIds: string[] };
  latency: { endToEnd: Dist; model: Dist; targetMs: number };
  cost: { perEmail: Dist; totalUsd: number };
  /** Hard cases run more than once; null without `--repeat-hard`. */
  variance: Variance | null;
}

const count = <T>(xs: readonly T[], p: (x: T) => boolean) => xs.filter(p).length;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Kind and critical values only, line order ignored: what must agree across repeats. */
function criticalSignature(g: CaseGrade): string {
  const p: PredictedQuote | null = g.predicted;
  return JSON.stringify({
    kind: g.kind,
    values:
      p === null
        ? null
        : {
            vesselImo: p.vesselImo,
            portUnlocode: p.portUnlocode,
            currency: p.currency,
            validUntil: p.validUntil,
            deliveryFrom: p.deliveryFrom,
            deliveryTo: p.deliveryTo,
            lines: p.lines.map((l) => JSON.stringify([l.grade, l.qtyMt, l.pricePerMt])).sort(),
          },
  });
}

/** The statuses the review queue lists: a case in one of them is seen by a human. */
const REVIEWED: ReadonlySet<CaseGrade["status"]> = new Set(["needs_review", "failed"]);

/** needs_review recall and review-check matching over the graded truth-needs_review grades. */
function reviewRates(grades: readonly CaseGrade[]) {
  const review = grades.filter((g) => g.error === null && g.truthStatus === "needs_review");
  const notReviewed = review.filter((g) => !REVIEWED.has(g.status)).map((g) => g.id);
  const missed = review.filter((g) => g.reviewCheckMatched !== true).map((g) => g.id);
  return {
    needsReviewRecall: {
      ...rateOf(review.length - notReviewed.length, review.length),
      missedIds: notReviewed,
    },
    reviewCheckMatched: {
      ...rateOf(review.length - missed.length, review.length),
      missedIds: missed,
    },
  };
}

function variance(runs: readonly GradedRun[]): Variance | null {
  const byId = new Map<string, GradedRun[]>();
  for (const r of runs) byId.set(r.grade.id, [...(byId.get(r.grade.id) ?? []), r]);
  const rows: VarianceRow[] = [];
  for (const [id, all] of byId) {
    if (all.length < 2) continue;
    const ordered = [...all].sort((a, b) => a.run - b.run).map((r) => r.grade);
    const errored = ordered.some((g) => g.error !== null);
    const truthStatus = ordered[0]?.truthStatus ?? "extracted";
    const review = truthStatus === "needs_review" ? reviewRates(ordered) : null;
    rows.push({
      id,
      truthStatus,
      runs: ordered.length,
      statuses: ordered.map((g) => (g.error ? `error: ${g.error.kind}` : g.status)),
      criticalAgreed: errored ? null : new Set(ordered.map(criticalSignature)).size === 1,
      criticalAllCorrect: ordered.map((g) => g.criticalAllCorrect),
      unsafeRuns: count(ordered, (g) => g.unsafeAutoAccept === true),
      reviewedRuns: review
        ? { k: review.needsReviewRecall.k, n: review.needsReviewRecall.n }
        : null,
      reviewCheckMatchedRuns: review
        ? { k: review.reviewCheckMatched.k, n: review.reviewCheckMatched.n }
        : null,
    });
  }
  if (rows.length === 0) return null;
  const repeated = new Set(rows.map((r) => r.id));
  const { needsReviewRecall, reviewCheckMatched } = reviewRates(
    runs.filter((r) => repeated.has(r.grade.id)).map((r) => r.grade),
  );
  const rate = ({ k, n, rate, ci95 }: Rate): Rate => ({ k, n, rate, ci95 });
  return {
    cases: rows,
    needsReviewRecall: rate(needsReviewRecall),
    reviewCheckMatched: rate(reviewCheckMatched),
  };
}

export function scorecard(runs: readonly GradedRun[]): Scorecard {
  const first = runs.filter((r) => r.run === 1);
  const all = first.map((r) => r.grade);
  const graded = all.filter((g) => g.error === null);

  const predQuote = graded.filter((g) => g.kind === "quote");
  const predNaq = graded.filter((g) => g.kind === "not_a_quote");
  const truthQuote = graded.filter((g) => g.truthKind === "quote");
  const truthNaq = graded.filter((g) => g.truthKind === "not_a_quote");

  const instances = graded.flatMap((g) => g.fields.map((f) => ({ id: g.id, f })));
  const tally = (xs: typeof instances) => ({
    ...rateOf(
      count(xs, (x) => x.f.verdict === "correct"),
      xs.length,
    ),
    wrong: count(xs, (x) => x.f.verdict === "wrong"),
    missing: count(xs, (x) => x.f.verdict === "missing"),
  });
  const fields = Object.fromEntries(
    GRADED_FIELDS.map((field) => [
      field,
      { ...tally(instances.filter((x) => x.f.field === field)), critical: isCritical(field) },
    ]),
  ) as Record<GradedField, FieldTally>;
  const criticalTally = tally(instances.filter((x) => x.f.critical));

  const fieldErrors: Scorecard["fieldErrors"] = [];
  for (const field of GRADED_FIELDS) {
    for (const verdict of ["wrong", "missing"] as const) {
      const ids = [
        ...new Set(
          instances.filter((x) => x.f.field === field && x.f.verdict === verdict).map((x) => x.id),
        ),
      ];
      if (ids.length > 0) fieldErrors.push({ field, verdict, ids });
    }
  }
  fieldErrors.sort((a, b) => b.ids.length - a.ids.length);

  const truthExtracted = graded.filter((g) => g.truthStatus === "extracted");
  const unsafeIds = graded.filter((g) => g.unsafeAutoAccept === true).map((g) => g.id);
  const falseReviewIds = truthExtracted.filter((g) => g.falseReview === true).map((g) => g.id);

  return {
    cases: all.length,
    graded: graded.length,
    errors: all.flatMap((g) => (g.error ? [{ id: g.id, ...g.error }] : [])),
    failures: graded.flatMap((g) => (g.failure !== null ? [{ id: g.id, message: g.failure }] : [])),
    kind: {
      quotePrecision: rateOf(
        count(predQuote, (g) => g.truthKind === "quote"),
        predQuote.length,
      ),
      quoteRecall: rateOf(
        count(truthQuote, (g) => g.kind === "quote"),
        truthQuote.length,
      ),
      notAQuotePrecision: rateOf(
        count(predNaq, (g) => g.truthKind === "not_a_quote"),
        predNaq.length,
      ),
      notAQuoteRecall: rateOf(
        count(truthNaq, (g) => g.kind === "not_a_quote"),
        truthNaq.length,
      ),
    },
    fields,
    critical: { ...criticalTally, cases: count(graded, (g) => g.criticalAllCorrect !== null) },
    fieldErrors,
    unsafeAutoAccepts: { ...rateOf(unsafeIds.length, graded.length), ids: unsafeIds },
    reviewQueue: rateOf(
      count(graded, (g) => REVIEWED.has(g.status)),
      graded.length,
    ),
    falseReview: {
      ...rateOf(falseReviewIds.length, truthExtracted.length),
      ids: falseReviewIds,
    },
    ...reviewRates(graded),
    latency: {
      endToEnd: dist(first.map((r) => r.latencyMs)),
      model: dist(first.map((r) => r.llmLatencyMs)),
      targetMs: TARGET_EMAIL_MS,
    },
    cost: {
      perEmail: dist(first.map((r) => r.costUsd)),
      totalUsd: sum(runs.map((r) => r.costUsd)),
    },
    variance: variance(runs),
  };
}

// ---------- markdown ----------

/** What the run was, for the report header. */
export interface ScorecardMeta {
  suite: "extraction";
  split: "dev" | "heldout";
  label: string;
  mode: "live" | "record" | "replay" | "oracle" | "empty";
  extractor: "llm" | "oracle" | "empty";
  model: string | null;
  effort: string | null;
  fallbacks: boolean | null;
  promptVersion: string;
  seed: number;
  anchor: string;
  startedAt: string;
  finishedAt: string;
  /** Cases selected for the run. */
  selected: number;
  /** Cases of the split skipped first, and the most taken after them (null: no limit). */
  offset: number;
  limit: number | null;
  repeatHard: number;
  /** Selected cases never run (the run stopped first). */
  notRun: string[];
  /** Why the run stopped early, or null. */
  aborted: string | null;
  /** Models the API (or the replayed recording) named as having served the calls. */
  servedModels: string[];
  /**
   * Spend: what the per-request guard summed, the llm_calls total, what went to the ledger, and
   * response bodies the guard could not read (their cost is not counted; the run fails).
   */
  spend: {
    guardUsd: number | null;
    dbUsd: number;
    ledgerUsd: number | null;
    parseErrors: string[];
  };
  /**
   * Runner errors, "<case id>: <what>": a case whose stored quote is not the graded view (an
   * `extracted` case without exactly one stored quote equal to it, or a quote stored for any
   * other status). Any one fails the run.
   */
  runnerErrors: string[];
}

const pct = (x: number) => (x * 100).toFixed(1);
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

/** "k/N", the rate and its interval as table cells; "-" when N is 0. */
function rateCells(r: Rate): string {
  if (r.rate === null || r.ci95 === null) return `${r.k}/${r.n} | - | -`;
  return `${r.k}/${r.n} | ${pct(r.rate)} % | ${pct(r.ci95.low)}–${pct(r.ci95.high)} %`;
}

const rateRow = (label: string, r: Rate): string => `| ${label} | ${rateCells(r)} |`;

const secs = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | null) => (x === null ? "-" : `$${x.toFixed(6)}`);

export function renderScorecardMd(card: Scorecard, meta: ScorecardMeta): string {
  const out: string[] = [];
  out.push(`# Extraction scorecard: ${meta.split} / ${meta.label}`, "");
  out.push(
    `- Mode: ${meta.mode}; extractor: ${meta.extractor}` +
      (meta.model
        ? `; model ${meta.model}, effort ${meta.effort}, fallbacks ${meta.fallbacks ? "on" : "off"}`
        : "; no model calls"),
  );
  out.push(`- Prompt version: ${meta.promptVersion}`);
  out.push(`- World: seed ${meta.seed}, anchor ${meta.anchor}`);
  out.push(`- Started ${meta.startedAt}, finished ${meta.finishedAt}`);
  out.push(
    `- Cases: ${meta.selected} selected` +
      (meta.offset > 0 || meta.limit !== null
        ? ` (split.json order from case ${meta.offset + 1}${meta.limit === null ? "" : `, at most ${meta.limit}`})`
        : "") +
      `, ${card.cases} run, ${card.graded} graded, ${card.errors.length} errors` +
      (meta.repeatHard > 1 ? `; hard cases run ${meta.repeatHard} times` : ""),
  );
  out.push(`- Served models: ${meta.servedModels.join(", ") || "none (no model calls)"}`);
  out.push(
    `- Spend: llm_calls ${usd(meta.spend.dbUsd)}` +
      (meta.spend.guardUsd === null ? "" : `; per-request guard ${usd(meta.spend.guardUsd)}`) +
      (meta.spend.ledgerUsd === null
        ? "; nothing ledgered (no live calls)"
        : `; ledgered ${usd(meta.spend.ledgerUsd)}`),
  );
  if (meta.spend.parseErrors.length > 0) {
    out.push(
      `- **Spend guard could not read ${meta.spend.parseErrors.length} response bodies** (their cost is not counted; the run failed): ${meta.spend.parseErrors.join("; ")}`,
    );
  }
  if (meta.runnerErrors.length > 0) {
    out.push(
      `- **Runner errors (${meta.runnerErrors.length})** (the run failed): ${meta.runnerErrors.map(cell).join("; ")}`,
    );
  }
  if (meta.aborted) {
    out.push(`- **Stopped early:** ${meta.aborted}`);
    out.push(`- Not run: ${meta.notRun.join(", ") || "none"}`);
  }
  if (meta.mode === "replay") {
    out.push(
      "- Latency in replay is not a measurement of the model; read it from the recorded run.",
    );
  }
  out.push("");

  out.push("## Headline (first run of each case; errors excluded)", "");
  out.push("| Metric | k/N | Rate | 95 % CI (Wilson) |", "|---|---:|---:|---:|");
  out.push(rateRow("Critical-field accuracy", card.critical));
  out.push(rateRow("Unsafe auto-accepts", card.unsafeAutoAccepts));
  out.push(rateRow("Quote precision", card.kind.quotePrecision));
  out.push(rateRow("Quote recall", card.kind.quoteRecall));
  out.push(rateRow("Not-a-quote precision", card.kind.notAQuotePrecision));
  out.push(rateRow("Not-a-quote recall", card.kind.notAQuoteRecall));
  out.push(rateRow("Review-queue rate", card.reviewQueue));
  out.push(rateRow("False-review rate", card.falseReview));
  out.push(rateRow("Needs-review recall", card.needsReviewRecall));
  out.push(rateRow("Review check matched", card.reviewCheckMatched));
  out.push("");
  out.push(
    `Critical fields: ${card.critical.wrong} wrong, ${card.critical.missing} missing, over ${card.critical.cases} truth-quote cases.`,
  );
  out.push(`Unsafe auto-accepts: ${card.unsafeAutoAccepts.ids.join(", ") || "none"}.`);
  out.push(`False reviews: ${card.falseReview.ids.join(", ") || "none"}.`);
  out.push(
    `Truth needs_review but not sent to review: ${card.needsReviewRecall.missedIds.join(", ") || "none"}.`,
  );
  out.push(
    `Review expected but no listed check failed: ${card.reviewCheckMatched.missedIds.join(", ") || "none"}.`,
    "",
  );

  out.push("## Per-field accuracy", "");
  out.push(
    "| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |",
    "|---|---|---:|---:|---:|---:|---:|",
  );
  for (const field of GRADED_FIELDS) {
    const t = card.fields[field];
    out.push(
      `| ${field} | ${t.critical ? "yes" : "no"} | ${rateCells(t)} | ${t.wrong} | ${t.missing} |`,
    );
  }
  out.push("");

  out.push("## Error clusters (field misses, with case ids)", "");
  if (card.fieldErrors.length === 0) out.push("None.");
  for (const c of card.fieldErrors) {
    out.push(`- ${c.field} ${c.verdict} (${c.ids.length}): ${c.ids.join(", ")}`);
  }
  out.push("");

  out.push("## Errors (not graded, not wrong answers)", "");
  if (card.errors.length === 0) out.push("None.");
  else {
    out.push("| Case | Kind | Message |", "|---|---|---|");
    for (const e of card.errors) out.push(`| ${e.id} | ${e.kind} | ${cell(e.message)} |`);
  }
  out.push("");
  out.push("## Graded failures (status failed; nothing extracted)", "");
  if (card.failures.length === 0) out.push("None.");
  else {
    out.push("| Case | Message |", "|---|---|");
    for (const e of card.failures) out.push(`| ${e.id} | ${cell(e.message)} |`);
  }
  out.push("");

  out.push("## Latency and cost (first runs, errors included)", "");
  out.push("| | n | Mean | p90 | Target |", "|---|---:|---:|---:|---:|");
  const l = card.latency;
  out.push(
    `| Latency per email (ingest + processing) | ${l.endToEnd.n} | ${secs(l.endToEnd.mean)} | ${secs(l.endToEnd.p90)} | ${secs(l.targetMs)} |`,
  );
  out.push(
    `| Model latency per email (llm_calls) | ${l.model.n} | ${secs(l.model.mean)} | ${secs(l.model.p90)} | |`,
  );
  const c = card.cost.perEmail;
  out.push(`| Cost per email (llm_calls) | ${c.n} | ${usd(c.mean)} | ${usd(c.p90)} | |`);
  out.push("", `Total cost of every run, repeats included: ${usd(card.cost.totalUsd)}.`, "");

  if (card.variance) {
    out.push("## Variance (hard cases repeated; not in the headline)", "");
    out.push(
      "| Case | Truth | Runs | Statuses | Critical values agreed | All critical correct | Unsafe runs | Sent to review | Review check matched |",
      "|---|---|---:|---|---|---|---:|---:|---:|",
    );
    const runsOf = (x: { k: number; n: number } | null) => (x === null ? "-" : `${x.k}/${x.n}`);
    for (const v of card.variance.cases) {
      const agreed =
        v.criticalAgreed === null ? "unknown (a run errored)" : v.criticalAgreed ? "yes" : "no";
      out.push(
        `| ${v.id} | ${v.truthStatus} | ${v.runs} | ${v.statuses.join(", ")} | ${agreed} | ${v.criticalAllCorrect.map((x) => (x === null ? "-" : x ? "yes" : "no")).join(", ")} | ${v.unsafeRuns} | ${runsOf(v.reviewedRuns)} | ${runsOf(v.reviewCheckMatchedRuns)} |`,
      );
    }
    out.push("", "Over every graded run of the repeated needs_review cases:", "");
    out.push("| Metric | k/N | Rate | 95 % CI (Wilson) |", "|---|---:|---:|---:|");
    out.push(rateRow("Needs-review recall", card.variance.needsReviewRecall));
    out.push(rateRow("Review check matched", card.variance.reviewCheckMatched));
    out.push("");
  }
  return out.join("\n");
}
