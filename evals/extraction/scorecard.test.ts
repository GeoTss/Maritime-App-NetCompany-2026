import { describe, expect, it } from "vitest";
import type { CaseGrade, FieldGrade } from "./grade.js";
import {
  type GradedRun,
  percentile,
  renderScorecardMd,
  type ScorecardMeta,
  scorecard,
  wilson,
} from "./scorecard.js";

const f = (path: string, verdict: FieldGrade["verdict"], critical = true): FieldGrade => {
  const field = (path.split(".").at(-1) ?? path) as FieldGrade["field"];
  return { field, path, critical, verdict, truth: 1, predicted: verdict === "missing" ? null : 1 };
};

const okFields = () => [
  f("vessel", "correct"),
  f("port", "correct"),
  f("supplier", "correct", false),
  f("currency", "correct"),
  f("validUntil", "correct"),
  f("deliveryFrom", "correct"),
  f("deliveryTo", "correct"),
  f("bargeFee", "correct", false),
  f("lines.0.grade", "correct"),
  f("lines.0.quantity", "correct"),
  f("lines.0.price", "correct"),
];

const grade = (over: Partial<CaseGrade> = {}): CaseGrade => ({
  id: "q-1",
  tags: ["plain"],
  source: "generated",
  truthKind: "quote",
  truthStatus: "extracted",
  status: "extracted",
  kind: "quote",
  failedChecks: [],
  error: null,
  failure: null,
  fields: okFields(),
  lines: [{ truth: 0, predicted: 0 }],
  predicted: null,
  criticalAllCorrect: true,
  unsafeAutoAccept: false,
  falseReview: false,
  reviewCheckMatched: null,
  ...over,
});

const run = (g: CaseGrade, over: Partial<GradedRun> = {}): GradedRun => ({
  run: 1,
  grade: g,
  latencyMs: 1000,
  llmLatencyMs: 900,
  costUsd: 0.001,
  ...over,
});

const notAQuote = (over: Partial<CaseGrade> = {}) =>
  grade({
    id: "n-1",
    tags: ["not_a_quote"],
    truthKind: "not_a_quote",
    truthStatus: "not_a_quote",
    status: "not_a_quote",
    kind: "not_a_quote",
    fields: [],
    lines: [],
    criticalAllCorrect: null,
    ...over,
  });

describe("wilson", () => {
  it("0/130 has an upper bound of about 2.8 %", () => {
    const ci = wilson(0, 130);
    expect(ci?.low).toBe(0);
    expect(ci?.high).toBeGreaterThan(0.028);
    expect(ci?.high).toBeLessThan(0.029);
  });
  it("matches the textbook value for 8/10 and is symmetric", () => {
    const ci = wilson(8, 10);
    expect(ci?.low).toBeCloseTo(0.4902, 3);
    expect(ci?.high).toBeCloseTo(0.9433, 3);
    const flip = wilson(2, 10);
    expect(flip?.low).toBeCloseTo(1 - (ci?.high ?? 0), 9);
  });
  it("is null for N = 0 and [x, 1] at k = N", () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(5, 5)?.high).toBe(1);
  });
});

describe("percentile (nearest rank)", () => {
  it("gives p90 of 1..10 as 9 and of one value as that value", () => {
    expect(percentile([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.9)).toBe(9);
    expect(percentile([4], 0.9)).toBe(4);
    expect(percentile([], 0.9)).toBeNull();
  });
});

describe("scorecard", () => {
  it("counts critical-field instances, wrong and missing, over truth-quote cases", () => {
    const bad = grade({
      id: "q-2",
      fields: [
        ...okFields().slice(0, 8),
        f("lines.0.grade", "wrong"),
        f("lines.0.quantity", "missing"),
        f("lines.0.price", "correct"),
      ],
      criticalAllCorrect: false,
    });
    const card = scorecard([run(grade()), run(bad), run(notAQuote())]);
    expect(card.critical).toMatchObject({ k: 16, n: 18, wrong: 1, missing: 1, cases: 2 });
    expect(card.fields.grade).toMatchObject({ k: 1, n: 2, wrong: 1, missing: 0, critical: true });
    expect(card.fields.supplier).toMatchObject({ k: 2, n: 2, critical: false });
    expect(card.fieldErrors).toEqual([
      { field: "grade", verdict: "wrong", ids: ["q-2"] },
      { field: "quantity", verdict: "missing", ids: ["q-2"] },
    ]);
  });

  it("quote / not-a-quote precision and recall use the predicted kind", () => {
    const card = scorecard([
      run(grade({ id: "a" })),
      run(grade({ id: "b", kind: "not_a_quote", status: "not_a_quote" })),
      run(notAQuote({ id: "c" })),
      run(notAQuote({ id: "d", kind: "quote", status: "needs_review" })),
      run(grade({ id: "e", kind: null, status: "failed" })),
    ]);
    expect(card.kind.quotePrecision).toMatchObject({ k: 1, n: 2 });
    expect(card.kind.quoteRecall).toMatchObject({ k: 1, n: 3 });
    expect(card.kind.notAQuotePrecision).toMatchObject({ k: 1, n: 2 });
    expect(card.kind.notAQuoteRecall).toMatchObject({ k: 1, n: 2 });
  });

  it("unsafe, review-queue, false-review and review-check rates, with the case ids", () => {
    const card = scorecard([
      run(grade({ id: "a" })),
      run(grade({ id: "b", unsafeAutoAccept: true })),
      run(grade({ id: "c", status: "needs_review", falseReview: true })),
      run(grade({ id: "d", status: "failed", kind: null, falseReview: true, failure: "boom" })),
      run(
        grade({
          id: "e",
          truthStatus: "needs_review",
          status: "needs_review",
          reviewCheckMatched: false,
        }),
      ),
    ]);
    expect(card.unsafeAutoAccepts).toMatchObject({ k: 1, n: 5, ids: ["b"] });
    expect(card.reviewQueue).toMatchObject({ k: 3, n: 5 });
    expect(card.falseReview).toMatchObject({ k: 2, n: 4, ids: ["c", "d"] });
    expect(card.reviewCheckMatched).toMatchObject({ k: 0, n: 1, missedIds: ["e"] });
    expect(card.failures).toEqual([{ id: "d", message: "boom" }]);
  });

  it("needs_review recall: truth-review cases sent to review (needs_review or failed), misses named", () => {
    const review = (id: string, over: Partial<CaseGrade>) =>
      grade({ id, truthStatus: "needs_review", status: "needs_review", ...over });
    const card = scorecard([
      run(grade({ id: "ok" })),
      run(review("r1", { reviewCheckMatched: true })),
      run(review("r2", { status: "failed", kind: null, reviewCheckMatched: false })),
      run(review("r3", { status: "extracted", unsafeAutoAccept: true, reviewCheckMatched: false })),
    ]);
    expect(card.needsReviewRecall).toMatchObject({ k: 2, n: 3, missedIds: ["r3"] });
    expect(card.needsReviewRecall.ci95?.low).toBeGreaterThan(0.2);
    expect(card.needsReviewRecall.ci95?.high).toBeLessThan(0.95);
    expect(card.reviewCheckMatched).toMatchObject({ k: 1, n: 3, missedIds: ["r2", "r3"] });
  });

  it("needs_review recall: a not_a_quote answer on a truth-review case is a miss (no human sees it)", () => {
    const card = scorecard([
      run(
        grade({
          id: "r-naq",
          truthStatus: "needs_review",
          status: "not_a_quote",
          kind: "not_a_quote",
          reviewCheckMatched: false,
        }),
      ),
      run(grade({ id: "r-ok", truthStatus: "needs_review", status: "needs_review" })),
    ]);
    expect(card.needsReviewRecall).toMatchObject({ k: 1, n: 2, missedIds: ["r-naq"] });
    expect(renderScorecardMd(card, META)).toContain(
      "Truth needs_review but not sent to review: r-naq.",
    );
  });

  it("errors are listed apart and excluded from every accuracy denominator", () => {
    const err = grade({
      id: "x",
      status: "failed",
      kind: null,
      error: {
        kind: "truncation",
        message: "The extraction was truncated (stop_reason max_tokens).",
      },
      fields: [],
      criticalAllCorrect: null,
      unsafeAutoAccept: null,
      falseReview: null,
    });
    const withErr = scorecard([run(grade()), run(err)]);
    const without = scorecard([run(grade())]);
    expect(withErr.errors).toEqual([
      {
        id: "x",
        kind: "truncation",
        message: "The extraction was truncated (stop_reason max_tokens).",
      },
    ]);
    expect(withErr.cases).toBe(2);
    expect(withErr.graded).toBe(1);
    for (const key of [
      "critical",
      "unsafeAutoAccepts",
      "reviewQueue",
      "falseReview",
      "needsReviewRecall",
      "reviewCheckMatched",
    ] as const) {
      expect(withErr[key]).toEqual(without[key]);
    }
    expect(withErr.kind).toEqual(without.kind);
    expect(withErr.fields).toEqual(without.fields);
    // The errored case still cost money and time: it is in the latency and cost figures.
    expect(withErr.cost.perEmail.n).toBe(2);
  });

  it("latency and cost per email: mean and p90 over first runs; total over every run", () => {
    const card = scorecard([
      run(grade({ id: "a" }), { latencyMs: 1000, costUsd: 0.001 }),
      run(grade({ id: "b" }), { latencyMs: 3000, costUsd: 0.003 }),
      run(grade({ id: "b" }), { run: 2, latencyMs: 9000, costUsd: 0.009 }),
    ]);
    expect(card.latency.endToEnd).toEqual({ n: 2, mean: 2000, p90: 3000 });
    expect(card.cost.perEmail.mean).toBeCloseTo(0.002, 12);
    expect(card.cost.totalUsd).toBeCloseTo(0.013, 12);
    expect(card.latency.targetMs).toBe(20_000);
  });

  it("headline metrics use first runs only; repeats feed the variance section", () => {
    const hard = (over: Partial<CaseGrade>) =>
      grade({ id: "hard-x", tags: ["hard"], source: "hard", ...over });
    const values = {
      vesselImo: "1",
      portUnlocode: "P",
      supplierKey: "k",
      currency: "USD" as const,
      validUntil: null,
      deliveryFrom: null,
      deliveryTo: null,
      bargeFee: 0,
      lines: [],
    };
    const card = scorecard([
      run(hard({ predicted: values })),
      run(hard({ predicted: values, status: "needs_review", unsafeAutoAccept: false }), { run: 2 }),
      run(hard({ predicted: { ...values, currency: "EUR" }, unsafeAutoAccept: true }), { run: 3 }),
      run(grade({ id: "hard-y", tags: ["hard"], source: "hard", predicted: values })),
      run(
        grade({
          id: "hard-y",
          tags: ["hard"],
          source: "hard",
          predicted: { ...values, supplierKey: "other" },
        }),
        { run: 2 },
      ),
    ]);
    expect(card.cases).toBe(2);
    expect(card.unsafeAutoAccepts.k).toBe(0);
    expect(card.variance?.cases).toEqual([
      {
        id: "hard-x",
        truthStatus: "extracted",
        runs: 3,
        statuses: ["extracted", "needs_review", "extracted"],
        criticalAgreed: false,
        criticalAllCorrect: [true, true, true],
        unsafeRuns: 1,
        reviewedRuns: null,
        reviewCheckMatchedRuns: null,
      },
      // A non-critical difference (supplier) does not count as disagreement.
      {
        id: "hard-y",
        truthStatus: "extracted",
        runs: 2,
        statuses: ["extracted", "extracted"],
        criticalAgreed: true,
        criticalAllCorrect: [true, true],
        unsafeRuns: 0,
        reviewedRuns: null,
        reviewCheckMatchedRuns: null,
      },
    ]);
    expect(card.variance?.needsReviewRecall).toMatchObject({ k: 0, n: 0, rate: null });
    expect(scorecard([run(grade())]).variance).toBeNull();
  });

  it("variance: needs_review recall over every run of the repeated truth-review cases", () => {
    const review = (over: Partial<CaseGrade>) =>
      grade({
        id: "hard-r",
        tags: ["hard"],
        source: "hard",
        truthStatus: "needs_review",
        status: "needs_review",
        reviewCheckMatched: true,
        ...over,
      });
    const card = scorecard([
      run(review({})),
      run(review({ status: "extracted", unsafeAutoAccept: true, reviewCheckMatched: false }), {
        run: 2,
      }),
      run(review({}), { run: 3 }),
      run(review({ error: { kind: "api_error", message: "529" } }), { run: 4 }),
    ]);
    expect(card.needsReviewRecall).toMatchObject({ k: 1, n: 1 });
    expect(card.variance?.cases[0]).toMatchObject({
      truthStatus: "needs_review",
      reviewedRuns: { k: 2, n: 3 },
      reviewCheckMatchedRuns: { k: 2, n: 3 },
    });
    expect(card.variance?.needsReviewRecall).toMatchObject({ k: 2, n: 3 });
    expect(card.variance?.reviewCheckMatched).toMatchObject({ k: 2, n: 3 });
    const md = renderScorecardMd(card, META);
    expect(md).toMatch(/\| hard-r \| needs_review \| 4 \| .* \| 2\/3 \| 2\/3 \|/);
    expect(md).toContain("| Needs-review recall | 2/3 | 66.7 % |");
  });

  it("a repeat that errored shows its error kind and leaves agreement unknown", () => {
    const card = scorecard([
      run(grade({ id: "hard-z", tags: ["hard"] })),
      run(
        grade({
          id: "hard-z",
          tags: ["hard"],
          status: "failed",
          error: { kind: "api_error", message: "529" },
          predicted: null,
        }),
        { run: 2 },
      ),
    ]);
    expect(card.variance?.cases[0]).toMatchObject({
      statuses: ["extracted", "error: api_error"],
      criticalAgreed: null,
    });
  });
});

const META: ScorecardMeta = {
  suite: "extraction",
  split: "dev",
  label: "t",
  mode: "replay",
  extractor: "llm",
  model: "claude-haiku-5-5",
  effort: "medium",
  fallbacks: false,
  promptVersion: "extract-quote/v2",
  seed: 20261114,
  anchor: "2026-11-14T08:00:00.000Z",
  startedAt: "2026-11-14T10:00:00.000Z",
  finishedAt: "2026-11-14T10:01:00.000Z",
  selected: 3,
  offset: 0,
  limit: null,
  repeatHard: 1,
  notRun: [],
  aborted: null,
  servedModels: ["claude-haiku-5-5"],
  spend: { guardUsd: null, dbUsd: 0.002, ledgerUsd: null, parseErrors: [] },
  runnerErrors: [],
};

describe("renderScorecardMd", () => {
  const meta = META;

  it("prints every headline metric as k/N with its 95 % interval, and the error list", () => {
    const md = renderScorecardMd(
      scorecard([
        run(grade()),
        run(notAQuote()),
        run(
          grade({
            id: "r",
            truthStatus: "needs_review",
            status: "needs_review",
            fields: [],
            criticalAllCorrect: null,
            reviewCheckMatched: true,
          }),
        ),
        run(
          grade({
            id: "x",
            error: { kind: "replay_miss", message: "LLM replay miss: no recording" },
            fields: [],
            unsafeAutoAccept: null,
            falseReview: null,
            criticalAllCorrect: null,
          }),
        ),
      ]),
      meta,
    );
    for (const label of [
      "Critical-field accuracy",
      "Unsafe auto-accepts",
      "Quote precision",
      "Quote recall",
      "Not-a-quote precision",
      "Not-a-quote recall",
      "Review-queue rate",
      "False-review rate",
      "Needs-review recall",
      "Review check matched",
    ]) {
      expect(md).toMatch(
        new RegExp(`\\| ${label} \\| \\d+/\\d+ \\| [\\d.]+ % \\| [\\d.]+–[\\d.]+ % \\|`),
      );
    }
    expect(md).toContain("| Critical-field accuracy | 9/9 | 100.0 % |");
    expect(md).toContain("| x | replay_miss | LLM replay miss: no recording |");
    expect(md).toMatch(/Latency per email.*20\.0 s/s);
    expect(md).toMatch(/Cost per email/);
  });

  it("names the chunk of the split an --offset / --limit run took", () => {
    const md = renderScorecardMd(scorecard([run(grade())]), { ...meta, offset: 40, limit: 20 });
    expect(md).toContain("- Cases: 3 selected (split.json order from case 41, at most 20), 1 run");
    expect(renderScorecardMd(scorecard([run(grade())]), meta)).toContain(
      "- Cases: 3 selected, 1 run",
    );
  });

  it("shows a metric with N = 0 as not measured", () => {
    const md = renderScorecardMd(scorecard([run(notAQuote())]), meta);
    expect(md).toContain("| Critical-field accuracy | 0/0 | - | - |");
  });

  it("lists runner errors (a stored quote that is not the graded view) and says the run failed", () => {
    const md = renderScorecardMd(scorecard([run(grade())]), {
      ...meta,
      runnerErrors: ["case-1: lines: stored [...], graded [...]"],
    });
    expect(md).toContain("**Runner errors (1)** (the run failed)");
    expect(md).toContain("case-1: lines: stored [...], graded [...]");
    expect(renderScorecardMd(scorecard([run(grade())]), meta)).not.toContain("Runner errors");
  });
});
