/**
 * eval:merge: the reports of one interrupted pass merged into one. Reports are built from fixture
 * rows in temp directories (no runner, database or recordings), like the scorecard and publish
 * tests do.
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaseGrade, FieldGrade } from "./extraction/grade.js";
import type { CaseRow } from "./extraction/run.js";
import { type ScorecardMeta, scorecard } from "./extraction/scorecard.js";
import { MergeRefusal, mergeReports } from "./merge.js";
import type { QaGrade } from "./qa/grade.js";
import type { QaRow } from "./qa/run.js";
import { type QaScorecardMeta, qaScorecard } from "./qa/scorecard.js";

const HAIKU = "claude-haiku-5-5";
const temp = (prefix: string) => mkdtemp(join(tmpdir(), `eval-merge-${prefix}-`));

// ---------- extraction fixtures ----------

const f = (field: string, verdict: FieldGrade["verdict"], critical = true): FieldGrade => ({
  field: field as FieldGrade["field"],
  path: field,
  critical,
  verdict,
  truth: 1,
  predicted: verdict === "missing" ? null : verdict === "wrong" ? 2 : 1,
});
const quoteFields = (bad: Partial<Record<string, FieldGrade["verdict"]>> = {}) =>
  ["vessel", "port", "currency", "validUntil", "deliveryFrom", "deliveryTo"]
    .map((x) => f(x, bad[x] ?? "correct"))
    .concat([f("supplier", "correct", false), f("bargeFee", bad.bargeFee ?? "correct", false)]);

const grade = (id: string, over: Partial<CaseGrade> = {}): CaseGrade => ({
  id,
  tags: ["plain"],
  source: "generated",
  truthKind: "quote",
  truthStatus: "extracted",
  status: "extracted",
  kind: "quote",
  failedChecks: [],
  error: null,
  failure: null,
  fields: quoteFields(),
  lines: [],
  predicted: null,
  criticalAllCorrect: true,
  unsafeAutoAccept: false,
  falseReview: false,
  reviewCheckMatched: null,
  ...over,
});

/** One rows.jsonl line of the extraction runner. */
const exRow = (g: CaseGrade, run = 1, latencyMs = 1000 + run): CaseRow => ({
  id: g.id,
  run,
  tags: g.tags,
  status: g.status,
  kind: g.kind,
  error: g.error?.message ?? null,
  errorKind: g.error?.kind ?? null,
  failedChecks: g.failedChecks,
  normalised: null,
  grade: g,
  latencyMs,
  llmLatencyMs: 0,
  costUsd: g.error ? 0 : 0.0007 + run / 10_000,
  calls: g.error
    ? []
    : [
        {
          requestKey: `${g.id}-${run}`,
          model: HAIKU,
          mode: "replay",
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          latencyMs: 0,
          costUsd: 0.0007 + run / 10_000,
          stopReason: "end_turn",
        },
      ],
  servedModels: g.error ? [] : [HAIKU],
  log: [],
  runnerErrors: [],
});

const hard = (id: string, over: Partial<CaseGrade> = {}) =>
  grade(id, { tags: ["hard"], source: "hard", ...over });

/** Eight dev cases in split.json order: three hard, an error, a miss, a not-a-quote, an unsafe one. */
const EX_IDS = ["c-01", "c-02", "c-03", "c-04", "c-05", "c-06", "c-07", "c-08"];
const EX_FIRST: Record<string, CaseGrade> = {
  "c-01": grade("c-01"),
  "c-02": hard("c-02"),
  "c-03": grade("c-03", { fields: quoteFields({ port: "wrong" }), criticalAllCorrect: false }),
  "c-04": grade("c-04", {
    tags: ["not_a_quote"],
    truthKind: "not_a_quote",
    truthStatus: "not_a_quote",
    status: "not_a_quote",
    kind: "not_a_quote",
    fields: [],
    criticalAllCorrect: null,
  }),
  "c-05": hard("c-05", {
    truthStatus: "needs_review",
    status: "needs_review",
    reviewCheckMatched: true,
    fields: quoteFields({ validUntil: "missing" }),
    criticalAllCorrect: false,
  }),
  "c-06": grade("c-06", {
    status: "failed",
    kind: null,
    error: { kind: "api_error", message: "529 overloaded" },
    fields: [],
    criticalAllCorrect: null,
    unsafeAutoAccept: null,
    falseReview: null,
  }),
  "c-07": grade("c-07", {
    fields: quoteFields({ bargeFee: "wrong" }),
    unsafeAutoAccept: true,
  }),
  "c-08": hard("c-08", { status: "needs_review", falseReview: true }),
};
/** Repeats of the hard cases (run 2, 3): one disagrees with its first run. */
const exRepeat = (id: string, run: number): CaseRow =>
  exRow(
    id === "c-02" && run === 2
      ? hard("c-02", { status: "needs_review", falseReview: true })
      : (EX_FIRST[id] as CaseGrade),
    run,
  );
const exFirst = (id: string) => exRow(EX_FIRST[id] as CaseGrade);

/** The rows of one pass in the runner's order: every first run, then the hard repeats. */
function exPlan(ids: string[], repeatHard: number): CaseRow[] {
  const repeats = ids
    .filter((id) => EX_FIRST[id]?.tags[0] === "hard")
    .flatMap((id) => Array.from({ length: repeatHard - 1 }, (_, i) => exRepeat(id, i + 2)));
  return [...ids.map(exFirst), ...repeats];
}

const exCard = (rows: CaseRow[]) =>
  scorecard(
    rows.map((r) => ({
      run: r.run,
      grade: r.grade,
      latencyMs: r.latencyMs,
      llmLatencyMs: r.llmLatencyMs,
      costUsd: r.costUsd,
    })),
  );

const exMeta = (over: Partial<ScorecardMeta> = {}): ScorecardMeta => ({
  suite: "extraction",
  split: "dev",
  label: "half",
  mode: "replay",
  extractor: "llm",
  model: HAIKU,
  effort: "medium",
  fallbacks: false,
  promptVersion: "extract-quote/v2",
  seed: 20261114,
  anchor: "2026-11-14T08:00:00.000Z",
  startedAt: "2026-11-16T10:00:00.000Z",
  finishedAt: "2026-11-16T10:01:00.000Z",
  selected: 4,
  offset: 0,
  limit: null,
  repeatHard: 1,
  notRun: [],
  aborted: null,
  servedModels: [HAIKU],
  spend: { guardUsd: null, dbUsd: 0, ledgerUsd: null, parseErrors: [] },
  runnerErrors: [],
  calls: { total: 0, fromRecordings: 0 },
  final: false,
  ...over,
});

// ---------- Q&A fixtures ----------

const qaGrade = (id: string, category: string, patch: Partial<QaGrade> = {}): QaGrade => ({
  id,
  category,
  tags: [category],
  kind: "answer",
  released: true,
  withheld: false,
  repaired: false,
  grounded: true,
  citationsValid: true,
  answerCorrect: true,
  missingFacts: [],
  abstainedCorrectly: null,
  proposedBest: null,
  unauthorisedAction: false,
  unauthorisedReasons: [],
  ...patch,
});
const qaRow = (g: QaGrade, over: Partial<QaRow> = {}): QaRow => ({
  id: g.id,
  category: g.category,
  grade: g,
  error: null,
  latencyMs: 4000,
  firstProgressMs: 900,
  costUsd: 0.001,
  models: [HAIKU],
  foreignWrites: [],
  llmLatencyMs: 3000,
  calls: 2,
  callsFromRecordings: 2,
  runnerErrors: [],
  ...over,
});
const QA_IDS = ["lookup-01", "lookup-02", "abstain-01", "injection-01", "route-01", "route-02"];
const QA_ROWS: QaRow[] = [
  qaRow(qaGrade("lookup-01", "lookup")),
  qaRow(qaGrade("lookup-02", "lookup", { answerCorrect: false, missingFacts: ["ROB"] })),
  qaRow(
    qaGrade("abstain-01", "abstain", {
      kind: "abstain",
      answerCorrect: null,
      abstainedCorrectly: true,
    }),
  ),
  qaRow(
    qaGrade("injection-01", "injection", {
      kind: "no_action",
      answerCorrect: null,
      unauthorisedAction: true,
      unauthorisedReasons: ["recommendation approved"],
    }),
  ),
  qaRow(qaGrade("route-01", "route", { kind: "action", proposedBest: true }), { costUsd: 0.003 }),
  {
    ...qaRow(qaGrade("route-02", "route")),
    grade: null,
    error: { kind: "truncation", message: "cut off" },
  },
];
const qaMeta = (over: Partial<QaScorecardMeta> = {}): QaScorecardMeta => ({
  suite: "qa",
  split: "dev",
  label: "half",
  mode: "replay",
  model: HAIKU,
  effort: "medium",
  fallbacks: false,
  promptVersion: "agent-system/v5",
  seed: 20261114,
  anchor: "2026-11-14T08:00:00.000Z",
  startedAt: "2026-11-16T10:00:00.000Z",
  finishedAt: "2026-11-16T10:01:00.000Z",
  selected: 3,
  offset: 0,
  limit: null,
  notRun: [],
  aborted: null,
  servedModels: [HAIKU],
  spend: { guardUsd: null, dbUsd: 0, ledgerUsd: null, parseErrors: [] },
  runnerErrors: [],
  calls: { total: 0, fromRecordings: 0 },
  final: false,
  ...over,
});

// ---------- report files ----------

/** A golden dir holding only split.json (merge reads the split order from it). */
async function goldenDir(dev: string[], heldout: string[] = []): Promise<string> {
  const dir = await temp("golden");
  await writeFile(join(dir, "split.json"), JSON.stringify({ dev, heldout }));
  return dir;
}

/** Writes a report directory as a runner would: scorecard.json, rows.jsonl, transcripts.jsonl. */
async function writeReport(
  root: string,
  name: string,
  meta: object,
  card: object,
  rows: { id: string; run?: number }[],
): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "scorecard.json"), `${JSON.stringify({ meta, scorecard: card })}\n`);
  const lines = (xs: object[]) => xs.map((x) => `${JSON.stringify(x)}\n`).join("");
  await writeFile(join(dir, "rows.jsonl"), lines(rows));
  await writeFile(
    join(dir, "transcripts.jsonl"),
    lines(rows.map((r) => ({ id: r.id, run: r.run, document: { bodyText: `email ${r.id}` } }))),
  );
  return dir;
}

const exReport = (root: string, name: string, rows: CaseRow[], over: Partial<ScorecardMeta> = {}) =>
  writeReport(root, name, exMeta(over), exCard(rows), rows);
const qaReport = (root: string, name: string, rows: QaRow[], over: Partial<QaScorecardMeta> = {}) =>
  writeReport(root, name, qaMeta(over), qaScorecard(rows), rows);

async function readReport(dir: string) {
  const json = JSON.parse(await readFile(join(dir, "scorecard.json"), "utf8"));
  const rows = (await readFile(join(dir, "rows.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: string; run?: number });
  const transcripts = (await readFile(join(dir, "transcripts.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: string; run?: number });
  const md = await readFile(join(dir, "scorecard.md"), "utf8");
  return { meta: json.meta, scorecard: json.scorecard, rows, transcripts, md };
}

/** A scorecard as JSON, without its latency block (it is not what a merge is checked on). */
const noLatency = (card: object) => {
  const { latency: _, ...rest } = JSON.parse(JSON.stringify(card)) as { latency?: unknown };
  return rest;
};
const key = (r: { id: string; run?: number }) => `${r.id}#${r.run ?? 1}`;

// ---------- tests ----------

describe("mergeReports (extraction)", () => {
  it("two halves of a dev replay merged equal the whole scorecard, ignoring latency and timestamps", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(EX_IDS);
    const whole = exPlan(EX_IDS, 2);
    const a = await exReport(root, "a", exPlan(EX_IDS.slice(0, 4), 2), {
      selected: 4,
      offset: 0,
      limit: 4,
      repeatHard: 2,
      startedAt: "2026-11-16T10:00:00.000Z",
      finishedAt: "2026-11-16T10:01:00.000Z",
      spend: { guardUsd: null, dbUsd: 0.003, ledgerUsd: null, parseErrors: [] },
    });
    const b = await exReport(root, "b", exPlan(EX_IDS.slice(4), 2), {
      selected: 4,
      offset: 4,
      limit: null,
      repeatHard: 2,
      startedAt: "2026-11-16T10:05:00.000Z",
      finishedAt: "2026-11-16T10:06:00.000Z",
      spend: { guardUsd: null, dbUsd: 0.004, ledgerUsd: null, parseErrors: [] },
    });
    const wholeCard = noLatency(exCard(whole));
    // Either order of the inputs gives the runner's own order: first runs, then repeats.
    for (const dirs of [
      [a, b],
      [b, a],
    ]) {
      const reportsDir = await temp("merged");
      const merged = await mergeReports({
        suite: "extraction",
        dirs,
        label: "whole",
        reportsDir,
        goldenDir: golden,
        now: () => new Date("2026-11-16T11:00:00.000Z"),
      });
      expect(merged).toBe(join(reportsDir, "20261116T110000Z-extraction-dev-whole"));
      const r = await readReport(merged);
      expect(noLatency(r.scorecard)).toEqual(wholeCard);
      expect(r.scorecard.variance.cases.map((v: { id: string }) => v.id)).toEqual([
        "c-02",
        "c-05",
        "c-08",
      ]);
      expect(r.rows.map(key)).toEqual(whole.map(key));
      expect(r.transcripts.map(key)).toEqual(whole.map(key));
      expect(r.meta).toMatchObject({
        suite: "extraction",
        split: "dev",
        label: "whole",
        mode: "replay",
        extractor: "llm",
        model: HAIKU,
        selected: 8,
        offset: 0,
        limit: null,
        repeatHard: 2,
        notRun: [],
        aborted: null,
        final: false,
        servedModels: [HAIKU],
        runnerErrors: [],
        calls: { total: 10, fromRecordings: 10 },
        startedAt: "2026-11-16T10:00:00.000Z",
        finishedAt: "2026-11-16T10:06:00.000Z",
        mergedFrom: dirs.map((d) => basename(d)),
      });
      expect(r.meta.spend.dbUsd).toBeCloseTo(exCard(whole).cost.totalUsd, 12);
      expect(r.md).toContain("| Critical-field accuracy |");
      expect(r.md).toContain(`- Merged from 2 reports: ${dirs.map((d) => basename(d)).join(", ")}`);
    }
  });

  it("refuses overlapping run-1 ids", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(EX_IDS);
    const a = await exReport(root, "a", exPlan(EX_IDS.slice(0, 4), 1));
    const b = await exReport(root, "b", exPlan(EX_IDS.slice(3, 6), 1), { offset: 3 });
    const reportsDir = join(await temp("merged"), "reports");
    const merge = mergeReports({
      suite: "extraction",
      dirs: [a, b],
      label: "x",
      reportsDir,
      goldenDir: golden,
    });
    await expect(merge).rejects.toBeInstanceOf(MergeRefusal);
    await expect(merge).rejects.toThrow(/run-1 .*c-04/);
    await expect(readdir(reportsDir)).rejects.toThrow(); // nothing written
  });

  it("refuses reports that differ in suite, split, mode, model, effort, prompt version, seed, anchor or final", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(EX_IDS, ["h-01"]);
    const rowsA = exPlan(EX_IDS.slice(0, 4), 1);
    const rowsB = exPlan(EX_IDS.slice(4), 1);
    const a = await exReport(root, "a", rowsA);
    const differences: [string, Partial<ScorecardMeta> | Record<string, unknown>][] = [
      ["suite", { suite: "qa" }],
      ["split", { split: "heldout" }],
      ["mode", { mode: "live" }],
      ["model", { model: "claude-sonnet-5-5" }],
      ["effort", { effort: "high" }],
      ["fallbacks", { fallbacks: true }],
      ["promptVersion", { promptVersion: "extract-quote/v3" }],
      ["seed", { seed: 1 }],
      ["anchor", { anchor: "2026-11-15T08:00:00.000Z" }],
      ["final", { final: true }],
    ];
    // Report names are numbered, so the refusal must name the field itself.
    for (const [i, [field, over]] of differences.entries()) {
      const b = await exReport(root, `b${i}`, rowsB, { offset: 4, ...over });
      await expect(
        mergeReports({
          suite: "extraction",
          dirs: [a, b],
          label: "x",
          reportsDir: root,
          goldenDir: golden,
        }),
        field,
      ).rejects.toThrow(new RegExp(`\\b${field}\\b`));
    }
    // The suite asked for must be the reports' own.
    const b = await exReport(root, "b-ok", rowsB, { offset: 4 });
    await expect(
      mergeReports({ suite: "qa", dirs: [a, b], label: "x", reportsDir: root, goldenDir: golden }),
    ).rejects.toThrow(MergeRefusal);
    // A report written before `final` existed reads as final: false.
    const old = await writeReport(
      root,
      "old",
      (({ final: _, ...rest }) => rest)(exMeta({ offset: 4 })),
      exCard(rowsB),
      rowsB,
    );
    const merged = await mergeReports({
      suite: "extraction",
      dirs: [a, old],
      label: "x",
      reportsDir: await temp("merged"),
      goldenDir: golden,
    });
    expect((await readReport(merged)).meta.final).toBe(false);
    const finalB = await exReport(root, "b-last", rowsB, { offset: 4, final: true });
    await expect(
      mergeReports({
        suite: "extraction",
        dirs: [old, finalB],
        label: "x",
        reportsDir: root,
        goldenDir: golden,
      }),
    ).rejects.toThrow(/\bfinal\b/);
  });

  it("chunks may differ in repeatHard", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(EX_IDS);
    const a = await exReport(root, "a", exPlan(EX_IDS.slice(0, 4), 1), { limit: 4 });
    const b = await exReport(root, "b", exPlan(EX_IDS.slice(4), 3), { offset: 4, repeatHard: 3 });
    const merged = await readReport(
      await mergeReports({
        suite: "extraction",
        dirs: [a, b],
        label: "mixed",
        reportsDir: await temp("merged"),
        goldenDir: golden,
      }),
    );
    expect(merged.meta.repeatHard).toBe(3);
    const rows = [...exPlan(EX_IDS.slice(0, 4), 1), ...exPlan(EX_IDS.slice(4), 3)];
    expect(noLatency(merged.scorecard)).toEqual(noLatency(exCard(rows)));
    // The headline is first runs only; the variance section has the repeated cases of chunk b.
    expect(merged.scorecard.cases).toBe(8);
    expect(
      merged.scorecard.variance.cases.map((v: { id: string; runs: number }) => [v.id, v.runs]),
    ).toEqual([
      ["c-05", 3],
      ["c-08", 3],
    ]);
  });

  it("a merge that covers the split has aborted null and notRun empty, and lists mergedFrom", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(EX_IDS);
    // A pass of the whole split stopped after five cases; the rest ran with --offset 5.
    const a = await exReport(root, "a-stopped", exPlan(EX_IDS.slice(0, 5), 1), {
      selected: 8,
      notRun: EX_IDS.slice(5),
      aborted: "interrupted by SIGINT",
    });
    const b = await exReport(root, "b-rest", exPlan(EX_IDS.slice(5), 1), {
      selected: 3,
      offset: 5,
    });
    const merged = await readReport(
      await mergeReports({
        suite: "extraction",
        dirs: [a, b],
        label: "covered",
        reportsDir: await temp("merged"),
        goldenDir: golden,
      }),
    );
    expect(merged.meta).toMatchObject({
      selected: 8,
      offset: 0,
      limit: null,
      aborted: null,
      notRun: [],
      mergedFrom: ["a-stopped", "b-rest"],
    });
    expect(merged.md).not.toContain("Stopped early");
    expect(merged.md).toContain("- Merged from 2 reports: a-stopped, b-rest");

    // Without the second report nothing covers c-06..c-08: the merge says what is still not run.
    const c = await exReport(root, "c-part", exPlan(EX_IDS.slice(5, 6), 1), {
      selected: 1,
      offset: 5,
      limit: 1,
    });
    const partial = await readReport(
      await mergeReports({
        suite: "extraction",
        dirs: [a, c],
        label: "partial",
        reportsDir: await temp("merged"),
        goldenDir: golden,
      }),
    );
    expect(partial.meta.notRun).toEqual(["c-07", "c-08"]);
    expect(partial.meta.aborted).toMatch(/interrupted by SIGINT/);
  });

  it("refuses a row of a case that is not in the split, and fewer than two reports", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(EX_IDS.slice(0, 6));
    const a = await exReport(root, "a", exPlan(EX_IDS.slice(0, 4), 1));
    const b = await exReport(root, "b", exPlan(EX_IDS.slice(4), 1), { offset: 4 });
    await expect(
      mergeReports({
        suite: "extraction",
        dirs: [a, b],
        label: "x",
        reportsDir: root,
        goldenDir: golden,
      }),
    ).rejects.toThrow(/c-07.*not in the dev split/);
    await expect(
      mergeReports({
        suite: "extraction",
        dirs: [a],
        label: "x",
        reportsDir: root,
        goldenDir: golden,
      }),
    ).rejects.toThrow(/two/);
  });
});

describe("mergeReports (Q&A)", () => {
  it("two halves of a dev replay merged equal the whole scorecard, ignoring latency and timestamps", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(QA_IDS);
    const a = await qaReport(root, "a", QA_ROWS.slice(0, 3), { limit: 3 });
    const b = await qaReport(root, "b", QA_ROWS.slice(3), {
      offset: 3,
      finishedAt: "2026-11-16T10:09:00.000Z",
    });
    const merged = await readReport(
      await mergeReports({
        suite: "qa",
        dirs: [b, a],
        label: "whole",
        reportsDir: await temp("merged"),
        goldenDir: golden,
      }),
    );
    expect(noLatency(merged.scorecard)).toEqual(noLatency(qaScorecard(QA_ROWS)));
    expect(merged.rows.map((r) => r.id)).toEqual(QA_IDS);
    expect(merged.meta).toMatchObject({
      suite: "qa",
      selected: 6,
      offset: 0,
      limit: null,
      notRun: [],
      aborted: null,
      final: false,
      calls: { total: 12, fromRecordings: 12 },
      finishedAt: "2026-11-16T10:09:00.000Z",
      mergedFrom: ["b", "a"],
    });
    expect(merged.md).toContain("- Merged from 2 reports: b, a");
  });

  it("refuses overlapping ids and reports of another prompt version or final flag", async () => {
    const root = await temp("reports");
    const golden = await goldenDir(QA_IDS);
    const a = await qaReport(root, "a", QA_ROWS.slice(0, 3));
    const overlap = await qaReport(root, "overlap", QA_ROWS.slice(2), { offset: 2 });
    await expect(
      mergeReports({
        suite: "qa",
        dirs: [a, overlap],
        label: "x",
        reportsDir: root,
        goldenDir: golden,
      }),
    ).rejects.toThrow(/run-1 .*abstain-01/);
    const prompt = await qaReport(root, "prompt", QA_ROWS.slice(3), {
      offset: 3,
      promptVersion: "agent-system/v6",
    });
    await expect(
      mergeReports({
        suite: "qa",
        dirs: [a, prompt],
        label: "x",
        reportsDir: root,
        goldenDir: golden,
      }),
    ).rejects.toThrow(/promptVersion/);
    const flagged = await qaReport(root, "c", QA_ROWS.slice(3), { offset: 3, final: true });
    await expect(
      mergeReports({
        suite: "qa",
        dirs: [a, flagged],
        label: "x",
        reportsDir: root,
        goldenDir: golden,
      }),
    ).rejects.toThrow(/\bfinal\b/);
  });
});
