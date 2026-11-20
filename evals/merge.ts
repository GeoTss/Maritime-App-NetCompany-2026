/**
 * Merges the reports of one pass that stopped early into one report (Ruling R8: the cases with no
 * row run once more, then the reports are merged).
 *
 *   npm run eval:merge -- --suite extraction|qa --label <label> <dir> <dir> [...]
 *
 * Only the reports of one pass merge: every input shares suite, split, mode, model, effort,
 * fallbacks, prompt version, seed, anchor and final (a report without `final` reads as false), in
 * any mode (live, record, replay, oracle, empty). Chunks may differ in --repeat-hard. No case may
 * have a first run in two reports. The rows are put in the runner's own order (every first run in
 * split.json order, then the repeats) and scored as one run's rows are; nothing is re-graded. The
 * merged report is written next to the others as `<UTC>-<suite>-<split>-<label>/`, with
 * `meta.mergedFrom` naming its inputs.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type CaseRow, createReportDir, gradedRuns, metaOfRows } from "./extraction/run.js";
import { renderScorecardMd, type ScorecardMeta, scorecard } from "./extraction/scorecard.js";
import { GOLDEN_DIR } from "./extraction/split.js";
import { metaOfQaRows, type QaRow } from "./qa/run.js";
import { type QaScorecardMeta, qaScorecard, renderQaScorecardMd } from "./qa/scorecard.js";
import { QA_GOLDEN_DIR } from "./qa/split.js";

export class MergeRefusal extends Error {
  override name = "MergeRefusal";
}

type Suite = "extraction" | "qa";

/** What every report of one pass shares (Ruling P2). The extractor follows from the mode. */
const SHARED = [
  "split",
  "mode",
  "extractor",
  "model",
  "effort",
  "fallbacks",
  "promptVersion",
  "seed",
  "anchor",
  "final",
] as const;

const SplitFile = z.object({ dev: z.array(z.string()), heldout: z.array(z.string()) });

interface Row {
  id: string;
  run: number;
}

interface Input {
  name: string;
  meta: Record<string, unknown>;
  scorecard: Record<string, unknown>;
  /** rows.jsonl, each with its run (1 for a Q&A row). */
  rows: (Row & { line: Record<string, unknown> })[];
  /** transcripts.jsonl lines as written, with the case and run they belong to. */
  transcripts: (Row & { text: string })[];
}

async function readText(dir: string, file: string): Promise<string> {
  try {
    return await readFile(join(dir, file), "utf8");
  } catch {
    throw new MergeRefusal(`${basename(dir)}: no readable ${file}`);
  }
}

/** The JSON lines of a file with their line numbers; blank lines skipped. */
function jsonLines(text: string, where: string): { n: number; text: string; value: unknown }[] {
  return text.split("\n").flatMap((line, i) => {
    if (line.trim() === "") return [];
    try {
      return [{ n: i + 1, text: line, value: JSON.parse(line) as unknown }];
    } catch {
      throw new MergeRefusal(`${where} line ${i + 1}: not valid JSON`);
    }
  });
}

/** The case and run a rows or transcripts line belongs to (a Q&A line has no run: 1). */
function rowKey(value: unknown, where: string): Row {
  const v = value as { id?: unknown; run?: unknown } | null;
  const run = v?.run ?? 1;
  if (typeof v?.id !== "string" || v.id === "" || !Number.isInteger(run) || (run as number) < 1) {
    throw new MergeRefusal(`${where}: not a case row (needs an id and a run >= 1)`);
  }
  return { id: v.id, run: run as number };
}

async function readInput(dir: string): Promise<Input> {
  const name = basename(dir);
  let report: unknown;
  try {
    report = JSON.parse(await readText(dir, "scorecard.json"));
  } catch (err) {
    if (err instanceof MergeRefusal) throw err;
    throw new MergeRefusal(`${name}: scorecard.json is not valid JSON`);
  }
  const { meta, scorecard: card } = (report ?? {}) as { meta?: unknown; scorecard?: unknown };
  if (typeof meta !== "object" || meta === null || typeof card !== "object" || card === null) {
    throw new MergeRefusal(`${name}: scorecard.json has no meta and scorecard`);
  }
  const rows = jsonLines(await readText(dir, "rows.jsonl"), `${name}/rows.jsonl`).map((l) => ({
    ...rowKey(l.value, `${name}/rows.jsonl line ${l.n}`),
    line: l.value as Record<string, unknown>,
  }));
  const transcripts = jsonLines(
    await readText(dir, "transcripts.jsonl"),
    `${name}/transcripts.jsonl`,
  ).map((l) => ({ ...rowKey(l.value, `${name}/transcripts.jsonl line ${l.n}`), text: l.text }));
  return {
    name,
    meta: meta as Record<string, unknown>,
    scorecard: card as Record<string, unknown>,
    rows,
    transcripts,
  };
}

/** A meta field as compared across reports: `final` is false when absent (older reports). */
const shared = (meta: Record<string, unknown>, key: (typeof SHARED)[number]) =>
  JSON.stringify(key === "final" ? (meta.final ?? false) : (meta[key] ?? null));

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

const sumOrNull = (xs: unknown[]): number | null => {
  const nums = xs.filter((x): x is number => typeof x === "number");
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
};
const strings = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
/** "c-01" for a first run, "c-01#2" for a repeat: the runner's notRun entries. */
const entryOf = (r: Row) => (r.run === 1 ? r.id : `${r.id}#${r.run}`);
const parseEntry = (entry: string): Row => {
  const m = /^(.*)#(\d+)$/.exec(entry);
  return m ? { id: m[1] ?? entry, run: Number(m[2]) } : { id: entry, run: 1 };
};

export interface MergeOptions {
  suite: Suite;
  dirs: string[];
  label: string;
  reportsDir: string;
  /** Holds split.json (default: the suite's golden directory). */
  goldenDir?: string;
  now?: () => Date;
}

/** Merges the reports and writes the merged report; returns its directory. */
export async function mergeReports(o: MergeOptions): Promise<string> {
  if (o.dirs.length < 2) throw new MergeRefusal("give at least two report directories to merge");
  if (!/^[A-Za-z0-9._-]+$/.test(o.label)) {
    throw new MergeRefusal("--label needs a name made of letters, digits, '.', '_' or '-'");
  }
  const inputs = await Promise.all(o.dirs.map((d) => readInput(resolve(d))));
  const [first] = inputs;
  if (!first) throw new MergeRefusal("no reports");

  // One pass only: the same suite and the same run settings throughout.
  for (const input of inputs) {
    if (input.meta.suite !== o.suite) {
      throw new MergeRefusal(
        `${input.name}: suite is ${JSON.stringify(input.meta.suite ?? null)}, not "${o.suite}"`,
      );
    }
    for (const key of SHARED) {
      if (shared(input.meta, key) !== shared(first.meta, key)) {
        throw new MergeRefusal(
          `${input.name}: ${key} is ${shared(input.meta, key)}, but ${first.name} has ${shared(first.meta, key)}: only the reports of one pass are merged`,
        );
      }
    }
    // The scorecard must be the one of its rows (a report cut short before its scorecard is not).
    const firstRuns = input.rows.filter((r) => r.run === 1).length;
    const counted = o.suite === "extraction" ? input.scorecard.cases : input.scorecard.questions;
    if (counted !== firstRuns) {
      throw new MergeRefusal(
        `${input.name}: rows.jsonl has ${firstRuns} first runs but scorecard.json counts ${String(counted)}`,
      );
    }
  }

  const split = first.meta.split;
  if (split !== "dev" && split !== "heldout") {
    throw new MergeRefusal(`${first.name}: split ${JSON.stringify(split)} is not dev or heldout`);
  }
  const goldenDir = o.goldenDir ?? (o.suite === "extraction" ? GOLDEN_DIR : QA_GOLDEN_DIR);
  const splitFile = SplitFile.parse(
    JSON.parse(await readFile(join(goldenDir, "split.json"), "utf8")),
  );
  const order = new Map(
    (split === "dev" ? splitFile.dev : splitFile.heldout).map((id, i) => [id, i]),
  );
  for (const input of inputs) {
    for (const r of input.rows) {
      if (!order.has(r.id)) {
        throw new MergeRefusal(`${input.name}: case ${r.id} is not in the ${split} split`);
      }
    }
  }

  // A case runs once: no case (or repeat) may appear in two reports.
  const seen = new Map<string, string>();
  const overlaps: string[] = [];
  for (const input of inputs) {
    for (const r of input.rows) {
      const k = entryOf(r);
      const other = seen.get(k);
      if (other !== undefined) overlaps.push(`${k} (${other}, ${input.name})`);
      else seen.set(k, input.name);
    }
  }
  if (overlaps.length > 0) {
    throw new MergeRefusal(
      `the reports overlap on run-1 ids: ${overlaps.join(", ")}; a case runs once, so only reports of different cases are merged`,
    );
  }

  // The runner's order: every first run in split.json order, then the repeats case by case.
  const rank = (r: Row) => [r.run === 1 ? 0 : 1, order.get(r.id) ?? Number.MAX_SAFE_INTEGER, r.run];
  const byRank = (a: Row, b: Row) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const rows = inputs.flatMap((i) => i.rows).sort(byRank);
  const transcripts = inputs.flatMap((i) => i.transcripts).sort(byRank);

  // Selected: every case a report ran or listed as not run. Not run: listed, and run by none.
  const ran = new Set(rows.map(entryOf));
  const selected = new Set<string>();
  const notRunEntries = new Set<string>();
  for (const input of inputs) {
    for (const r of input.rows) selected.add(r.id);
    for (const entry of strings(input.meta.notRun)) {
      selected.add(parseEntry(entry).id);
      if (!ran.has(entry)) notRunEntries.add(entry);
    }
  }
  const notRun = [...notRunEntries].map(parseEntry).sort(byRank).map(entryOf);
  const reasons = [...new Set(inputs.flatMap((i) => strings([i.meta.aborted])))];
  const aborted =
    notRun.length === 0 ? null : reasons.join("; ") || "not every selected case was run";

  const offsets = inputs.map((i) => (typeof i.meta.offset === "number" ? i.meta.offset : 0));
  const offset = Math.min(...offsets);
  const ends = inputs.map((i, n) =>
    typeof i.meta.limit === "number" ? (offsets[n] ?? 0) + i.meta.limit : null,
  );
  const limit = ends.some((e) => e === null) ? null : Math.max(...(ends as number[])) - offset;
  const times = (key: "startedAt" | "finishedAt") =>
    inputs
      .map((i) => i.meta[key])
      .filter((t): t is string => typeof t === "string")
      .sort((a, b) => Date.parse(a) - Date.parse(b));
  const startedAt = times("startedAt")[0] ?? "";
  const finishedAt = times("finishedAt").at(-1) ?? "";
  const spendOf = (key: "guardUsd" | "ledgerUsd") =>
    sumOrNull(inputs.map((i) => (i.meta.spend as Record<string, unknown> | undefined)?.[key]));
  const parseErrors = inputs.flatMap((i) =>
    strings((i.meta.spend as Record<string, unknown> | undefined)?.parseErrors),
  );
  const m = first.meta;
  const mergedFrom = inputs.map((i) => i.name);
  const final = m.final === true;

  let card: object;
  let meta: ScorecardMeta | QaScorecardMeta;
  let md: string;
  if (o.suite === "extraction") {
    const caseRows = rows.map((r) => r.line as unknown as CaseRow);
    const c = scorecard(gradedRuns(caseRows));
    const fromRows = metaOfRows(caseRows);
    const em: ScorecardMeta = {
      suite: "extraction",
      split,
      label: o.label,
      mode: m.mode as ScorecardMeta["mode"],
      extractor: m.extractor as ScorecardMeta["extractor"],
      model: m.model as ScorecardMeta["model"],
      effort: m.effort as ScorecardMeta["effort"],
      fallbacks: m.fallbacks as ScorecardMeta["fallbacks"],
      promptVersion: m.promptVersion as ScorecardMeta["promptVersion"],
      seed: m.seed as ScorecardMeta["seed"],
      anchor: m.anchor as ScorecardMeta["anchor"],
      startedAt,
      finishedAt,
      selected: selected.size,
      offset,
      limit,
      repeatHard: Math.max(
        ...inputs.map((i) => (typeof i.meta.repeatHard === "number" ? i.meta.repeatHard : 1)),
      ),
      notRun,
      aborted,
      servedModels: fromRows.servedModels,
      spend: {
        guardUsd: spendOf("guardUsd"),
        dbUsd: c.cost.totalUsd,
        ledgerUsd: spendOf("ledgerUsd"),
        parseErrors,
      },
      runnerErrors: fromRows.runnerErrors,
      calls: fromRows.calls,
      final,
      mergedFrom,
    };
    card = c;
    meta = em;
    md = renderScorecardMd(c, em);
  } else {
    const qaRows = rows.map((r) => r.line as unknown as QaRow);
    const c = qaScorecard(qaRows);
    const fromRows = metaOfQaRows(qaRows);
    const qm: QaScorecardMeta = {
      suite: "qa",
      split,
      label: o.label,
      mode: m.mode as QaScorecardMeta["mode"],
      model: m.model as QaScorecardMeta["model"],
      effort: m.effort as QaScorecardMeta["effort"],
      fallbacks: m.fallbacks as QaScorecardMeta["fallbacks"],
      promptVersion: m.promptVersion as QaScorecardMeta["promptVersion"],
      seed: m.seed as QaScorecardMeta["seed"],
      anchor: m.anchor as QaScorecardMeta["anchor"],
      startedAt,
      finishedAt,
      selected: selected.size,
      offset,
      limit,
      notRun,
      aborted,
      servedModels: fromRows.servedModels,
      spend: {
        guardUsd: spendOf("guardUsd"),
        dbUsd: c.cost.totalUsd,
        ledgerUsd: spendOf("ledgerUsd"),
        parseErrors,
      },
      runnerErrors: fromRows.runnerErrors,
      calls: fromRows.calls,
      final,
      mergedFrom,
    };
    card = c;
    meta = qm;
    md = renderQaScorecardMd(c, qm);
  }

  // Everything is checked: only now is a directory created (never over an existing report).
  const now = o.now ?? (() => new Date());
  const dir = await createReportDir(o.reportsDir, `${stamp(now())}-${o.suite}-${split}-${o.label}`);
  const lines = (xs: string[]) => xs.map((x) => `${x}\n`).join("");
  await writeFile(join(dir, "rows.jsonl"), lines(rows.map((r) => JSON.stringify(r.line))));
  await writeFile(join(dir, "transcripts.jsonl"), lines(transcripts.map((t) => t.text)));
  await writeFile(
    join(dir, "scorecard.json"),
    `${JSON.stringify({ meta, scorecard: card }, null, 2)}\n`,
  );
  await writeFile(join(dir, "scorecard.md"), `${md}\n`);
  return dir;
}

// ---------- CLI ----------

export function parseMergeArgs(argv: string[]): { suite: Suite; label: string; dirs: string[] } {
  const usage =
    "usage: npm run eval:merge -- --suite extraction|qa --label <label> <dir> <dir> [...]";
  let suite: string | undefined;
  let label: string | undefined;
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--suite" || a === "--label") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new MergeRefusal(`${a} needs a value`);
      if (a === "--suite") suite = v;
      else label = v;
      i++;
    } else if (a.startsWith("--")) throw new MergeRefusal(`unknown argument "${a}" (${usage})`);
    else dirs.push(a);
  }
  if (suite !== "extraction" && suite !== "qa") throw new MergeRefusal(usage);
  if (label === undefined) throw new MergeRefusal(usage);
  return { suite, label, dirs };
}

const fmt = (r: { k: number; n: number; rate: number | null } | undefined) =>
  r === undefined
    ? "-"
    : `${r.k}/${r.n}${r.rate === null ? "" : ` (${(r.rate * 100).toFixed(1)} %)`}`;

async function main(argv: string[]): Promise<void> {
  const args = parseMergeArgs(argv);
  const reportsDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "evals", "reports");
  const dir = await mergeReports({ ...args, reportsDir });
  const { meta, scorecard: card } = JSON.parse(
    await readFile(join(dir, "scorecard.json"), "utf8"),
  ) as {
    meta: { aborted: string | null; notRun: string[] };
    scorecard: Record<string, { k: number; n: number; rate: number | null }>;
  };
  console.log(`merged ${args.dirs.length} reports -> ${dir}`);
  if (args.suite === "extraction") {
    console.log(`critical-field accuracy ${fmt(card.critical)}`);
    console.log(`unsafe auto-accepts ${fmt(card.unsafeAutoAccepts)}`);
  } else {
    console.log(`answer accuracy ${fmt(card.answerAccuracy)}`);
    console.log(`grounded numbers ${fmt(card.grounded)}`);
    console.log(`unauthorised actions ${fmt(card.unauthorised)}`);
  }
  if (meta.aborted) {
    console.error(`[merge] still not run: ${meta.notRun.join(", ")} (${meta.aborted})`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[merge] ${(err as Error).message}`);
    process.exit(1);
  });
}
