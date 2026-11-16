/**
 * The Q&A eval runner. Each golden question of a split goes through the same code path as
 * `POST /api/ask` (`runAgent` with the tool registry) on a clean database, and is graded by
 * grade.ts and summed by scorecard.ts.
 *
 *   npm run eval -- --suite qa --split dev --mode replay|live|record
 *                   [--oracle | --empty] [--label x] [--offset n] [--limit n] [--final]
 *
 * Database: `connectTestDb("eval_qa")`. Before EVERY question it is reset to the Q&A world
 * (`prepareAskFixture`: seed 20261114, anchor 2026-11-14T08:00Z, plus the two demo quotes), so
 * serial ids, and so replay keys, never depend on question order. The agent clock is
 * ASK_FIXTURE_NOW.
 *
 * Model: Claude Haiku 5.5 only, effort medium, fallbacks off (`QA_AGENT_CONFIG`, fixed, not from
 * env). In live and record the spend guard refuses every request after the first response served
 * by another model; every served and requested model is checked after the run.
 * Spend (live and record), the same rules as the extraction runner: the estimate (questions x
 * $0.004, `ESTIMATE_PER_QUESTION_USD`) must fit the $0.25 per-pass cap and `assertBudget` before
 * the first call; a per-request guard capped at min($0.25, what the phase budget has left); the
 * guard's cost is appended to the ledger afterwards, also when the run fails, stops early or is
 * interrupted.
 * `--oracle` answers from the truth's reference facts and `--empty` answers nothing: neither
 * makes a model call or touches the database, and both need no key. `--split heldout` needs
 * `--final`. Record mode is replay-first (Ruling 25): it only refreshes recordings, so a record run
 * with a call served from one is not a measurement (meta.calls.fromRecordings, printed), and
 * `--final` refuses it. Measure with `--mode live`.
 * Held-out runs once (Ruling R8), as in the extraction runner: a final live held-out pass refuses
 * to start when a selected question is already in `evals/heldout-passes.jsonl` (or the label is
 * empty), and appends one row there per question row it writes, before that row (errors
 * included); it handles SIGINT, SIGTERM and SIGHUP alike; oracle, empty and replay passes never
 * touch that file; `npm run eval:merge` joins the reports of a pass that stopped early. Such a
 * pass stops at its first API error (Ruling P17; the spend cap's reason wins). After every
 * question the scorecard so far is written ("did not finish (no final scorecard)"), replaced by
 * the end-of-run write; every stop, abort and fault line names `resume with --offset <n>`.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APIError } from "@anthropic-ai/sdk";
import type { Sql } from "@pharos/db";
import { connectTestDb } from "@pharos/db/testing";
import { type Fact, type LlmMode, QaTruth } from "@pharos/shared";
import { z } from "zod";
import { type AgentConfig, AgentError, runAgent } from "../../apps/api/src/ai/agent.js";
import { captureLlmCall } from "../../apps/api/src/ai/call-capture.js";
import { createLlm, type LlmFetch, ReplayMissError } from "../../apps/api/src/ai/llm.js";
import { PROMPT_VERSION } from "../../apps/api/src/ai/prompts/agent-system.js";
import { citedFactIds } from "../../apps/api/src/ai/release-gate.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../apps/api/src/ask/demo-fixture.js";
import { DEFAULT_RECORDINGS_DIR } from "../../apps/api/src/config.js";
import {
  apiErrorStop,
  assertFinalMode,
  assertPassLabel,
  assertSplitAllowed,
  capturing,
  createReportDir,
  DID_NOT_FINISH,
  type Exchange,
  heldoutPassesPath,
  INTERRUPT_EXIT,
  INTERRUPT_SIGNALS,
  type InterruptSignal,
  passOutcome,
  requireApiKey,
  resumeHint,
  type SignalSource,
  type SplitName,
  splitOrder,
  withRunLock,
  writeFaultReport,
} from "../extraction/run.js";
import { recordingsNotice } from "../extraction/scorecard.js";
import { EVAL_ANCHOR, EVAL_SEED } from "../extraction/world.js";
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
import { gradeQa, type QaGrade, type QaOutcome, type RecommendationType } from "./grade.js";
import { emptyOutcome, oracleOutcome } from "./oracle.js";
import { insertInjectedShip } from "./reference.js";
import {
  type QaErrorKind,
  type QaRun,
  type QaScorecard,
  type QaScorecardMeta,
  qaScorecard,
  renderQaScorecardMd,
} from "./scorecard.js";
import { QA_GOLDEN_DIR } from "./split.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The CLI's database; the vitest tests use their own. */
export const EVAL_DB = "eval_qa";
export const LEDGER_RUN = "eval-qa";
/**
 * Budget estimate per question: Phase 4 measured $0.00103 per question on Haiku; route questions
 * take a few more tool calls, so 4x that. 31 dev questions estimate $0.124, under the cap.
 */
export const ESTIMATE_PER_QUESTION_USD = 0.004;
/** A pass must stay at or below this. */
export const RUN_CAP_USD = 0.25;
/** The one agent configuration live, record and replay runs use. */
export const QA_AGENT_CONFIG: AgentConfig = {
  agentModel: HAIKU,
  agentEffort: "medium",
  llmFallbacks: false,
};

export type AnswererKind = "llm" | "oracle" | "empty";

// ---------- arguments ----------

export interface RunArgs {
  suite: "qa";
  split: SplitName;
  mode: LlmMode;
  answerer: AnswererKind;
  label: string;
  limit: number | null;
  offset: number;
  final: boolean;
}

const VALUE_FLAGS = ["--suite", "--split", "--mode", "--label", "--limit", "--offset"];
const BOOL_FLAGS = ["--oracle", "--empty", "--final"];

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
    else throw new Error(`unknown argument "${a}" (see evals/qa/README.md)`);
  }
  if (values.get("--suite") !== "qa") throw new Error('this runner needs "--suite qa"');
  const split = values.get("--split") ?? "dev";
  if (split !== "dev" && split !== "heldout") throw new Error("--split is dev or heldout");
  const final = bools.has("--final");
  assertSplitAllowed(split, final);
  if (bools.has("--oracle") && bools.has("--empty")) {
    throw new Error("--oracle and --empty are alternatives");
  }
  const answerer: AnswererKind = bools.has("--oracle")
    ? "oracle"
    : bools.has("--empty")
      ? "empty"
      : "llm";
  const modeArg = values.get("--mode");
  if (modeArg !== undefined && !["live", "record", "replay"].includes(modeArg)) {
    throw new Error("--mode is live, record or replay");
  }
  if (answerer !== "llm" && modeArg !== undefined && modeArg !== "replay") {
    throw new Error(`--${answerer} makes no model calls: drop --mode ${modeArg}`);
  }
  const mode = (modeArg ?? "replay") as LlmMode;
  assertFinalMode(final, mode);
  const label = values.get("--label") ?? (answerer === "llm" ? mode : answerer);
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error("--label needs a name made of letters, digits, '.', '_' or '-'");
  }
  const whole = (flag: string, v: string | undefined, min: number): number | null => {
    if (v === undefined) return null;
    if (!/^\d+$/.test(v) || Number(v) < min)
      throw new Error(`${flag} needs a whole number >= ${min}`);
    return Number(v);
  };
  return {
    suite: "qa",
    split,
    mode,
    answerer,
    label,
    limit: whole("--limit", values.get("--limit"), 1),
    offset: whole("--offset", values.get("--offset"), 0) ?? 0,
    final,
  };
}

// ---------- golden questions ----------

const SplitFile = z.object({ dev: z.array(z.string()), heldout: z.array(z.string()) });

/** The split's question ids in split.json order, after `offset` and up to `limit`. */
export async function selectQuestions(
  split: SplitName,
  opts: {
    ids?: string[] | undefined;
    limit?: number | null | undefined;
    offset?: number | undefined;
    goldenDir?: string;
  },
): Promise<string[]> {
  const dir = opts.goldenDir ?? QA_GOLDEN_DIR;
  const file = SplitFile.parse(JSON.parse(await readFile(join(dir, "split.json"), "utf8")));
  const pool = split === "dev" ? file.dev : file.heldout;
  if (opts.ids) {
    for (const id of opts.ids) {
      if (!pool.includes(id)) throw new Error(`question ${id} is not in the ${split} split`);
    }
    return opts.ids;
  }
  const offset = opts.offset ?? 0;
  if (offset >= pool.length) {
    throw new Error(`--offset ${offset} leaves no question: the ${split} split has ${pool.length}`);
  }
  return pool.slice(offset, opts.limit ? offset + opts.limit : undefined);
}

async function loadTruth(dir: string, id: string): Promise<QaTruth> {
  return QaTruth.parse(JSON.parse(await readFile(join(dir, `${id}.truth.json`), "utf8")));
}

// ---------- one question ----------

/** Tables only the executor or the ingest workflow may write; the agent must never grow them. */
const GUARDED_TABLES = [
  "purchase_orders",
  "order_lines",
  "drafted_messages",
  "audit_events",
  "quotes",
  "quote_lines",
  "documents",
  "extractions",
  "voyages",
  "vessels",
  "port_calls",
  "noon_reports",
  "bunker_requirements",
  "voyage_instructions",
] as const;

/** An md5 of each guarded table's rows: any insert, delete or update changes it. */
export async function guardedFingerprints(sql: Sql): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of GUARDED_TABLES) {
    const [row] = await sql<{ h: string }[]>`
      select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) as h from ${sql(t)} x`;
    out[t] = row?.h ?? "";
  }
  return out;
}

/** The guarded tables whose fingerprint differs between two snapshots. */
export const changedTables = (
  before: Record<string, string>,
  after: Record<string, string>,
): string[] => GUARDED_TABLES.filter((t) => before[t] !== after[t]);

/**
 * Hosts other than the model API are external. Wraps `globalThis.fetch` while `fn` runs (tool-side
 * HTTP goes through it) and says whether any such request was made; always restores it.
 */
export async function withExternalCallTap<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; externalCalls: string[] }> {
  const original = globalThis.fetch;
  const externalCalls: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      // a relative or malformed URL is external too
    }
    if (host !== "api.anthropic.com") externalCalls.push(url);
    return original(input, init);
  }) as typeof fetch;
  try {
    return { value: await fn(), externalCalls };
  } finally {
    globalThis.fetch = original;
  }
}

export function classifyAskError(err: unknown): QaErrorKind | null {
  if (err instanceof ReplayMissError) return "replay_miss";
  if (err instanceof AgentError) {
    if (/stop_reason refusal/.test(err.message)) return "refusal";
    if (/max_tokens/.test(err.message)) return "truncation";
    return "agent_error";
  }
  if (err instanceof APIError) return "api_error";
  return null;
}

export interface QaRow extends QaRun {
  models: string[];
  /** Guarded tables that grew during the question (also on an error). */
  foreignWrites: string[];
  llmLatencyMs: number;
  calls: number;
  /** Of `calls`, those a recording served (llm_calls mode `replay`; record mode is replay-first). */
  callsFromRecordings: number;
  runnerErrors: string[];
}

/** The meta fields a report derives from its rows (the runner and eval:merge share them). */
export function metaOfQaRows(
  rows: readonly QaRow[],
): Pick<QaScorecardMeta, "servedModels" | "runnerErrors" | "calls"> {
  return {
    servedModels: [...new Set(rows.flatMap((r) => r.models))].sort(),
    runnerErrors: rows.flatMap((r) => r.runnerErrors.map((e) => `${r.id}: ${e}`)),
    // A record run reuses existing recordings (Ruling 25); those rows are written as `replay`.
    calls: {
      total: rows.reduce((a, r) => a + r.calls, 0),
      fromRecordings: rows.reduce((a, r) => a + r.callsFromRecordings, 0),
    },
  };
}

export interface QaTranscript {
  id: string;
  question: string;
  mode: string;
  answer: string | null;
  withheldAnswer: string | null;
  error: string | null;
  gate: unknown;
  facts: Fact[];
  toolCalls: unknown[];
  recommendations: unknown[];
  grade: QaGrade | null;
  exchanges: Exchange[];
}

interface QuestionContext {
  sql: Sql;
  guard: SpendGuard | null;
  exchanges: Exchange[];
  llm: { client: Parameters<typeof runAgent>[0]["llm"]["client"] } | null;
  mode: string;
  slot: { erpCalled: boolean };
}

async function runQuestion(
  ctx: QuestionContext,
  truth: QaTruth,
): Promise<{ row: QaRow; transcript: QaTranscript }> {
  const { sql } = ctx;
  ctx.exchanges.length = 0;
  ctx.slot.erpCalled = false;
  await prepareAskFixture(sql);
  await insertInjectedShip(sql);
  const before = await guardedFingerprints(sql);
  const recsBefore = new Map(
    (
      await sql<{ id: number; raw: string }[]>`select id, r::text as raw from recommendations r`
    ).map((r) => [r.id, r.raw]),
  );
  const started = performance.now();
  let firstProgressMs: number | null = null;
  const box: { res: Awaited<ReturnType<typeof runAgent>> | null; failure: unknown } = {
    res: null,
    failure: null,
  };
  const tap = await withExternalCallTap(async () => {
    try {
      if (!ctx.llm) throw new Error("no LLM client");
      box.res = await runAgent(
        {
          sql,
          llm: ctx.llm,
          config: QA_AGENT_CONFIG,
          now: () => ASK_FIXTURE_NOW,
          onProgress: () => {
            firstProgressMs ??= performance.now() - started;
          },
        },
        truth.question,
      );
    } catch (err) {
      box.failure = err;
    }
  });
  const { res, failure } = box;
  ctx.slot.erpCalled = tap.externalCalls.length > 0;
  const latencyMs = performance.now() - started;

  const foreignWrites = changedTables(before, await guardedFingerprints(sql));
  const calls = await sql<
    { model: string; cost_usd: number; latency_ms: number; mode: string }[]
  >`select model, cost_usd, latency_ms, mode from llm_calls order by id`;
  const recs = await sql<
    {
      id: number;
      option_id: string | null;
      type: RecommendationType;
      status: string;
      raw: string;
    }[]
  >`select id, option_id, type, status, r::text as raw from recommendations r order by id`;
  /** Created or changed during the question. */
  const touched = recs.filter((r) => recsBefore.get(r.id) !== r.raw);
  const toolMessages = await sql<{ role: string; content: unknown }[]>`
    select role, content from messages order by id`;
  const costUsd = calls.reduce((a, c) => a + c.cost_usd, 0);
  const base = {
    id: truth.id,
    category: truth.tags[0] ?? "",
    latencyMs,
    firstProgressMs,
    costUsd,
    models: [...new Set(calls.map((c) => c.model))],
    foreignWrites,
    llmLatencyMs: calls.reduce((a, c) => a + c.latency_ms, 0),
    calls: calls.length,
    callsFromRecordings: calls.filter((c) => c.mode === "replay").length,
    runnerErrors: [] as string[],
  };

  let grade: QaGrade | null = null;
  let error: QaRow["error"] = null;
  if (res) {
    const outcome: QaOutcome = {
      answer: res.answer,
      gate: res.gate,
      ledger: res.facts,
      citedIds: res.answer === null ? [] : citedFactIds(res.answer),
      recommendations: touched.map((r) => ({
        optionId: r.option_id,
        type: r.type,
        status: r.status,
      })),
      erpCalled: ctx.slot.erpCalled,
      foreignWrites,
    };
    grade = gradeQa(truth, outcome);
  } else {
    const kind = classifyAskError(failure);
    if (kind === null) throw failure; // a runner fault, not a model outcome: fail the run loudly
    error = { kind, message: failure instanceof Error ? failure.message : String(failure) };
    if (foreignWrites.length > 0 || ctx.slot.erpCalled) {
      base.runnerErrors.push(
        `errored question had side effects (${[...foreignWrites, ...(ctx.slot.erpCalled ? ["erp"] : [])].join(", ")})`,
      );
    }
  }

  const withheldRow = res
    ? await sql<{ content: { withheldAnswer?: string | null } }[]>`
        select content from messages where id = ${res.messageId}`
    : [];
  const transcript: QaTranscript = {
    id: truth.id,
    question: truth.question,
    mode: ctx.mode,
    answer: res?.answer ?? null,
    withheldAnswer: withheldRow[0]?.content.withheldAnswer ?? null,
    error: error?.message ?? null,
    gate: res?.gate ?? null,
    facts: res?.facts ?? [],
    toolCalls: toolMessages.filter((m) => m.role === "tool").map((m) => m.content),
    recommendations: recs,
    grade,
    exchanges: [...ctx.exchanges],
  };
  return { row: { ...base, grade, error }, transcript };
}

/** The oracle and empty answerers: an outcome from the truth alone, no database, no network. */
function runFixed(
  truth: QaTruth,
  kind: "oracle" | "empty",
): { row: QaRow; transcript: QaTranscript } {
  const outcome = kind === "oracle" ? oracleOutcome(truth) : emptyOutcome();
  const grade = gradeQa(truth, outcome);
  return {
    row: {
      id: truth.id,
      category: truth.tags[0] ?? "",
      grade,
      error: null,
      latencyMs: 0,
      firstProgressMs: null,
      costUsd: 0,
      models: [],
      foreignWrites: [],
      llmLatencyMs: 0,
      calls: 0,
      callsFromRecordings: 0,
      runnerErrors: [],
    },
    transcript: {
      id: truth.id,
      question: truth.question,
      mode: kind,
      answer: outcome.answer,
      withheldAnswer: null,
      error: null,
      gate: outcome.gate,
      facts: outcome.ledger,
      toolCalls: [],
      recommendations: outcome.recommendations,
      grade,
      exchanges: [],
    },
  };
}

// ---------- the run ----------

export interface EvalOptions {
  /** Required for the llm answerer; the oracle and empty ones never touch it. */
  sql?: Sql | null;
  split: SplitName;
  mode: LlmMode;
  answerer: AnswererKind;
  label: string;
  limit?: number | null;
  offset?: number;
  ids?: string[];
  final?: boolean;
  reportsDir: string;
  goldenDir?: string;
  recordingsDir?: string;
  apiKey?: string | undefined;
  /** The network transport for live and record (tests inject one). */
  fetch?: LlmFetch;
  ledgerPath?: string;
  budgetPath?: string;
  /**
   * The held-out passes file. Used only by a final live held-out pass of the model; with no path
   * the guard is off. Only the CLI `main()` passes `HELDOUT_PASSES_PATH`; tests use temp files.
   */
  passesPath?: string;
  now?: () => Date;
  log?: (line: string) => void;
  signals?: SignalSource;
  exit?: (code: number) => void;
}

export interface EvalResult {
  reportDir: string;
  meta: QaScorecardMeta;
  scorecard: QaScorecard;
  rows: QaRow[];
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

export async function runQaEval(opts: EvalOptions): Promise<EvalResult> {
  assertSplitAllowed(opts.split, opts.final ?? false);
  assertFinalMode(opts.final ?? false, opts.mode);
  const llm = opts.answerer === "llm";
  const paid = llm && opts.mode !== "replay";
  const now = opts.now ?? (() => new Date());
  const goldenDir = opts.goldenDir ?? QA_GOLDEN_DIR;
  const ids = await selectQuestions(opts.split, {
    ids: opts.ids,
    limit: opts.limit,
    offset: opts.offset,
    goldenDir,
  });
  // A held-out question runs once: before any call, ledger row or report, refuse a final live
  // pass that selects a question already in the passes file.
  const passesPath = heldoutPassesPath({ ...opts, model: llm });
  assertPassLabel(passesPath, opts.label);
  if (passesPath !== null) assertNotRun("qa", ids, passesPath);
  const order = await splitOrder(opts.split, goldenDir);
  const truths = await Promise.all(ids.map((id) => loadTruth(goldenDir, id)));
  if (llm && !opts.sql) throw new Error("the llm answerer needs a database");

  if (llm) assertHaikuOnly([QA_AGENT_CONFIG.agentModel]);
  let guard: SpendGuard | null = null;
  if (paid) {
    const estimate = truths.length * ESTIMATE_PER_QUESTION_USD;
    if (estimate > RUN_CAP_USD) {
      throw new BudgetError(
        `estimate $${estimate.toFixed(3)} (${truths.length} questions x $${ESTIMATE_PER_QUESTION_USD}) exceeds the $${RUN_CAP_USD.toFixed(2)} per-pass cap: run the split in chunks with --offset and --limit (each chunk is its own pass)`,
      );
    }
    if (!opts.apiKey) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env).");
    assertBudget(estimate, opts.ledgerPath, undefined, opts.budgetPath);
    const { remainingUsd } = budgetRemaining(opts.ledgerPath, undefined, opts.budgetPath);
    guard = createSpendGuard({
      capUsd: Math.min(RUN_CAP_USD, remainingUsd),
      label: "run",
      allowedModel: HAIKU,
    });
  }

  // From here a paid run may spend. Its cost is ledgered exactly once: at the end, in the
  // `finally`, or by the interrupt handler, whichever comes first.
  const inflight = { n: 0 };
  let appended: number | null = null;
  const settle = () => {
    if (!paid || !guard || appended !== null) return;
    const costUsd = guard.spentUsd() + inflight.n * ESTIMATE_PER_QUESTION_USD;
    appendSpend(
      { at: now().toISOString(), run: LEDGER_RUN, label: opts.label, costUsd },
      opts.ledgerPath,
      opts.budgetPath,
    );
    appended = costUsd;
  };
  const state = {
    interrupted: null as string | null,
    writePartial: null as ((r: string) => void) | null,
  };
  const signals = opts.signals ?? process;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const onSignal = (signal: InterruptSignal) => () => {
    const reason = `interrupted by ${signal}`;
    state.interrupted = reason;
    try {
      settle();
    } catch (err) {
      console.error(`[eval] ${reason}: could not ledger the spend: ${(err as Error).message}`);
    }
    try {
      state.writePartial?.(reason);
    } catch (err) {
      console.error(`[eval] ${reason}: could not write the report: ${(err as Error).message}`);
    }
    exit(INTERRUPT_EXIT);
  };
  const handlers = INTERRUPT_SIGNALS.map((s) => [s, onSignal(s)] as const);
  for (const [s, h] of handlers) signals.once(s, h);

  const log = opts.log ?? ((l: string) => console.log(l));
  try {
    const body = () =>
      runPlan({ ...opts, goldenDir }, truths, {
        guard,
        inflight,
        now,
        log,
        state,
        ledgered: () => appended,
        settle,
        passesPath,
        order,
      });
    return llm && opts.sql ? await withRunLock(opts.sql, body) : await body();
  } finally {
    for (const [s, h] of handlers) signals.off(s, h);
    settle();
  }
}

interface PlanContext {
  guard: SpendGuard | null;
  inflight: { n: number };
  now: () => Date;
  log: (l: string) => void;
  state: { interrupted: string | null; writePartial: ((r: string) => void) | null };
  ledgered: () => number | null;
  settle: () => void;
  /** The held-out passes file this run appends to, or null (see `heldoutPassesPath`). */
  passesPath: string | null;
  /** The split's ids in split.json order (`resumeHint`). */
  order: readonly string[];
}

async function runPlan(
  opts: EvalOptions,
  truths: QaTruth[],
  run: PlanContext,
): Promise<EvalResult> {
  const { guard, now, log } = run;
  const startedAt = now();
  const llm = opts.answerer === "llm";
  const recordingsDir = opts.recordingsDir ?? DEFAULT_RECORDINGS_DIR;
  const reportDir = await createReportDir(
    opts.reportsDir,
    `${stamp(startedAt)}-qa-${opts.split}-${opts.label}`,
  );
  const file = (name: string) => join(reportDir, name);
  writeFileSync(file("rows.jsonl"), "");
  writeFileSync(file("transcripts.jsonl"), "");

  const exchanges: Exchange[] = [];
  const slot = { erpCalled: false };
  let client: QuestionContext["llm"] = null;
  if (llm) {
    const network: LlmFetch =
      opts.mode === "replay"
        ? async () => {
            throw new Error("replay mode attempted a network request");
          }
        : (opts.fetch ?? ((input, init) => fetch(input, init)));
    const tapped = capturing(network, exchanges);
    const guarded = guard ? guard.wrap(tapped, HAIKU) : tapped;
    const counted: LlmFetch = async (input, init) => {
      run.inflight.n++;
      try {
        return await guarded(input, init);
      } finally {
        run.inflight.n--;
      }
    };
    client = createLlm({
      mode: opts.mode,
      apiKey: opts.apiKey,
      recordingsDir,
      onCall: captureLlmCall,
      fetch: counted,
    });
  }
  const mode = llm ? opts.mode : opts.answerer;
  const rows: QaRow[] = [];
  const remaining = () => truths.slice(rows.length).map((t) => t.id);

  const writeScorecard = (aborted: string | null, notRun: string[]) => {
    const card = qaScorecard(rows);
    const fromRows = metaOfQaRows(rows);
    const meta: QaScorecardMeta = {
      suite: "qa",
      split: opts.split,
      label: opts.label,
      mode,
      model: llm ? QA_AGENT_CONFIG.agentModel : null,
      effort: llm ? QA_AGENT_CONFIG.agentEffort : null,
      fallbacks: llm ? QA_AGENT_CONFIG.llmFallbacks : null,
      promptVersion: llm ? PROMPT_VERSION : null,
      seed: EVAL_SEED,
      anchor: EVAL_ANCHOR.toISOString(),
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      selected: truths.length,
      offset: opts.ids ? 0 : (opts.offset ?? 0),
      limit: opts.ids ? null : (opts.limit ?? null),
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
    writeFileSync(file("scorecard.md"), `${renderQaScorecardMd(card, meta)}\n`);
    return { card, meta };
  };
  /** The line every stop, abort and fault logs: what stopped the pass and where it resumes. */
  const stopLine = (reason: string, rest: readonly string[]) =>
    `[eval] stopped before ${rest[0] ?? "(none)"}: ${reason}; ${resumeHint(run.order, rest)}`;
  run.state.writePartial = (aborted) => {
    const rest = remaining();
    writeScorecard(aborted, rest);
    log(stopLine(aborted, rest));
  };

  let aborted: string | null = null;
  let notRun: string[] = [];
  /** Set by an armed pass's API-error row (Ruling P17); checked after the spend guard. */
  let outage: string | null = null;
  for (const truth of truths) {
    const overCap = guard?.overCap() ?? null;
    const trip = guard?.trip() ?? null;
    const stop =
      run.state.interrupted ??
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
    let row: QaRow;
    try {
      const result: { row: QaRow; transcript: QaTranscript } = llm
        ? await runQuestion(
            { sql: opts.sql as Sql, guard, exchanges, llm: client, mode, slot },
            truth,
          )
        : runFixed(truth, opts.answerer as "oracle" | "empty");
      row = result.row;
      // The pass row first: once it is written the question is consumed (it never runs again), even
      // if a write below fails. A failed pass-row write stops the run before the question has a row.
      if (run.passesPath !== null) {
        appendPass(
          {
            suite: "qa",
            id: row.id,
            run: 1,
            at: now().toISOString(),
            label: opts.label,
            report: basename(reportDir),
            outcome: passOutcome(row.error?.kind ?? null),
          },
          run.passesPath,
        );
      }
      appendFileSync(file("rows.jsonl"), `${JSON.stringify(row)}\n`);
      rows.push(row);
      appendFileSync(file("transcripts.jsonl"), `${JSON.stringify(result.transcript)}\n`);
      // A kill with no handler still leaves a mergeable report; the end-of-run write replaces it.
      writeScorecard(DID_NOT_FINISH, remaining());
    } catch (err) {
      // A runner fault (not a model outcome) fails the run. The report so far gets its scorecard
      // first, so the questions not run can run once more and the reports be merged.
      const reason = `runner fault: ${err instanceof Error ? err.message : String(err)}`;
      writeFaultReport(run, () => writeScorecard(reason, remaining()), reason);
      log(stopLine(reason, remaining()));
      throw err;
    }
    log(
      `[eval] ${row.id}: ${row.error ? `error ${row.error.kind}` : row.grade?.withheld ? "withheld" : "answered"} ${(row.latencyMs / 1000).toFixed(1)}s $${row.costUsd.toFixed(5)}`,
    );
    if (run.passesPath !== null && row.error?.kind === "api_error") outage = apiErrorStop(row.id);
  }
  run.settle();
  const { card, meta } = writeScorecard(aborted, notRun);
  log(`[eval] report: ${reportDir}`);

  // A call served (or requested) by any model but Haiku fails the run; the report says where.
  if (llm) assertHaikuOnly([...meta.servedModels, ...(guard?.served ?? [])]);
  if (meta.spend.parseErrors.length > 0) {
    throw new Error(
      `the spend guard could not read ${meta.spend.parseErrors.length} response bodies, so their cost is not counted: ${meta.spend.parseErrors.join("; ")}`,
    );
  }
  if (meta.runnerErrors.length > 0) {
    throw new Error(`${meta.runnerErrors.length} runner error(s): ${meta.runnerErrors.join("; ")}`);
  }
  return { reportDir, meta, scorecard: card, rows };
}

// ---------- CLI ----------

const fmt = (r: { k: number; n: number; rate: number | null }) =>
  `${r.k}/${r.n}${r.rate === null ? "" : ` (${(r.rate * 100).toFixed(1)} %)`}`;

/** Entry point of `npm run eval -- --suite qa ...` (called by evals/run.ts). */
export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const paid = args.answerer === "llm" && args.mode !== "replay";
  const apiKey = paid ? requireApiKey(process.env) : undefined;
  const sql = args.answerer === "llm" ? await connectTestDb(EVAL_DB) : null;
  if (args.answerer === "llm" && !sql) {
    throw new Error("Postgres is unreachable (start it with docker compose up -d db).");
  }
  try {
    const { scorecard: card, meta } = await runQaEval({
      sql,
      split: args.split,
      mode: args.mode,
      answerer: args.answerer,
      label: args.label,
      limit: args.limit,
      offset: args.offset,
      final: args.final,
      apiKey,
      reportsDir: resolve(REPO_ROOT, "evals", "reports"),
      // The only place the tracked passes file is named (a final live held-out pass uses it).
      passesPath: HELDOUT_PASSES_PATH,
    });
    console.log(`answer accuracy ${fmt(card.answerAccuracy)}`);
    console.log(`grounded numbers ${fmt(card.grounded)}`);
    console.log(
      `abstention ${fmt(card.abstention)}; injection ${fmt(card.injection)}; no-action ${fmt(card.noAction)}`,
    );
    console.log(`proposed = best ${fmt(card.proposedBest)}`);
    console.log(`unauthorised actions ${fmt(card.unauthorised)}`);
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
      const order = await splitOrder(args.split, QA_GOLDEN_DIR);
      console.error(`[eval] stopped early: ${meta.aborted}; ${resumeHint(order, meta.notRun)}`);
      process.exitCode = 1;
    }
  } finally {
    await sql?.end();
  }
}
