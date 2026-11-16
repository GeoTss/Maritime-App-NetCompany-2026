/**
 * Publish the measured accuracy: live dev reports -> evals/published/summary.json (`EvalSummary`),
 * the file GET /api/eval/summary serves. Only live (or record, a live run that also writes
 * recordings) dev reports are accepted; replay, oracle, empty and held-out reports are refused,
 * and so is a record report with any call served from a recording (record is replay-first).
 * Rates and intervals are the scorecard's own; nothing is recomputed.
 *
 *   npm run eval:publish -- --extraction <report dir> --qa <report dir>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalSummary } from "@pharos/shared";

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

const OUT = join(dirname(fileURLToPath(import.meta.url)), "published", "summary.json");

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

function dist(card: unknown, path: string, stat: "mean" | "p90", key: string, label: string) {
  const ms = at(card, `${path}.${stat}`);
  if (typeof ms !== "number")
    throw new PublishRefusal(`scorecard has no latency at ${path}.${stat}`);
  return { key, label, seconds: ms / 1000 };
}

async function load(dir: string, expected: Suite) {
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
  if (meta.split !== "dev") {
    throw new PublishRefusal(
      `${dir}: split "${String(meta.split)}" is not dev; held-out reports are never published`,
    );
  }
  for (const f of ["label", "model", "promptVersion", "finishedAt"] as const) {
    if (typeof meta[f] !== "string" || meta[f] === "")
      throw new PublishRefusal(`${dir}: meta.${f} missing`);
  }
  return { meta: meta as Record<string, string>, scorecard };
}

async function qaSuite(dir: string): Promise<EvalSummary["suites"][number]> {
  const { meta, scorecard: c } = await load(dir, "qa");
  return {
    suite: "qa",
    split: "dev",
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
    ],
    latency: [
      dist(c, "latency.firstProgress", "mean", "firstProgressMean", "First progress, mean"),
      dist(c, "latency.answer", "mean", "answerMean", "Answer, mean"),
      dist(c, "latency.answer", "p90", "answerP90", "Answer, 90th percentile"),
    ],
    costUsdPerItem: at(c, "cost.perQuestion.mean") as number,
  };
}

async function extractionSuite(dir: string): Promise<EvalSummary["suites"][number]> {
  const { meta, scorecard: c } = await load(dir, "extraction");
  return {
    suite: "extraction",
    split: "dev",
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
    ],
    latency: [dist(c, "latency.endToEnd", "mean", "emailMean", "Per email, mean")],
    costUsdPerItem: at(c, "cost.perEmail.mean") as number,
  };
}

export async function buildSummary(
  dirs: { extraction?: string; qa?: string },
  now: Date,
): Promise<EvalSummary> {
  const suites: EvalSummary["suites"] = [];
  if (dirs.extraction) suites.push(await extractionSuite(dirs.extraction));
  if (dirs.qa) suites.push(await qaSuite(dirs.qa));
  if (suites.length === 0)
    throw new PublishRefusal("give --extraction and/or --qa a report directory");
  const parsed = EvalSummary.safeParse({ generatedAt: now.toISOString(), suites });
  if (!parsed.success)
    throw new PublishRefusal(`summary failed validation: ${parsed.error.message}`);
  return parsed.data;
}

async function main(argv: string[]): Promise<void> {
  const dirs: { extraction?: string; qa?: string } = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== "--extraction" && flag !== "--qa") || !value) {
      throw new PublishRefusal("usage: eval:publish --extraction <dir> --qa <dir>");
    }
    dirs[flag === "--qa" ? "qa" : "extraction"] = value;
  }
  const summary = await buildSummary(dirs, new Date());
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`published ${summary.suites.map((s) => s.suite).join(" + ")} -> ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
