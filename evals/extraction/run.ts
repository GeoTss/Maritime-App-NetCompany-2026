/**
 * The extraction eval runner. Each golden email of a split goes through the app's own entry
 * points, `ingestRaw` then `processDocument` (awaited), on the eval database, and is graded by
 * grade.ts and summed by scorecard.ts.
 *
 *   npm run eval -- --suite extraction --split dev --mode replay|live|record
 *                   [--oracle | --empty] [--repeat-hard N] [--label x] [--offset n] [--limit n]
 *                   [--final]
 *
 * Database (ruling R23): `connectTestDb("eval_extraction")`, seeded once per run (seed 20261114,
 * anchor 2026-11-14T08:00:00Z, plus the eval requirements). Before every case run, only what a
 * case creates is deleted: documents, extractions, quotes with an extraction id and their lines,
 * llm_calls and audit rows. Seed quotes and purchase orders stay.
 *
 * Model: Claude Haiku 5.5 only, effort medium, fallbacks off. The configured model is checked
 * before the first call; in live and record the guard refuses every request after the first
 * response served by another model and the run stops there; every served model is checked after
 * the run, and a non-Haiku model fails it.
 * Spend (live and record): the estimate (case runs x $0.001) must fit the $0.25 per-pass cap and
 * `assertBudget` before the first call, a per-request guard capped at min($0.25, what the
 * current phase's budget has left), and the guard's summed cost appended to the ledger afterwards, also when the
 * run fails or stops early.
 * Stored quotes: after each case, an `extracted` case must have exactly one stored quote equal to
 * the graded view, any other status none; a disagreement is a runner error that fails the run.
 * `--oracle` and `--empty` make no model calls and need no key. `--split heldout` needs `--final`.
 * Record mode is replay-first (Ruling 25): it only refreshes recordings, so it is never a
 * measurement when a call was served from one (meta.calls.fromRecordings, printed), and `--final`
 * refuses it. Measure with `--mode live`.
 * Held-out runs once (Ruling R8): a final live held-out pass refuses to start when a selected case
 * is already in `evals/heldout-passes.jsonl` (or has an empty label), and appends one row there
 * per case row it writes, before that row (errors included). Oracle, empty and replay passes never
 * touch that file. A pass that stops
 * early keeps its rows and scorecard; the cases not run may run once more, then
 * `npm run eval:merge` joins the reports. Such a pass also stops at its first API error, so an
 * outage cannot consume the remaining cases (Ruling P17; the spend cap's reason wins).
 * After every case the scorecard of the rows so far is written with aborted "did not finish (no
 * final scorecard)" and replaced by the end-of-run write, so a kill with no handler (SIGKILL, power
 * loss) still leaves a mergeable report. Every stop, abort and fault line names
 * `resume with --offset <n>` (split.json order).
 * The key comes from `ANTHROPIC_API_KEY` (via `tsx --env-file-if-exists=.env`) and is never printed.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APIError } from "@anthropic-ai/sdk";
import {
  createDb,
  GOLDEN_SET_VOYAGES,
  generateWorld,
  loadWorld,
  type Sql,
  schema,
  seedDatabase,
  type World,
} from "@pharos/db";
import { connectTestDb } from "@pharos/db/testing";
import {
  CheckResult,
  ExtractionOutput,
  ExtractionTruth,
  type LlmMode,
  type NormalisedView,
  type QuoteExtraction,
} from "@pharos/shared";
import { z } from "zod";
import { captureLlmCall } from "../../apps/api/src/ai/call-capture.js";
import {
  createLlmExtractor,
  ExtractionError,
  type Extractor,
  type ExtractorConfig,
} from "../../apps/api/src/ai/extract.js";
import {
  createLlm,
  type LlmFetch,
  RecordingFile,
  ReplayMissError,
} from "../../apps/api/src/ai/llm.js";
import { readBodyOnce } from "../../apps/api/src/ai/read-body.js";
import { DEFAULT_RECORDINGS_DIR } from "../../apps/api/src/config.js";
import { normaliseExtraction } from "../../apps/api/src/ingest/evaluate.js";
import { type IngestDeps, ingestRaw, processDocument } from "../../apps/api/src/ingest/workflow.js";
import {
  appendSpend,
  assertBudget,
  assertHaikuOnly,
  BudgetError,
  budgetRemaining,
  createSpendGuard,
  HAIKU,
  type SpendGuard,
} from "../lib/budget.js";
import { appendPass, assertNotRun, HELDOUT_PASSES_PATH } from "../lib/heldout-passes.js";
import {
  type CaseGrade,
  type CaseOutcome,
  type EntityKeys,
  type ErrorKind,
  entityKeys,
  gradeCase,
  type PipelineStatus,
} from "./grade.js";
import {
  type GradedRun,
  recordingsNotice,
  renderScorecardMd,
  type Scorecard,
  type ScorecardMeta,
  scorecard,
} from "./scorecard.js";
import { GOLDEN_DIR } from "./split.js";
import { EVAL_ANCHOR, EVAL_SEED, evalExtraRequirements } from "./world.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The CLI's database; the vitest tests use their own. */
export const EVAL_DB = "eval_extraction";
/** `run` of this runner's ledger rows. */
export const LEDGER_RUN = "eval-extraction";
/**
 * Budget estimate per case run: Phase 3 measured $0.00073 per email over the 84 dev emails on
 * Haiku 5.5 (Ruling R7). The held-out pass (156 cases + 28 hard repeats = 184 runs) estimates
 * $0.184, one pass.
 */
export const ESTIMATE_PER_CASE_RUN_USD = 0.001;
/** A pass must stay at or below this. */
export const RUN_CAP_USD = 0.25;

/**
 * The pre-run estimate of a paid pass of `caseRuns` case runs (repeats included). Throws
 * BudgetError when it is over the per-pass cap.
 */
export function assertPassEstimate(caseRuns: number): number {
  const estimate = caseRuns * ESTIMATE_PER_CASE_RUN_USD;
  if (estimate > RUN_CAP_USD) {
    throw new BudgetError(
      `estimate $${estimate.toFixed(3)} (${caseRuns} case runs x $${ESTIMATE_PER_CASE_RUN_USD}) exceeds the $${RUN_CAP_USD.toFixed(2)} per-pass cap: run the split in chunks with --offset and --limit (each chunk is its own pass)`,
    );
  }
  return estimate;
}
/** The one extractor configuration live, record and replay runs use (fixed; not from env). */
export const EVAL_EXTRACTOR_CONFIG: ExtractorConfig = {
  extractModel: HAIKU,
  extractEffort: "medium",
  llmFallbacks: false,
};

export type SplitName = "dev" | "heldout";
export type ExtractorKind = "llm" | "oracle" | "empty";

/** `--empty`: a quote with every field null and one all-null line. */
export const EMPTY_EXTRACTION: QuoteExtraction = (() => {
  const text = { value: null, evidence: null };
  const date = { asWritten: null, evidence: null };
  const money = { value: null, currency: null, perUnit: null, asWritten: null, evidence: null };
  return {
    kind: "quote",
    supplierName: text,
    vesselName: text,
    vesselImo: text,
    port: text,
    deliveryFrom: date,
    deliveryTo: date,
    validUntil: date,
    bargeFee: money,
    lines: [
      {
        grade: text,
        quantity: { value: null, unit: null, asWritten: null, evidence: null },
        price: money,
      },
    ],
    notes: null,
  };
})();

// ---------- arguments ----------

export interface RunArgs {
  suite: "extraction";
  split: SplitName;
  /** The LLM mode; the oracle and empty extractors make no calls whatever it is. */
  mode: LlmMode;
  extractor: ExtractorKind;
  /** Runs per hard case (the first is the headline run). */
  repeatHard: number;
  label: string;
  limit: number | null;
  /** Cases of the split skipped first (split.json order), so a big split runs in chunks. */
  offset: number;
  final: boolean;
}

/** The held-out split runs once, in Phase 7, and only with `--final`. */
export function assertSplitAllowed(split: SplitName, final: boolean): void {
  if (split === "heldout" && !final) {
    throw new Error(
      "--split heldout is the final held-out pass: it runs once, in Phase 7, with --final. Iterate on --split dev.",
    );
  }
}

/**
 * The final pass is a measurement, and record mode is replay-first (Ruling 25): a call with an
 * existing recording never reaches the model. So `--final` runs live, never record.
 */
export const FINAL_RECORD =
  "--final is a live measurement: run it with --mode live. --mode record only refreshes recordings (replay-first: existing recordings are reused, not measured).";

export function assertFinalMode(final: boolean, mode: LlmMode): void {
  if (final && mode === "record") throw new Error(FINAL_RECORD);
}

const REPEAT_RECORD =
  "--repeat-hard with --mode record would reuse each hard case's recording on every repeat, " +
  "so the repeats would measure nothing. Measure variance with --mode live.";

const VALUE_FLAGS = [
  "--suite",
  "--split",
  "--mode",
  "--repeat-hard",
  "--label",
  "--limit",
  "--offset",
];
const BOOL_FLAGS = ["--oracle", "--empty", "--final"];

function positiveInt(flag: string, v: string): number {
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new Error(`${flag} needs a whole number >= 1`);
  return Number(v);
}

function nonNegativeInt(flag: string, v: string): number {
  if (!/^\d+$/.test(v)) throw new Error(`${flag} needs a whole number >= 0`);
  return Number(v);
}

export function parseArgs(argv: string[]): RunArgs {
  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (VALUE_FLAGS.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      if (values.has(a)) throw new Error(`${a} given twice`);
      values.set(a, v);
      i++;
    } else if (BOOL_FLAGS.includes(a)) bools.add(a);
    else throw new Error(`unknown argument "${a}" (see evals/extraction/README.md)`);
  }

  const suite = values.get("--suite") ?? "extraction";
  if (suite !== "extraction") throw new Error(`unknown suite "${suite}": only extraction exists`);
  const split = values.get("--split") ?? "dev";
  if (split !== "dev" && split !== "heldout") throw new Error("--split is dev or heldout");
  const final = bools.has("--final");
  assertSplitAllowed(split, final);

  if (bools.has("--oracle") && bools.has("--empty")) {
    throw new Error("--oracle and --empty are alternatives");
  }
  const extractor: ExtractorKind = bools.has("--oracle")
    ? "oracle"
    : bools.has("--empty")
      ? "empty"
      : "llm";
  const modeArg = values.get("--mode");
  if (modeArg !== undefined && !["live", "record", "replay"].includes(modeArg)) {
    throw new Error("--mode is live, record or replay");
  }
  if (extractor !== "llm" && modeArg !== undefined && modeArg !== "replay") {
    throw new Error(`--${extractor} makes no model calls: drop --mode ${modeArg}`);
  }
  const mode = (modeArg ?? "replay") as LlmMode;

  const repeat = values.get("--repeat-hard");
  const repeatHard = repeat === undefined ? 1 : positiveInt("--repeat-hard", repeat);
  if (repeatHard > 1 && extractor === "llm" && mode === "record") throw new Error(REPEAT_RECORD);
  assertFinalMode(final, mode);

  const label = values.get("--label") ?? (extractor === "llm" ? mode : extractor);
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error("--label needs a name made of letters, digits, '.', '_' or '-'");
  }
  const limitArg = values.get("--limit");
  const offsetArg = values.get("--offset");
  return {
    suite: "extraction",
    split,
    mode,
    extractor,
    repeatHard,
    label,
    limit: limitArg === undefined ? null : positiveInt("--limit", limitArg),
    offset: offsetArg === undefined ? 0 : nonNegativeInt("--offset", offsetArg),
    final,
  };
}

/** The runner needs the key in the environment; names the variable, never its value. */
export function requireApiKey(env: Record<string, string | undefined>): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env).");
  return key;
}

// ---------- golden cases ----------

export interface GoldenCase {
  truth: ExtractionTruth;
  raw: Uint8Array;
  /** `<id>.oracle.json`, loaded for `--oracle` only. */
  oracle: ExtractionOutput | null;
}

const SplitFile = z.object({ dev: z.array(z.string()), heldout: z.array(z.string()) });

/**
 * The split's case ids in split.json order. `ids` (a subset of the split) picks cases directly;
 * otherwise the first `offset` cases are skipped and at most `limit` taken, so a split too big
 * for one pass runs in consecutive chunks.
 */
export async function selectCases(
  split: SplitName,
  opts: {
    ids?: string[] | undefined;
    limit?: number | null | undefined;
    offset?: number | undefined;
    goldenDir?: string;
  },
): Promise<string[]> {
  const dir = opts.goldenDir ?? GOLDEN_DIR;
  const file = SplitFile.parse(JSON.parse(await readFile(join(dir, "split.json"), "utf8")));
  const pool = split === "dev" ? file.dev : file.heldout;
  if (opts.ids) {
    for (const id of opts.ids) {
      if (!pool.includes(id)) throw new Error(`case ${id} is not in the ${split} split`);
    }
    return opts.ids;
  }
  const offset = opts.offset ?? 0;
  if (offset >= pool.length) {
    throw new Error(`--offset ${offset} leaves no case: the ${split} split has ${pool.length}`);
  }
  return pool.slice(offset, opts.limit ? offset + opts.limit : undefined);
}

/** The split's ids in split.json order: the order `--offset` counts in. */
export async function splitOrder(split: SplitName, goldenDir: string): Promise<string[]> {
  const file = SplitFile.parse(JSON.parse(await readFile(join(goldenDir, "split.json"), "utf8")));
  return split === "dev" ? file.dev : file.heldout;
}

/**
 * Where a stopped pass resumes: the `--offset` of notRun[0]'s case (its first-run id, without a
 * hard-case repeat's `#n`) in split.json order. Every stop, abort and fault line names it.
 */
export function resumeHint(order: readonly string[], notRun: readonly string[]): string {
  const next = notRun[0];
  if (next === undefined) return "nothing left to run";
  const at = order.indexOf(next.replace(/#\d+$/, ""));
  return at < 0 ? `${next} is not in the split's order` : `resume with --offset ${at}`;
}

/**
 * The `aborted` of the scorecard written after every case and replaced by the end-of-run write: a
 * run killed with no handler (SIGKILL, power loss) still leaves a scorecard of its rows so far,
 * with the cases not run in `notRun`, so its report can be merged.
 */
export const DID_NOT_FINISH = "did not finish (no final scorecard)";

/**
 * Ruling P17: an armed held-out pass stops at its first API error, so an outage cannot consume
 * the remaining cases. The case that met it keeps its row and pass row (R8: errors consume it).
 */
export const apiErrorStop = (name: string): string =>
  `API error on ${name}: stopped so an outage cannot consume the remaining cases`;

async function loadCase(dir: string, id: string, withOracle: boolean): Promise<GoldenCase> {
  const truth = ExtractionTruth.parse(
    JSON.parse(await readFile(join(dir, `${id}.truth.json`), "utf8")),
  );
  if (truth.id !== id) throw new Error(`${id}.truth.json holds case ${truth.id}`);
  const raw = new Uint8Array(await readFile(join(dir, `${id}.eml`)));
  const oracle = withOracle
    ? ExtractionOutput.parse(JSON.parse(await readFile(join(dir, `${id}.oracle.json`), "utf8")))
    : null;
  return { truth, raw, oracle };
}

// ---------- error classification ----------

/**
 * Which failures are not wrong answers, by error type: a replay miss, a refusal or truncation
 * (the stop reason of the extraction's last call), and any API error (HTTP status or connection,
 * including the spend guard's refusal). Anything else is graded as a failed extraction.
 */
export function classifyExtractError(err: unknown): ErrorKind | null {
  if (err instanceof ReplayMissError) return "replay_miss";
  if (err instanceof ExtractionError) {
    const stop = err.metrics.at(-1)?.stopReason;
    if (stop === "refusal") return "refusal";
    if (stop === "max_tokens") return "truncation";
    return null;
  }
  if (err instanceof APIError) return "api_error";
  return null;
}

/** Per-case state the extractors share with the runner. */
interface CaseSlot {
  oracle: ExtractionOutput | null;
  errorKind: ErrorKind | null;
}

function classifying(inner: Extractor, slot: CaseSlot): Extractor {
  return {
    model: inner.model,
    promptVersion: inner.promptVersion,
    async extract(doc) {
      try {
        return await inner.extract(doc);
      } catch (err) {
        slot.errorKind = classifyExtractError(err);
        throw err;
      }
    },
  };
}

/** `--oracle` / `--empty`: no model, no metrics, no network. */
function fixedExtractor(kind: "oracle" | "empty", slot: CaseSlot): Extractor {
  return {
    model: kind,
    promptVersion: kind,
    async extract() {
      const output = kind === "empty" ? EMPTY_EXTRACTION : slot.oracle;
      if (output === null) throw new Error("oracle extractor: no oracle loaded for this case");
      return { output: structuredClone(output), metrics: [] };
    },
  };
}

/** One request and response as the transport saw it (live and record; retries included). */
export interface Exchange {
  url: string;
  request: unknown;
  status: number;
  response: unknown;
}

/**
 * Records each request body (never headers, so never the key) and response in `into`. Like the
 * LLM gateway it reads a body once (`readBodyOnce`) and returns a new Response over the same
 * bytes, never a read through `clone()`. An error response is returned unread; the SDK's error
 * message (in the case's error) carries its body.
 */
export function capturing(inner: LlmFetch, into: Exchange[]): LlmFetch {
  return async (input, init) => {
    const transported = await inner(input, init);
    let request: unknown = init?.body ?? null;
    try {
      request = typeof init?.body === "string" ? JSON.parse(init.body) : request;
    } catch {
      // keep the raw text
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const exchange = { url, request, status: transported.status };
    if (!transported.ok) {
      into.push({ ...exchange, response: "(error response: returned to the SDK unread)" });
      return transported;
    }
    const { json, response, nullBody } = await readBodyOnce(transported);
    into.push({
      ...exchange,
      response: nullBody
        ? null
        : json.ok
          ? json.value
          : `(response body unreadable: ${json.error.message})`,
    });
    return response;
  };
}

// ---------- database ----------

/** Max ids after seeding (rows past them belong to a case) and the row counts to return to. */
export interface Baseline {
  maxIds: { documents: number; extractions: number; llmCalls: number; auditEvents: number };
  counts: Record<string, number>;
}

async function tableCounts(sql: Sql): Promise<Record<string, number>> {
  const [row] = await sql<Record<string, number>[]>`
    select (select count(*)::int from documents) as documents,
           (select count(*)::int from extractions) as extractions,
           (select count(*)::int from quotes) as quotes,
           (select count(*)::int from quote_lines) as quote_lines,
           (select count(*)::int from llm_calls) as llm_calls,
           (select count(*)::int from audit_events) as audit_events,
           (select count(*)::int from purchase_orders) as purchase_orders`;
  if (!row) throw new Error("count query returned no row");
  return row;
}

/**
 * Seeds the eval world once: seed 20261114 at 2026-11-14T08:00:00Z, then the eval requirements.
 * Returns the stored world (what the pipeline reads) and the baseline for per-case cleanup.
 */
export async function prepareEvalDb(sql: Sql): Promise<{ world: World; baseline: Baseline }> {
  // Atlantic Meridian as the golden set was generated with it (see GOLDEN_SET_VOYAGES).
  await seedDatabase(sql, {
    seed: EVAL_SEED,
    anchor: EVAL_ANCHOR,
    mode: "reset",
    voyageOverrides: GOLDEN_SET_VOYAGES,
  });
  const generated = generateWorld({
    seed: EVAL_SEED,
    anchor: EVAL_ANCHOR,
    voyageOverrides: GOLDEN_SET_VOYAGES,
  });
  const extra = evalExtraRequirements(generated);
  if (extra.length > 0) await createDb(sql).insert(schema.bunkerRequirements).values(extra);
  await sql`select setval(pg_get_serial_sequence('bunker_requirements', 'id'),
                          (select max(id) from bunker_requirements))`;
  const world = await loadWorld(sql);
  const sig = (rs: World["bunkerRequirements"]) =>
    rs.map((r) => `${r.id}:${r.voyageId}:${r.grade}:${r.qtyMt}:${r.status}`).join(",");
  if (sig(world.bunkerRequirements) !== sig([...generated.bunkerRequirements, ...extra])) {
    throw new Error("eval database: the stored requirements are not the eval world's");
  }
  const [ids] = await sql<Baseline["maxIds"][]>`
    select (select coalesce(max(id), 0)::int from documents) as "documents",
           (select coalesce(max(id), 0)::int from extractions) as "extractions",
           (select coalesce(max(id), 0)::int from llm_calls) as "llmCalls",
           (select coalesce(max(id), 0)::int from audit_events) as "auditEvents"`;
  if (!ids) throw new Error("max-id query returned no row");
  return { world, baseline: { maxIds: ids, counts: await tableCounts(sql) } };
}

/** Advisory-lock key held by a run for its whole duration (any fixed bigint). */
export const EVAL_RUN_LOCK = 2026111410;

/**
 * One run at a time per database: a second run would reseed and delete the first one's rows
 * mid-case. Takes the lock on a reserved connection, so the pool needs at least two (the work
 * runs on the other; `connectTestDb` gives two). Refuses at once when another run holds it.
 */
export async function withRunLock<T>(sql: Sql, fn: () => Promise<T>): Promise<T> {
  const lock = await sql.reserve();
  try {
    const [row] = await lock<{ ok: boolean }[]>`
      select pg_try_advisory_lock(${EVAL_RUN_LOCK}::bigint) as ok`;
    if (!row?.ok) {
      throw new Error("another extraction eval is running on this database; wait for it to finish");
    }
    try {
      return await fn();
    } finally {
      await lock`select pg_advisory_unlock(${EVAL_RUN_LOCK}::bigint)`;
    }
  } finally {
    lock.release();
  }
}

/** Deletes what case runs created and checks the database is back at its baseline. */
export async function cleanupCases(sql: Sql, baseline: Baseline): Promise<void> {
  const m = baseline.maxIds;
  await sql.begin(async (tx) => {
    await tx`delete from quote_lines
             where quote_id in (select id from quotes where extraction_id is not null)`;
    await tx`delete from quotes where extraction_id is not null`;
    await tx`delete from llm_calls where id > ${m.llmCalls}`;
    await tx`delete from audit_events where id > ${m.auditEvents}`;
    await tx`delete from extractions where id > ${m.extractions}`;
    await tx`delete from documents where id > ${m.documents}`;
  });
  const now = await tableCounts(sql);
  const off = Object.keys(baseline.counts).filter((k) => now[k] !== baseline.counts[k]);
  if (off.length > 0) {
    throw new Error(
      `eval database not clean after cleanup: ${off.map((k) => `${k} ${now[k]} (baseline ${baseline.counts[k]})`).join(", ")}`,
    );
  }
}

// ---------- one case ----------

export interface CallSummary {
  requestKey: string;
  model: string;
  mode: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  costUsd: number;
  stopReason: string | null;
}

/** One line of rows.jsonl. */
export interface CaseRow {
  id: string;
  run: number;
  tags: string[];
  status: PipelineStatus;
  kind: CaseOutcome["kind"];
  error: string | null;
  errorKind: ErrorKind | null;
  failedChecks: string[];
  normalised: NormalisedView | null;
  grade: CaseGrade;
  latencyMs: number;
  llmLatencyMs: number;
  costUsd: number;
  calls: CallSummary[];
  /** Models the response (or the replayed recording) named. */
  servedModels: string[];
  /** What processDocument logged (failures). */
  log: string[];
  /** Where the stored quote is not the graded view (see `storedQuoteProblems`); empty when it is. */
  runnerErrors: string[];
}

/** What the scorecard reads of each row. */
export const gradedRuns = (rows: readonly CaseRow[]): GradedRun[] =>
  rows.map((r) => ({
    run: r.run,
    grade: r.grade,
    latencyMs: r.latencyMs,
    llmLatencyMs: r.llmLatencyMs,
    costUsd: r.costUsd,
  }));

/** The meta fields a report derives from its rows (the runner and eval:merge share them). */
export function metaOfRows(
  rows: readonly CaseRow[],
): Pick<ScorecardMeta, "servedModels" | "runnerErrors" | "calls"> {
  return {
    servedModels: [...new Set(rows.flatMap((r) => r.servedModels))].sort(),
    runnerErrors: rows.flatMap((r) =>
      r.runnerErrors.map((e) => `${r.id}${r.run > 1 ? ` #${r.run}` : ""}: ${e}`),
    ),
    // A record run reuses existing recordings (Ruling 25); those rows are written as `replay`.
    calls: {
      total: rows.reduce((a, r) => a + r.calls.length, 0),
      fromRecordings: rows.reduce(
        (a, r) => a + r.calls.filter((c) => c.mode === "replay").length,
        0,
      ),
    },
  };
}

/** The passes-file outcome of a row: "graded", or "error:<kind>" for an error that is not graded. */
export const passOutcome = (errorKind: string | null): string =>
  errorKind === null ? "graded" : `error:${errorKind}`;

/** One line of transcripts.jsonl. */
export interface Transcript {
  id: string;
  run: number;
  document: {
    sender: string | null;
    subject: string | null;
    receivedAt: string;
    hasUnreadableAttachment: boolean;
    bodyText: string;
  };
  extraction: {
    status: string;
    kind: string | null;
    model: string;
    promptVersion: string;
    rawOutput: unknown;
    fieldEvidence: unknown;
    checkResults: unknown;
    error: string | null;
  };
  /** Requests and responses: from the transport (live, record) or the recordings (replay). */
  exchanges: unknown[];
}

const STATUSES: readonly string[] = ["extracted", "needs_review", "not_a_quote", "failed"];

interface CaseContext {
  sql: Sql;
  world: World;
  keys: EntityKeys;
  baseline: Baseline;
  extractor: Extractor;
  slot: CaseSlot;
  mode: LlmMode | "oracle" | "empty";
  recordingsDir: string;
  guard: SpendGuard | null;
  exchanges: Exchange[];
}

interface ExtractionRow {
  id: number;
  status: string;
  kind: "quote" | "not_a_quote" | null;
  raw_output: unknown;
  field_evidence: unknown;
  check_results: unknown;
  error: string | null;
  model: string;
  prompt_version: string;
}

interface DocumentRow {
  sender: string | null;
  subject: string | null;
  body_text: string;
  received_at: string;
  has_unreadable_attachment: boolean;
}

/** The recorded request and response for a replayed call, and the model the response names. */
async function replayed(dir: string, requestKey: string) {
  try {
    const rec = RecordingFile.parse(
      JSON.parse(await readFile(join(dir, `${requestKey}.json`), "utf8")),
    );
    const model = (rec.response.body as { model?: unknown } | null)?.model;
    return {
      exchange: rec,
      model: typeof model === "string" ? model : "(recording names no model)",
    };
  } catch (err) {
    return {
      exchange: { requestKey, unreadable: (err as Error).message },
      model: "(recording unreadable)",
    };
  }
}

interface StoredQuoteRow {
  id: number;
  extraction_id: number;
  supplier_id: number;
  port_id: number;
  currency: string;
  barge_fee: number;
  valid_until: string | null;
  delivery_from: string | null;
  delivery_to: string | null;
}

/**
 * What the pipeline stored must be what is graded (the grade reads a view recomputed from the
 * stored raw output). An `extracted` case must have exactly one stored quote, of its extraction,
 * whose supplier, port, currency, dates, barge fee and lines equal the graded view; any other
 * status must have none. Returns each disagreement (empty when they agree).
 */
export async function storedQuoteProblems(
  sql: Sql,
  extractionId: number,
  status: PipelineStatus,
  view: NormalisedView | null,
): Promise<string[]> {
  // The runner deletes every case-created quote before each case: any one here is this case's.
  const quotes = await sql<StoredQuoteRow[]>`
    select id, extraction_id, supplier_id, port_id, currency, barge_fee,
           to_char(valid_until at time zone 'UTC', 'YYYY-MM-DD') as valid_until,
           to_char(delivery_from at time zone 'UTC', 'YYYY-MM-DD') as delivery_from,
           to_char(delivery_to at time zone 'UTC', 'YYYY-MM-DD') as delivery_to
    from quotes where extraction_id is not null order by id`;
  if (status !== "extracted") {
    return quotes.length === 0 ? [] : [`status ${status}, but ${quotes.length} quote(s) stored`];
  }
  const [q] = quotes;
  if (quotes.length !== 1 || !q || q.extraction_id !== extractionId) {
    return [
      `extracted, but ${quotes.length} quote(s) stored (expected exactly one, of extraction ${extractionId})`,
    ];
  }
  if (view === null) return ["extracted, but there is no normalised view to grade"];
  const lines = await sql<{ grade: string; qty_mt: number; price_per_mt: number }[]>`
    select grade, qty_mt, price_per_mt from quote_lines where quote_id = ${q.id} order by id`;
  const stored = {
    supplierId: q.supplier_id,
    portId: q.port_id,
    currency: q.currency,
    validUntil: q.valid_until,
    deliveryFrom: q.delivery_from,
    deliveryTo: q.delivery_to,
    bargeFee: q.barge_fee,
    lines: lines.map((l) => ({ grade: l.grade, qtyMt: l.qty_mt, pricePerMt: l.price_per_mt })),
  };
  const graded: Record<keyof typeof stored, unknown> = {
    supplierId: view.supplierId,
    portId: view.portId,
    currency: view.currency,
    validUntil: view.validUntil,
    deliveryFrom: view.deliveryFrom,
    deliveryTo: view.deliveryTo,
    bargeFee: view.bargeFee,
    lines: view.lines,
  };
  return (Object.keys(stored) as (keyof typeof stored)[])
    .filter((k) => JSON.stringify(stored[k]) !== JSON.stringify(graded[k]))
    .map((k) => `${k}: stored ${JSON.stringify(stored[k])}, graded ${JSON.stringify(graded[k])}`);
}

async function runCase(
  ctx: CaseContext,
  c: GoldenCase,
  run: number,
): Promise<{ row: CaseRow; transcript: Transcript }> {
  const { sql } = ctx;
  const id = c.truth.id;
  await cleanupCases(sql, ctx.baseline);
  ctx.slot.oracle = c.oracle;
  ctx.slot.errorKind = null;
  const servedMark = ctx.guard?.served.length ?? 0;
  const exchangeMark = ctx.exchanges.length;
  const log: string[] = [];
  // The eval database is not the pinned demo: ingestion stamps rows with the wall clock.
  const deps: IngestDeps = {
    sql,
    extractor: ctx.extractor,
    now: () => new Date(),
    log: (m) => log.push(m),
  };

  const t0 = performance.now();
  const ingested = await ingestRaw(deps, c.raw, "upload");
  if (ingested.duplicate) throw new Error(`${id}: the cleaned eval database already holds it`);
  await processDocument(deps, ingested.documentId);
  const latencyMs = performance.now() - t0;

  const [ex] = await sql<ExtractionRow[]>`
    select id, status, kind, raw_output, field_evidence, check_results, error, model, prompt_version
    from extractions where document_id = ${ingested.documentId} order by id desc limit 1`;
  const [doc] = await sql<DocumentRow[]>`
    select sender, subject, body_text, received_at, has_unreadable_attachment
    from documents where id = ${ingested.documentId}`;
  if (!ex || !doc) throw new Error(`${id}: document or extraction row missing after processing`);
  if (!STATUSES.includes(ex.status)) {
    throw new Error(`${id}: extraction is ${ex.status} after processDocument returned`);
  }
  const status = ex.status as PipelineStatus;
  const errorKind = ctx.slot.errorKind;
  if (errorKind !== null && status !== "failed") {
    throw new Error(`${id}: the extractor threw (${errorKind}) but the row is ${status}`);
  }

  const calls = (
    await sql<Record<string, unknown>[]>`
      select request_key, model, mode, input_tokens, output_tokens, cache_read_tokens,
             cache_write_tokens, latency_ms, cost_usd, stop_reason
      from llm_calls where document_id = ${ingested.documentId} order by id`
  ).map(
    (r): CallSummary => ({
      requestKey: String(r.request_key),
      model: String(r.model),
      mode: String(r.mode),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
      latencyMs: Number(r.latency_ms),
      costUsd: Number(r.cost_usd),
      stopReason: r.stop_reason === null ? null : String(r.stop_reason),
    }),
  );

  let servedModels: string[] = [];
  let exchanges: unknown[] = [];
  if (ctx.mode === "replay") {
    const recs = await Promise.all(
      calls.map((call) => replayed(ctx.recordingsDir, call.requestKey)),
    );
    servedModels = recs.map((r) => r.model);
    exchanges = recs.map((r) => r.exchange);
  } else if (ctx.mode === "live" || ctx.mode === "record") {
    servedModels = ctx.guard?.served.slice(servedMark) ?? [];
    exchanges = ctx.exchanges.slice(exchangeMark);
  }

  const raw = ex.raw_output === null ? null : ExtractionOutput.parse(ex.raw_output);
  const checks = z.array(CheckResult).parse(ex.check_results);
  const receivedAt = new Date(doc.received_at);
  const outcome: CaseOutcome = {
    status,
    kind: ex.kind,
    normalised:
      raw === null
        ? null
        : normaliseExtraction(
            ctx.world,
            { sender: doc.sender, subject: doc.subject, bodyText: doc.body_text },
            raw,
            receivedAt,
          ),
    error: ex.error,
    errorKind,
    failedChecks: checks.filter((x) => !x.passed).map((x) => x.check),
  };
  const grade = gradeCase(c.truth, outcome, ctx.keys);
  const runnerErrors = await storedQuoteProblems(sql, ex.id, status, outcome.normalised);
  const row: CaseRow = {
    id,
    run,
    tags: c.truth.tags,
    status,
    kind: outcome.kind,
    error: outcome.error,
    errorKind,
    failedChecks: outcome.failedChecks,
    normalised: outcome.normalised,
    grade,
    latencyMs,
    llmLatencyMs: calls.reduce((a, x) => a + x.latencyMs, 0),
    costUsd: calls.reduce((a, x) => a + x.costUsd, 0),
    calls,
    servedModels,
    log,
    runnerErrors,
  };
  const transcript: Transcript = {
    id,
    run,
    document: {
      sender: doc.sender,
      subject: doc.subject,
      receivedAt: receivedAt.toISOString(),
      hasUnreadableAttachment: doc.has_unreadable_attachment,
      bodyText: doc.body_text,
    },
    extraction: {
      status: ex.status,
      kind: ex.kind,
      model: ex.model,
      promptVersion: ex.prompt_version,
      rawOutput: ex.raw_output,
      fieldEvidence: ex.field_evidence,
      checkResults: ex.check_results,
      error: ex.error,
    },
    exchanges,
  };
  return { row, transcript };
}

// ---------- the run ----------

/** The signals a run handles: Ctrl-C, a kill, and a closed terminal. */
export type InterruptSignal = "SIGINT" | "SIGTERM" | "SIGHUP";
export const INTERRUPT_SIGNALS: readonly InterruptSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/** Where interrupt signals come from (`process` by default; tests inject an emitter). */
export interface SignalSource {
  once(signal: InterruptSignal, listener: () => void): unknown;
  off(signal: InterruptSignal, listener: () => void): unknown;
}

/** Exit status after SIGINT, SIGTERM or SIGHUP is handled (128 + 2, the shell's interrupt status). */
export const INTERRUPT_EXIT = 130;

/**
 * Refuses, before any call, a final held-out pass (one that writes pass rows) whose label is empty:
 * every pass row names its pass by the label.
 */
export function assertPassLabel(passesPath: string | null, label: string): void {
  if (passesPath !== null && label.trim() === "") {
    throw new Error(
      "a final held-out pass needs a non-empty --label: it names the pass's rows in the passes file",
    );
  }
}

export interface EvalOptions {
  sql: Sql;
  split: SplitName;
  mode: LlmMode;
  extractor: ExtractorKind;
  label: string;
  repeatHard?: number;
  limit?: number | null;
  /** Cases of the split skipped first (split.json order). */
  offset?: number;
  /** Explicit case ids (a subset of the split), in place of `limit` and `offset`. */
  ids?: string[];
  final?: boolean;
  reportsDir: string;
  goldenDir?: string;
  recordingsDir?: string;
  /** Required for live and record. */
  apiKey?: string | undefined;
  /** The network transport for live and record (tests inject one). */
  fetch?: LlmFetch;
  /** Spend ledger path (tests use a temp file). */
  ledgerPath?: string;
  /** Budget config path (tests use a temp file); default evals/budget.json. */
  budgetPath?: string;
  /**
   * The held-out passes file. Used only by a final live held-out pass of the model; with no path
   * the guard is off. Only the CLI `main()` passes `HELDOUT_PASSES_PATH`; tests use temp files.
   */
  passesPath?: string;
  now?: () => Date;
  log?: (line: string) => void;
  /** Interrupt signals; default `process`. */
  signals?: SignalSource;
  /** Called with 130 once an interrupt is handled; default `process.exit`. */
  exit?: (code: number) => void;
}

export interface EvalResult {
  reportDir: string;
  meta: ScorecardMeta;
  scorecard: Scorecard;
  rows: CaseRow[];
}

/**
 * The passes file a run reads and appends to: only a final live held-out pass of the model, and
 * only when a path is given. Every other pass (dev, oracle, empty, replay) never touches it.
 */
export function heldoutPassesPath(o: {
  split: SplitName;
  final?: boolean | undefined;
  mode: LlmMode;
  model: boolean;
  passesPath?: string | undefined;
}): string | null {
  const armed = o.model && o.final === true && o.split === "heldout" && o.mode === "live";
  return armed && o.passesPath ? o.passesPath : null;
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/** Creates `<reportsDir>/<name>`, or `<name>-2`, `-3`, ... when it exists: never over a report. */
export async function createReportDir(reportsDir: string, name: string): Promise<string> {
  await mkdir(reportsDir, { recursive: true });
  for (let n = 1; n < 1000; n++) {
    const dir = join(reportsDir, n === 1 ? name : `${name}-${n}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (err) {
      if ((err as { code?: unknown }).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`no free report directory for ${name} in ${reportsDir}`);
}

/**
 * After a runner fault, before the fault is rethrown: ledgers the spend (once; the run's own
 * `finally` then appends nothing) and writes the report for the rows so far, so the cases not run
 * can run once more and the reports be merged. Never throws over the fault.
 */
export function writeFaultReport(
  run: { settle: () => void },
  writeReport: () => void,
  reason: string,
): void {
  try {
    run.settle();
  } catch (err) {
    console.error(`[eval] ${reason}: could not ledger the spend: ${(err as Error).message}`);
  }
  try {
    writeReport();
  } catch (err) {
    console.error(`[eval] ${reason}: could not write the report: ${(err as Error).message}`);
  }
}

/** What a run shares with its interrupt handler and its ledger. */
interface RunContext {
  guard: SpendGuard | null;
  /** Requests sent whose response (and so whose cost) the guard has not seen yet. */
  inflight: { n: number };
  /** Appends the run's spend to the ledger unless it already has; synchronous. */
  settle: () => void;
  /** What `settle` appended, or null (nothing yet, or an unpaid run). */
  ledgered: () => number | null;
  /** Set by the interrupt handler. */
  interrupted: { reason: string | null };
  /** Writes the report for the rows so far, synchronously; set once the report directory exists. */
  writePartial: ((aborted: string) => void) | null;
  /** The held-out passes file this run appends to, or null (see `heldoutPassesPath`). */
  passesPath: string | null;
  /** The split's ids in split.json order (`resumeHint`). */
  order: readonly string[];
  now: () => Date;
}

export async function runExtractionEval(opts: EvalOptions): Promise<EvalResult> {
  assertSplitAllowed(opts.split, opts.final ?? false);
  const repeatHard = opts.repeatHard ?? 1;
  if (!Number.isInteger(repeatHard) || repeatHard < 1) throw new Error("repeatHard must be >= 1");
  const llm = opts.extractor === "llm";
  if (llm && opts.mode === "record" && repeatHard > 1) throw new Error(REPEAT_RECORD);
  assertFinalMode(opts.final ?? false, opts.mode);
  const paid = llm && opts.mode !== "replay";
  const now = opts.now ?? (() => new Date());
  const goldenDir = opts.goldenDir ?? GOLDEN_DIR;

  const ids = await selectCases(opts.split, {
    ids: opts.ids,
    limit: opts.limit,
    offset: opts.offset,
    goldenDir,
  });
  // A held-out case runs once: before any call, ledger row or report, refuse a final live pass
  // that selects a case already in the passes file.
  const passesPath = heldoutPassesPath({ ...opts, model: llm });
  assertPassLabel(passesPath, opts.label);
  if (passesPath !== null) assertNotRun("extraction", ids, passesPath);
  const order = await splitOrder(opts.split, goldenDir);
  const cases = await Promise.all(
    ids.map((id) => loadCase(goldenDir, id, opts.extractor === "oracle")),
  );
  // First runs of every case come first, so an early stop costs repeats before headline cases.
  const plan = [
    ...cases.map((c) => ({ c, run: 1 })),
    ...cases
      .filter((c) => c.truth.tags[0] === "hard")
      .flatMap((c) => Array.from({ length: repeatHard - 1 }, (_, i) => ({ c, run: i + 2 }))),
  ];

  if (llm) assertHaikuOnly([EVAL_EXTRACTOR_CONFIG.extractModel]);
  let guard: SpendGuard | null = null;
  if (paid) {
    const estimate = assertPassEstimate(plan.length);
    if (!opts.apiKey) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env).");
    assertBudget(estimate, opts.ledgerPath, undefined, opts.budgetPath);
    const { remainingUsd: remaining } = budgetRemaining(
      opts.ledgerPath,
      undefined,
      opts.budgetPath,
    );
    guard = createSpendGuard({
      capUsd: Math.min(RUN_CAP_USD, remaining),
      label: "run",
      allowedModel: HAIKU,
    });
  }

  // From here a paid run may spend. Its cost is ledgered exactly once: at the end, in the
  // `finally` below, or by the interrupt handler, whichever comes first.
  const inflight = { n: 0 };
  let appended: number | null = null;
  const settle = () => {
    if (!paid || !guard || appended !== null) return;
    // A request still in flight has no usage yet: it is counted at the per-case estimate.
    const costUsd = guard.spentUsd() + inflight.n * ESTIMATE_PER_CASE_RUN_USD;
    appendSpend(
      { at: now().toISOString(), run: LEDGER_RUN, label: opts.label, costUsd },
      opts.ledgerPath,
      opts.budgetPath,
    );
    appended = costUsd;
  };
  const ctx: RunContext = {
    guard,
    inflight,
    settle,
    ledgered: () => appended,
    interrupted: { reason: null },
    writePartial: null,
    passesPath,
    order,
    now,
  };

  // Ctrl-C or a kill during a paid run must not lose its spend from the ledger: the handler
  // ledgers it and writes the report so far synchronously, then exits 130.
  const signals = opts.signals ?? process;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const onSignal = (signal: InterruptSignal) => () => {
    const reason = `interrupted by ${signal}`;
    ctx.interrupted.reason = reason;
    try {
      settle();
    } catch (err) {
      console.error(`[eval] ${reason}: could not ledger the spend: ${(err as Error).message}`);
    }
    try {
      ctx.writePartial?.(reason);
    } catch (err) {
      console.error(`[eval] ${reason}: could not write the report: ${(err as Error).message}`);
    }
    exit(INTERRUPT_EXIT);
  };
  const handlers = INTERRUPT_SIGNALS.map((s) => [s, onSignal(s)] as const);
  for (const [s, h] of handlers) signals.once(s, h);
  try {
    return await withRunLock(opts.sql, () => runPlan(opts, plan, ctx));
  } finally {
    for (const [s, h] of handlers) signals.off(s, h);
    settle();
  }
}

async function runPlan(
  opts: EvalOptions,
  plan: { c: GoldenCase; run: number }[],
  run: RunContext,
): Promise<EvalResult> {
  const { guard, now } = run;
  const log = opts.log ?? ((l: string) => console.log(l));
  const startedAt = now();
  const recordingsDir = opts.recordingsDir ?? DEFAULT_RECORDINGS_DIR;
  const llm = opts.extractor === "llm";

  // The report directory exists before the first call; rows and transcripts are appended as each
  // case finishes, so a run that fails or is stopped part way keeps what it paid for.
  const reportDir = await createReportDir(
    opts.reportsDir,
    `${stamp(startedAt)}-extraction-${opts.split}-${opts.label}`,
  );
  const file = (name: string) => join(reportDir, name);
  writeFileSync(file("rows.jsonl"), "");
  writeFileSync(file("transcripts.jsonl"), "");

  const { world, baseline } = await prepareEvalDb(opts.sql);

  const slot: CaseSlot = { oracle: null, errorKind: null };
  const exchanges: Exchange[] = [];
  let extractor: Extractor;
  let promptVersion: string;
  if (opts.extractor === "llm") {
    const network: LlmFetch =
      opts.mode === "replay"
        ? async () => {
            throw new Error("replay mode attempted a network request");
          }
        : (opts.fetch ?? ((input, init) => fetch(input, init)));
    const tapped = capturing(network, exchanges);
    const guarded = guard ? guard.wrap(tapped, HAIKU) : tapped;
    // Counts requests the guard has not costed yet (for the interrupt handler's ledger row).
    const counted: LlmFetch = async (input, init) => {
      run.inflight.n++;
      try {
        return await guarded(input, init);
      } finally {
        run.inflight.n--;
      }
    };
    const client = createLlm({
      mode: opts.mode,
      apiKey: opts.apiKey,
      recordingsDir,
      onCall: captureLlmCall,
      fetch: counted,
    });
    const inner = createLlmExtractor(client, EVAL_EXTRACTOR_CONFIG);
    promptVersion = inner.promptVersion;
    extractor = classifying(inner, slot);
  } else {
    extractor = fixedExtractor(opts.extractor, slot);
    promptVersion = opts.extractor;
  }
  const ctx: CaseContext = {
    sql: opts.sql,
    world,
    keys: entityKeys(world),
    baseline,
    extractor,
    slot,
    mode: opts.extractor === "llm" ? opts.mode : opts.extractor,
    recordingsDir,
    guard,
    exchanges,
  };

  const rows: CaseRow[] = [];
  /** Plan steps finished; the rest (an interrupted case included) are not run. */
  let done = 0;
  const remaining = () =>
    plan.slice(done).map((s) => (s.run === 1 ? s.c.truth.id : `${s.c.truth.id}#${s.run}`));

  /** Scores the rows so far and writes scorecard.json and scorecard.md (synchronously). */
  const writeScorecard = (aborted: string | null, notRun: string[]) => {
    const card = scorecard(gradedRuns(rows));
    const fromRows = metaOfRows(rows);
    const meta: ScorecardMeta = {
      suite: "extraction",
      split: opts.split,
      label: opts.label,
      mode: opts.extractor === "llm" ? opts.mode : opts.extractor,
      extractor: opts.extractor,
      model: llm ? EVAL_EXTRACTOR_CONFIG.extractModel : null,
      effort: llm ? EVAL_EXTRACTOR_CONFIG.extractEffort : null,
      fallbacks: llm ? EVAL_EXTRACTOR_CONFIG.llmFallbacks : null,
      promptVersion,
      seed: EVAL_SEED,
      anchor: EVAL_ANCHOR.toISOString(),
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      selected: new Set(plan.map((s) => s.c.truth.id)).size,
      offset: opts.ids ? 0 : (opts.offset ?? 0),
      limit: opts.ids ? null : (opts.limit ?? null),
      repeatHard: opts.repeatHard ?? 1,
      notRun,
      aborted,
      servedModels: fromRows.servedModels,
      spend: {
        guardUsd: guard ? guard.spentUsd() : null,
        dbUsd: card.cost.totalUsd,
        ledgerUsd: run.ledgered(),
        parseErrors: guard ? [...guard.parseErrors] : [],
      },
      runnerErrors: fromRows.runnerErrors,
      calls: fromRows.calls,
      final: opts.final ?? false,
    };
    writeFileSync(
      file("scorecard.json"),
      `${JSON.stringify({ meta, scorecard: card }, null, 2)}\n`,
    );
    writeFileSync(file("scorecard.md"), `${renderScorecardMd(card, meta)}\n`);
    return { card, meta };
  };
  /** The line every stop, abort and fault logs: what stopped the pass and where it resumes. */
  const stopLine = (reason: string, rest: readonly string[]) =>
    `[eval] stopped before ${rest[0] ?? "(none)"}: ${reason}; ${resumeHint(run.order, rest)}`;
  run.writePartial = (aborted) => {
    const rest = remaining();
    writeScorecard(aborted, rest);
    log(stopLine(aborted, rest));
  };

  let aborted: string | null = null;
  let notRun: string[] = [];
  /** Set by an armed pass's API-error row (Ruling P17); checked after the spend guard. */
  let outage: string | null = null;
  for (const step of plan) {
    // An interrupt, the spend cap, (live, record) a response served by a model other than Haiku,
    // or (an armed held-out pass) the API error of the case before.
    const overCap = guard?.overCap() ?? null;
    const trip = guard?.trip() ?? null;
    const stop =
      run.interrupted.reason ??
      (overCap !== null
        ? `spend cap: ${overCap}`
        : trip === null
          ? outage
          : trip.source === "model"
            ? trip.reason
            : `spend cap: ${trip.reason}`);
    if (stop !== null) {
      aborted = stop;
      notRun = remaining();
      log(stopLine(aborted, notRun));
      break;
    }
    let row: CaseRow;
    try {
      const result = await runCase(ctx, step.c, step.run);
      row = result.row;
      // The pass row first: once it is written the case is consumed (it never runs again), even if
      // a write below fails. A failed pass-row write stops the run before the case has a row.
      if (run.passesPath !== null) {
        appendPass(
          {
            suite: "extraction",
            id: row.id,
            run: row.run,
            at: now().toISOString(),
            label: opts.label,
            report: basename(reportDir),
            outcome: passOutcome(row.errorKind),
          },
          run.passesPath,
        );
      }
      appendFileSync(file("rows.jsonl"), `${JSON.stringify(row)}\n`);
      rows.push(row);
      done++;
      appendFileSync(file("transcripts.jsonl"), `${JSON.stringify(result.transcript)}\n`);
      // A kill with no handler still leaves a mergeable report; the end-of-run write replaces it.
      writeScorecard(DID_NOT_FINISH, remaining());
    } catch (err) {
      // A runner fault (not a model outcome) fails the run. The report so far gets its scorecard
      // first, so the cases not run can run once more and the reports be merged.
      const reason = `runner fault: ${err instanceof Error ? err.message : String(err)}`;
      writeFaultReport(run, () => writeScorecard(reason, remaining()), reason);
      log(stopLine(reason, remaining()));
      throw err;
    }
    const what = row.errorKind ? `error ${row.errorKind}` : row.status;
    log(
      `[eval] ${row.id}${step.run > 1 ? ` #${step.run}` : ""}: ${what} ${(row.latencyMs / 1000).toFixed(1)}s $${row.costUsd.toFixed(5)}`,
    );
    if (run.passesPath !== null && row.errorKind === "api_error") {
      outage = apiErrorStop(step.run > 1 ? `${row.id}#${step.run}` : row.id);
    }
  }
  run.settle();
  const { card, meta } = writeScorecard(aborted, notRun);
  log(`[eval] report: ${reportDir}`);
  // Only after the report is complete: a cleanup failure still fails the run, but it can no longer
  // leave a finished pass without its scorecard (the next run reseeds the database anyway).
  await cleanupCases(opts.sql, baseline);

  // A call served (or requested) by any model but Haiku fails the run; the report above says where.
  if (llm) {
    const requested = rows.flatMap((r) => r.calls.map((c) => c.model));
    assertHaikuOnly([...meta.servedModels, ...requested]);
  }
  // A response body the guard could not read has an uncounted cost: the ledger may be short.
  if (meta.spend.parseErrors.length > 0) {
    throw new Error(
      `the spend guard could not read ${meta.spend.parseErrors.length} response bodies, so their cost is not counted: ${meta.spend.parseErrors.join("; ")}`,
    );
  }
  // A graded view that is not what was stored would make the scorecard measure something else.
  if (meta.runnerErrors.length > 0) {
    throw new Error(
      `${meta.runnerErrors.length} stored quote(s) differ from the graded view: ${meta.runnerErrors.join("; ")}`,
    );
  }
  return { reportDir, meta, scorecard: card, rows };
}

// ---------- CLI ----------

const fmt = (r: { k: number; n: number; rate: number | null }) =>
  `${r.k}/${r.n}${r.rate === null ? "" : ` (${(r.rate * 100).toFixed(1)} %)`}`;

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paid = args.extractor === "llm" && args.mode !== "replay";
  const apiKey = paid ? requireApiKey(process.env) : undefined;
  const sql = await connectTestDb(EVAL_DB);
  if (!sql) throw new Error("Postgres is unreachable (start it with docker compose up -d db).");
  try {
    const { scorecard: card, meta } = await runExtractionEval({
      sql,
      split: args.split,
      mode: args.mode,
      extractor: args.extractor,
      label: args.label,
      repeatHard: args.repeatHard,
      limit: args.limit,
      offset: args.offset,
      final: args.final,
      apiKey,
      reportsDir: resolve(REPO_ROOT, "evals", "reports"),
      // The only place the tracked passes file is named (a final live held-out pass uses it).
      passesPath: HELDOUT_PASSES_PATH,
    });
    console.log(`critical-field accuracy ${fmt(card.critical)}`);
    console.log(`unsafe auto-accepts ${fmt(card.unsafeAutoAccepts)}`);
    console.log(
      `errors ${card.errors.length}; llm_calls cost $${meta.spend.dbUsd.toFixed(6)}` +
        (meta.spend.ledgerUsd === null
          ? " (nothing spent or ledgered)"
          : `; ledgered $${meta.spend.ledgerUsd.toFixed(6)}`),
    );
    const reused = recordingsNotice(meta);
    if (reused) console.error(`[eval] ${reused}. Measure with --mode live.`);
    const misses = card.errors.filter((e) => e.kind === "replay_miss").length;
    if (misses > 0) {
      console.error(`[eval] ${misses} replay misses: record them with --mode record.`);
      process.exitCode = 1;
    }
    if (meta.aborted) {
      const order = await splitOrder(args.split, GOLDEN_DIR);
      console.error(`[eval] stopped early: ${meta.aborted}; ${resumeHint(order, meta.notRun)}`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[eval] ${(err as Error).message}`);
    process.exit(1);
  });
}
