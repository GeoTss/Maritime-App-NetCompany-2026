/**
 * Publish the measured accuracy: live reports -> evals/published/summary.json (`EvalSummary`),
 * the file GET /api/eval/summary serves. A dev report is accepted when live (or record, a live
 * run that also writes recordings) and a record report has no call served from a recording
 * (record is replay-first). A held-out report is accepted only when it is a complete `--final`
 * live pass: meta.final, mode live, no runnerErrors, and exactly one first-run row for every id
 * of the held-out split. Replay, oracle and empty reports are refused. Rates and intervals are
 * the scorecard's own (the errors metric's interval is the same Wilson interval); the entries a
 * run does not touch are kept from the existing summary.
 *
 *   npm run eval:publish -- [--extraction <dir>] [--qa <dir>] [--out <file>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalSummary } from "@pharos/shared";
import { wilson } from "./extraction/scorecard.js";

export class PublishRefusal extends Error {
  override name = "PublishRefusal";
}

type Suite = "extraction" | "qa";
type Metric = EvalSummary["suites"][number]["metrics"][number];

interface Rated {
  k: number;
  n: number;
  rate: number | null;
  ci95: { low: number; high: number } | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "published", "summary.json");
const GOLDEN = join(HERE, "golden");
const ERRORS_LABEL = "Errors, truncations and refusals (expected 0)";

function at(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function metric(card: unknown, path: string, key: string, label: string): Metric {
  const v = at(card, path) as Rated | undefined;
  if (!v || typeof v.k !== "number" || typeof v.n !== "number") {
    throw new PublishRefusal(`scorecard has no metric at ${path}`);
  }
  return {
    key,
    label,
    k: v.k,
    n: v.n,
    rate: v.rate,
    ci95: v.ci95 ? [v.ci95.low, v.ci95.high] : null,
  };
}

/** k = scorecard.errors.length over the cases (extraction) or questions (Q&A) run. */
function errorsMetric(card: unknown, countPath: "cases" | "questions"): Metric {
  const errors = at(card, "errors");
  const n = at(card, countPath);
  if (!Array.isArray(errors) || typeof n !== "number" || !Number.isInteger(n)) {
    throw new PublishRefusal(`scorecard has no errors list or no ${countPath} count`);
  }
  const k = errors.length;
  if (k > n) throw new PublishRefusal(`scorecard lists ${k} errors over ${n} ${countPath}`);
  const ci = wilson(k, n);
  return {
    key: "errors",
    label: ERRORS_LABEL,
    k,
    n,
    rate: n === 0 ? null : k / n,
    ci95: ci ? [ci.low, ci.high] : null,
  };
}

function dist(card: unknown, path: string, stat: "mean" | "p90", key: string, label: string) {
  const ms = at(card, `${path}.${stat}`);
  if (typeof ms !== "number")
    throw new PublishRefusal(`scorecard has no latency at ${path}.${stat}`);
  return { key, label, seconds: ms / 1000 };
}

async function load(dir: string, expected: Suite, goldenRoot: string) {
  let raw: string;
  try {
    raw = await readFile(join(resolve(dir), "scorecard.json"), "utf8");
  } catch {
    throw new PublishRefusal(`no readable scorecard.json in ${dir}`);
  }
  const { meta, scorecard } = JSON.parse(raw) as {
    meta?: Record<string, unknown>;
    scorecard?: unknown;
  };
  if (!meta || scorecard === undefined) throw new PublishRefusal(`${dir}: not a scorecard report`);
  if (meta.suite !== expected) {
    throw new PublishRefusal(`${dir}: is a ${String(meta.suite)} report, expected ${expected}`);
  }
  if (meta.mode !== "live" && meta.mode !== "record") {
    throw new PublishRefusal(
      `${dir}: mode "${String(meta.mode)}" is not a live run; only live (or record) reports are published`,
    );
  }
  if (meta.mode === "record") {
    // Record mode reuses an existing recording (Ruling 25). First line: the runner's own count of
    // llm_calls rows a recording served (reports written before the count existed have none).
    const calls = meta.calls as { total?: unknown; fromRecordings?: unknown } | undefined;
    if (calls !== undefined) {
      const reused = calls.fromRecordings;
      if (typeof reused !== "number" || !Number.isInteger(reused) || reused < 0) {
        throw new PublishRefusal(`${dir}: meta.calls.fromRecordings is not a count`);
      }
      if (reused > 0) {
        throw new PublishRefusal(
          `${dir}: a record report with ${reused} of ${String(calls.total)} calls served from recordings is not a live measurement; only fully live reports are published`,
        );
      }
    }
    // Second line: the guard counts only calls that reached the model, the database counts every
    // call. They are equal only when nothing was reused.
    const spend = meta.spend as { guardUsd?: unknown; dbUsd?: unknown } | undefined;
    const guard = spend?.guardUsd;
    const db = spend?.dbUsd;
    const equal =
      typeof guard === "number" &&
      typeof db === "number" &&
      Math.abs(guard - db) <= 1e-9 + 1e-6 * Math.max(guard, db);
    if (!equal) {
      throw new PublishRefusal(
        `${dir}: a record report whose spend does not match (guard ${String(guard)}, llm_calls ${String(db)}) had calls served from recordings; only fully live reports are published`,
      );
    }
  }
  if (meta.split !== "dev" && meta.split !== "heldout") {
    throw new PublishRefusal(`${dir}: split "${String(meta.split)}" is neither dev nor heldout`);
  }
  if (meta.split === "heldout") await checkHeldOut(dir, expected, meta, goldenRoot);
  for (const f of ["label", "model", "promptVersion", "finishedAt"] as const) {
    if (typeof meta[f] !== "string" || meta[f] === "")
      throw new PublishRefusal(`${dir}: meta.${f} missing`);
  }
  return {
    meta: meta as Record<string, string>,
    scorecard,
    split: meta.split as "dev" | "heldout",
  };
}

/** Ruling P7: a held-out report is publishable only as a complete, final, live pass. */
async function checkHeldOut(
  dir: string,
  suite: Suite,
  meta: Record<string, unknown>,
  goldenRoot: string,
): Promise<void> {
  if (meta.final !== true) {
    throw new PublishRefusal(
      `${dir}: held-out report is not a --final pass (meta.final is not true)`,
    );
  }
  if (meta.mode !== "live") {
    throw new PublishRefusal(
      `${dir}: held-out report has mode "${String(meta.mode)}"; a held-out pass is published only when live`,
    );
  }
  const runnerErrors = meta.runnerErrors;
  if (!Array.isArray(runnerErrors) || runnerErrors.length > 0) {
    throw new PublishRefusal(
      `${dir}: held-out report has meta.runnerErrors (${Array.isArray(runnerErrors) ? runnerErrors.length : "missing"}); the run failed`,
    );
  }
  let expected: string[];
  try {
    const split = JSON.parse(await readFile(join(goldenRoot, suite, "split.json"), "utf8")) as {
      heldout?: unknown;
    };
    if (!Array.isArray(split.heldout) || !split.heldout.every((x) => typeof x === "string")) {
      throw new Error("no heldout id list");
    }
    expected = split.heldout as string[];
  } catch (e) {
    throw new PublishRefusal(
      `${dir}: cannot read the held-out ids of ${suite}/split.json (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  let text: string;
  try {
    text = await readFile(join(resolve(dir), "rows.jsonl"), "utf8");
  } catch {
    throw new PublishRefusal(`${dir}: held-out report has no readable rows.jsonl`);
  }
  const firstRuns = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as { id?: unknown; run?: unknown };
    if (typeof row.id !== "string") throw new PublishRefusal(`${dir}: a rows.jsonl row has no id`);
    if (row.run === undefined || row.run === 1) {
      firstRuns.set(row.id, (firstRuns.get(row.id) ?? 0) + 1);
    }
  }
  const want = new Set(expected);
  const missing = expected.filter((id) => !firstRuns.has(id));
  const extra = [...firstRuns.keys()].filter((id) => !want.has(id));
  const twice = [...firstRuns].filter(([, c]) => c > 1).map(([id]) => id);
  if (missing.length > 0 || extra.length > 0 || twice.length > 0) {
    const parts = [
      missing.length > 0 ? `no first-run row for ${missing.slice(0, 5).join(", ")}` : "",
      extra.length > 0 ? `rows outside the held-out split: ${extra.slice(0, 5).join(", ")}` : "",
      twice.length > 0 ? `more than one first-run row for ${twice.slice(0, 5).join(", ")}` : "",
    ].filter(Boolean);
    throw new PublishRefusal(
      `${dir}: held-out first-run rows do not cover the split exactly once each (${parts.join("; ")})`,
    );
  }
}

async function qaSuite(dir: string, goldenRoot: string): Promise<EvalSummary["suites"][number]> {
  const { meta, scorecard: c, split } = await load(dir, "qa", goldenRoot);
  return {
    suite: "qa",
    split,
    label: meta.label as string,
    model: meta.model as string,
    promptVersion: meta.promptVersion as string,
    runAt: meta.finishedAt as string,
    mode: "live",
    metrics: [
      metric(c, "grounded", "grounded", "Grounded answers (every number is a tool fact)"),
      metric(c, "answerAccuracy", "answerAccuracy", "Answer accuracy"),
      metric(c, "abstention", "abstention", "Abstains when it cannot know"),
      metric(c, "injection", "injection", "Injection resisted"),
      metric(c, "noAction", "noAction", "No action when none is needed"),
      metric(c, "proposedBest", "proposedBest", "Proposed option is the best one"),
      metric(c, "unauthorised", "unauthorised", "Unauthorised actions (expected 0)"),
      metric(c, "repaired", "repaired", "Answers repaired by the release gate"),
      errorsMetric(c, "questions"),
    ],
    latency: [
      dist(c, "latency.firstProgress", "mean", "firstProgressMean", "First progress, mean"),
      dist(c, "latency.answer", "mean", "answerMean", "Answer, mean"),
      dist(c, "latency.answer", "p90", "answerP90", "Answer, 90th percentile"),
    ],
    costUsdPerItem: at(c, "cost.perQuestion.mean") as number,
  };
}

async function extractionSuite(
  dir: string,
  goldenRoot: string,
): Promise<EvalSummary["suites"][number]> {
  const { meta, scorecard: c, split } = await load(dir, "extraction", goldenRoot);
  return {
    suite: "extraction",
    split,
    label: meta.label as string,
    model: meta.model as string,
    promptVersion: meta.promptVersion as string,
    runAt: meta.finishedAt as string,
    mode: "live",
    metrics: [
      metric(c, "critical", "critical", "Critical-field accuracy"),
      metric(c, "kind.quotePrecision", "quotePrecision", "Quote precision"),
      metric(c, "kind.quoteRecall", "quoteRecall", "Quote recall"),
      metric(c, "kind.notAQuotePrecision", "notAQuotePrecision", "Not-a-quote precision"),
      metric(c, "kind.notAQuoteRecall", "notAQuoteRecall", "Not-a-quote recall"),
      metric(c, "unsafeAutoAccepts", "unsafeAutoAccepts", "Unsafe auto-accepts (expected 0)"),
      metric(c, "reviewQueue", "reviewQueue", "Emails sent to review"),
      errorsMetric(c, "cases"),
    ],
    latency: [dist(c, "latency.endToEnd", "mean", "emailMean", "Per email, mean")],
    costUsdPerItem: at(c, "cost.perEmail.mean") as number,
  };
}

/** Held-out before dev within a suite; suites in the order extraction, qa. */
function order(e: EvalSummary["suites"][number]): number {
  return (e.suite === "extraction" ? 0 : 2) + (e.split === "heldout" ? 0 : 1);
}

export async function buildSummary(
  dirs: { extraction?: string; qa?: string },
  now: Date,
  previous?: EvalSummary,
  goldenRoot: string = GOLDEN,
): Promise<EvalSummary> {
  const fresh: EvalSummary["suites"] = [];
  if (dirs.extraction) fresh.push(await extractionSuite(dirs.extraction, goldenRoot));
  if (dirs.qa) fresh.push(await qaSuite(dirs.qa, goldenRoot));
  if (fresh.length === 0)
    throw new PublishRefusal("give --extraction and/or --qa a report directory");
  const replaced = new Set(fresh.map((e) => `${e.suite}/${e.split}`));
  const kept = (previous?.suites ?? []).filter((e) => !replaced.has(`${e.suite}/${e.split}`));
  const suites = [...kept, ...fresh].sort((x, y) => order(x) - order(y));
  const parsed = EvalSummary.safeParse({ generatedAt: now.toISOString(), suites });
  if (!parsed.success)
    throw new PublishRefusal(`summary failed validation: ${parsed.error.message}`);
  return parsed.data;
}

async function main(argv: string[]): Promise<void> {
  const usage = "usage: eval:publish [--extraction <dir>] [--qa <dir>] [--out <file>]";
  const dirs: { extraction?: string; qa?: string } = {};
  let out = OUT;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== "--extraction" && flag !== "--qa" && flag !== "--out") || !value) {
      throw new PublishRefusal(usage);
    }
    if (flag === "--out") out = resolve(value);
    else dirs[flag === "--qa" ? "qa" : "extraction"] = value;
  }
  let previous: EvalSummary | undefined;
  try {
    previous = EvalSummary.parse(JSON.parse(await readFile(out, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PublishRefusal(
        `${out} exists but is not a valid summary: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const summary = await buildSummary(dirs, new Date(), previous);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `published ${summary.suites.map((s) => `${s.suite}/${s.split}`).join(" + ")} -> ${out}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
