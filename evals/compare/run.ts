/**
 * Live agent-model comparison: the ops agent on harder questions across several models.
 *
 *   npm run eval:compare -- [--models a,b,c] [--questions q1,q2] [--label name]
 *
 * Runs in-process against a fresh test database per model (seed 20261114, anchor
 * 2026-11-14T08:00:00Z, the two demo quotes), asking through the same route POST /api/ask uses.
 * The key arrives via `tsx --env-file=.env` and is never read, printed or logged here.
 *
 * Everything measured comes from the response and the database: gate outcome, latency, llm_calls
 * tokens and cost, stored tool calls, facts, recommendations. No model judges anything and no
 * accuracy score is computed (CLAUDE.md rule 5); answer quality is for human review.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Sql } from "@pharos/db";
import { connectTestDb } from "@pharos/db/testing";
import { AskResponse } from "@pharos/shared";
import type { AgentConfig } from "../../apps/api/src/ai/agent.js";
import { captureLlmCall } from "../../apps/api/src/ai/call-capture.js";
import { createLlm, type LlmFetch } from "../../apps/api/src/ai/llm.js";
import { costUsd } from "../../apps/api/src/ai/pricing.js";
import { createApp } from "../../apps/api/src/app.js";
import { prepareAskFixture } from "../../apps/api/src/ask/demo-fixture.js";
import { DEFAULT_RECORDINGS_DIR } from "../../apps/api/src/config.js";
import { createDbSource } from "../../apps/api/src/read/db-source.js";
import { FIXTURE_ANCHOR, FIXTURE_SEED } from "../../apps/api/src/read/fixtures.js";
import {
  appendSpend,
  assertBudget,
  assertHaikuOnly,
  createSpendGuard,
  HAIKU,
} from "../lib/budget.js";
import { type CompareQuestion, QUESTIONS } from "./questions.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Haiku 5.5 only: Phase 3 refuses every other model (`assertHaikuOnly`). */
export const DEFAULT_MODELS = [HAIKU];
export const MODEL_CAP_USD = 1.0;
export const TOTAL_CAP_USD = 2.0;
export const AGENT_EFFORT = "medium" as const;

export type Outcome = "answered" | "repaired" | "withheld" | "error" | "skipped";

export interface CallRow {
  id: number;
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

export interface RecommendationRow {
  id: number;
  optionId: string;
  calculationId: number;
  bestOptionId: string | null;
  /** True/false when the calculation records a best option; null when it does not. */
  equalsBest: boolean | null;
}

export interface ToolCallRow {
  tool: string;
  isError: boolean;
}

export interface PairResult {
  model: string;
  questionId: string;
  outcome: Outcome;
  /** Why an error or skip: API/agent error message, or the cap/dependency that skipped it. */
  detail: string | null;
  /** Kind of error: api_error, refusal, truncation, iteration_limit, agent_failed, http_<n>. */
  errorKind: string | null;
  latencyMs: number;
  calls: CallRow[];
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Models that actually served this ask's calls, and whether all match the requested model. */
  servedModels: string[];
  servedModelOk: boolean;
  /** Set when a response body could not be read for its model or usage at the transport. */
  servedModelParseError: string | null;
  tools: ToolCallRow[];
  factCount: number;
  citedFactCount: number;
  recommendations: RecommendationRow[];
  gate: { passed: boolean; repaired: boolean; ungroundedNumbers: string[] } | null;
  conversationId: number | null;
  /** The released answer; null when withheld, errored or skipped. */
  answer: string | null;
  /** For withheld answers: the stored text the gate blocked. */
  withheldAnswer: string | null;
  ungroundedNumbers: string[];
}

export interface StopRecord {
  scope: "model" | "run";
  model: string | null;
  reason: string;
}

export interface ModelSummary {
  answered: number;
  repaired: number;
  withheld: number;
  error: number;
  skipped: number;
  totalLatencyMs: number;
  meanLatencyMs: number | null;
  totalTokens: number;
  costUsd: number;
  /** costUsd / (answered + repaired); null when nothing was released. */
  costPerAnswered: number | null;
}

export interface ModelReport {
  model: string;
  estimateUsd: number;
  summary: ModelSummary;
  stoppedReason: string | null;
  /** Cost the per-request guard summed from response usage; the DB figure (summary) is reported. */
  guardCostUsd: number;
  results: PairResult[];
}

export interface CompareReport {
  label: string;
  startedAt: string;
  finishedAt: string;
  note: string;
  config: {
    seed: number;
    anchor: string;
    agentEffort: string;
    llmFallbacks: false;
    modelCapUsd: number;
    totalCapUsd: number;
    models: string[];
    questions: CompareQuestion[];
  };
  stops: StopRecord[];
  /** Places where the per-request guard's cost and the DB cost differ (empty when they agree). */
  guardDisagreements: string[];
  totalCostUsd: number;
  models: ModelReport[];
}

export const NO_SCORE_NOTE =
  "No accuracy score is computed. The outcomes below are release-gate and tool facts read from " +
  "the database and the API response; answer quality is for human review (CLAUDE.md rule 5).";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/** Classifies an ask from the gate result alone (or its absence on an error). */
export function classifyOutcome(
  gate: { passed: boolean; repaired: boolean } | null,
): Exclude<Outcome, "skipped"> {
  if (gate === null) return "error";
  if (!gate.passed) return "withheld";
  return gate.repaired ? "repaired" : "answered";
}

/** What kind of failure an error response is, from the JSON the route returns. */
export function classifyError(status: number, body: unknown): { kind: string; message: string } {
  const o = (body !== null && typeof body === "object" ? body : {}) as {
    error?: unknown;
    message?: unknown;
  };
  const message = typeof o.message === "string" ? o.message : `HTTP ${status}`;
  if (o.error === "llm_unavailable") return { kind: "api_error", message };
  if (o.error === "agent_failed") {
    if (message.includes("stop_reason refusal")) return { kind: "refusal", message };
    if (message.includes("max_tokens")) return { kind: "truncation", message };
    if (message.includes("did not finish")) return { kind: "iteration_limit", message };
    return { kind: "agent_failed", message };
  }
  return { kind: `http_${status}`, message };
}

/** Rough pre-run estimate per model: an assumed call profile priced with the real rate table. */
export const ESTIMATE_PROFILE = {
  callsPerQuestion: 4,
  inputTokensPerCall: 5000,
  outputTokensPerCall: 1200,
} as const;

export function estimateModelUsd(model: string, questionCount: number): number {
  const p = ESTIMATE_PROFILE;
  const perCall = costUsd(
    model,
    { input_tokens: p.inputTokensPerCall, output_tokens: p.outputTokensPerCall },
    p.inputTokensPerCall,
  );
  return perCall * p.callsPerQuestion * questionCount;
}

/** The runner needs the key in the environment; says which variable, never its value. */
export function requireApiKey(env: Record<string, string | undefined>): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env).");
  return key;
}

export function summarise(results: PairResult[]): ModelSummary {
  const measured = results.filter((r) => r.outcome !== "skipped");
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const costTotal = sum(results.map((r) => r.costUsd));
  const released = count("answered") + count("repaired");
  const totalLatencyMs = sum(measured.map((r) => r.latencyMs));
  return {
    answered: count("answered"),
    repaired: count("repaired"),
    withheld: count("withheld"),
    error: count("error"),
    skipped: count("skipped"),
    totalLatencyMs,
    meanLatencyMs: measured.length > 0 ? totalLatencyMs / measured.length : null,
    totalTokens: sum(
      results.map((r) => r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens),
    ),
    costUsd: costTotal,
    costPerAnswered: released > 0 ? costTotal / released : null,
  };
}

/** The question ids to run: the selection plus any question it follows up. Order as in `all`. */
export function selectQuestions(
  all: CompareQuestion[],
  wanted: string[] | null,
): { questions: CompareQuestion[]; added: string[] } {
  if (wanted === null) return { questions: all, added: [] };
  for (const id of wanted) {
    if (!all.some((q) => q.id === id)) throw new Error(`unknown question id "${id}"`);
  }
  const ids = new Set(wanted);
  const added: string[] = [];
  for (const q of all) {
    if (ids.has(q.id) && q.followUpOf && !ids.has(q.followUpOf)) {
      ids.add(q.followUpOf);
      added.push(q.followUpOf);
    }
  }
  return { questions: all.filter((q) => ids.has(q.id)), added };
}

type JsonRow = Record<string, unknown>;

async function maxId(sql: Sql, table: "llm_calls" | "messages" | "recommendations") {
  const [row] = await sql<
    { m: number }[]
  >`select coalesce(max(id), 0)::int as m from ${sql(table)}`;
  return row?.m ?? 0;
}

const emptyResult = (model: string, questionId: string): PairResult => ({
  model,
  questionId,
  outcome: "skipped",
  detail: null,
  errorKind: null,
  latencyMs: 0,
  calls: [],
  llmCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  servedModels: [],
  servedModelOk: true,
  servedModelParseError: null,
  tools: [],
  factCount: 0,
  citedFactCount: 0,
  recommendations: [],
  gate: null,
  conversationId: null,
  answer: null,
  withheldAnswer: null,
  ungroundedNumbers: [],
});

export interface CompareOptions {
  sql: Sql;
  apiKey: string;
  models: string[];
  questions: CompareQuestion[];
  label: string;
  reportsDir: string;
  /** Injected transport for tests; live runs use the global fetch. */
  fetch?: LlmFetch;
  modelCapUsd?: number;
  totalCapUsd?: number;
  /** Phase 3 spend ledger: budget check before the run, cost appended after. Omit in dry tests. */
  ledger?: { path?: string };
  now?: () => Date;
  log?: (line: string) => void;
}

/** What the transport saw while an ask ran: served models, unreadable bodies, blocked requests. */
export interface TransportProbe {
  served: string[];
  parseErrors: string[];
  blocked: string[];
}

export interface Transcript {
  model: string;
  questionId: string;
  messages: { id: number; role: string; content: unknown }[];
}

/** Measures one ask from the DB and the response only. */
async function askOne(
  sql: Sql,
  app: ReturnType<typeof createApp>,
  model: string,
  q: CompareQuestion,
  conversationId: number | null,
  transcripts: Transcript[],
  probe: TransportProbe,
): Promise<PairResult> {
  const servedMark = probe.served.length;
  const parseMark = probe.parseErrors.length;
  const blockedMark = probe.blocked.length;
  const callMark = await maxId(sql, "llm_calls");
  const msgMark = await maxId(sql, "messages");
  const recMark = await maxId(sql, "recommendations");
  const result = emptyResult(model, q.id);

  const t0 = performance.now();
  let status = 0;
  let body: unknown = null;
  let thrown: string | null = null;
  try {
    const res = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q.text, conversationId }),
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (err) {
    thrown = (err as Error).message;
  }
  result.latencyMs = performance.now() - t0;

  // Calls made by this ask, also when it failed: the database is private to this run and the asks
  // are sequential, so every row past the watermark is this ask's.
  const calls = await sql<JsonRow[]>`
    select id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           latency_ms, cost_usd, stop_reason
    from llm_calls where id > ${callMark} order by id`;
  result.calls = calls.map((c) => ({
    id: c.id as number,
    model: c.model as string,
    mode: c.mode as string,
    inputTokens: c.input_tokens as number,
    outputTokens: c.output_tokens as number,
    cacheReadTokens: c.cache_read_tokens as number,
    cacheWriteTokens: c.cache_write_tokens as number,
    latencyMs: c.latency_ms as number,
    costUsd: c.cost_usd as number,
    stopReason: (c.stop_reason as string | null) ?? null,
  }));
  result.llmCalls = result.calls.length;
  result.inputTokens = sum(result.calls.map((c) => c.inputTokens));
  result.outputTokens = sum(result.calls.map((c) => c.outputTokens));
  result.cacheReadTokens = sum(result.calls.map((c) => c.cacheReadTokens));
  result.cacheWriteTokens = sum(result.calls.map((c) => c.cacheWriteTokens));
  result.costUsd = sum(result.calls.map((c) => c.costUsd));
  // llm_calls stores the model that was requested; the model that served each call is the one the
  // response names, captured at the transport.
  result.servedModels = [...new Set(probe.served.slice(servedMark))].sort();
  result.servedModelOk =
    result.servedModels.length > 0 &&
    result.servedModels.every((m) => m === model || m.startsWith(`${model}-`));

  result.servedModelParseError = probe.parseErrors.slice(parseMark).join("; ") || null;

  const stored = await sql<{ id: number; role: string; content: JsonRow | null }[]>`
    select id, role, content from messages where id > ${msgMark} order by id`;
  transcripts.push({
    model,
    questionId: q.id,
    messages: stored.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  });
  result.tools = stored
    .filter((m) => m.role === "tool")
    .map((m) => ({
      tool: String(m.content?.tool ?? "?"),
      isError: m.content?.isError === true,
    }));
  const convs = await sql<{ conversation_id: number }[]>`
    select conversation_id from messages where id > ${msgMark} order by id limit 1`;
  result.conversationId = convs[0]?.conversation_id ?? null;

  const recs = await sql<
    { id: number; option_id: string; calculation_id: number; best: string | null }[]
  >`select r.id, r.option_id, r.calculation_id, c.outputs->>'bestOptionId' as best
    from recommendations r join calculations c on c.id = r.calculation_id
    where r.id > ${recMark} order by r.id`;
  result.recommendations = recs.map((r) => ({
    id: r.id,
    optionId: r.option_id,
    calculationId: r.calculation_id,
    bestOptionId: r.best,
    equalsBest: r.best === null ? null : r.option_id === r.best,
  }));

  const parsed = status === 200 ? AskResponse.safeParse(body) : null;
  if (parsed?.success) {
    const ans = parsed.data;
    result.outcome = classifyOutcome(ans.gate);
    result.gate = ans.gate;
    result.factCount = ans.facts.length;
    result.answer = ans.answer;
    result.conversationId = ans.conversationId;
    result.ungroundedNumbers = ans.gate.ungroundedNumbers;
    const [msg] = await sql<{ content: JsonRow | null }[]>`
      select content from messages where id = ${ans.messageId}`;
    const cited = msg?.content?.citedFactIds;
    result.citedFactCount = Array.isArray(cited) ? new Set(cited as string[]).size : 0;
    const withheld = msg?.content?.withheldAnswer;
    result.withheldAnswer = typeof withheld === "string" ? withheld : null;
  } else {
    result.outcome = "error";
    if (thrown !== null) {
      result.errorKind = "exception";
      result.detail = thrown;
    } else if (parsed && !parsed.success) {
      result.errorKind = "bad_response";
      result.detail = `response did not match AskResponse: ${parsed.error.message}`;
    } else {
      const e = classifyError(status, body);
      result.errorKind = e.kind;
      result.detail = e.message;
      const blocked = probe.blocked.slice(blockedMark);
      if (blocked.length > 0) {
        result.errorKind = "spend_cap";
        result.detail = `stopped: cap. ${blocked[0]}`;
      }
    }
  }
  return result;
}

/**
 * Runs the comparison. With `opts.ledger` it first checks the Phase 3 budget against the estimate
 * and afterwards appends the cost the guard saw (also when the run throws part way).
 */
export async function runCompare(
  opts: CompareOptions,
): Promise<{ report: CompareReport; reportDir: string }> {
  const tally = { usd: 0 };
  assertHaikuOnly(opts.models);
  if (opts.ledger) {
    assertBudget(
      sum(opts.models.map((m) => estimateModelUsd(m, opts.questions.length))),
      opts.ledger.path,
    );
  }
  try {
    return await runCompareCore(opts, tally);
  } finally {
    if (opts.ledger && tally.usd > 0) {
      appendSpend(
        {
          at: (opts.now ?? (() => new Date()))().toISOString(),
          run: "compare",
          label: opts.label,
          costUsd: tally.usd,
        },
        opts.ledger.path,
      );
    }
  }
}

async function runCompareCore(
  opts: CompareOptions,
  tally: { usd: number },
): Promise<{ report: CompareReport; reportDir: string }> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((l: string) => console.log(l));
  const modelCap = opts.modelCapUsd ?? MODEL_CAP_USD;
  const totalCap = opts.totalCapUsd ?? TOTAL_CAP_USD;
  const startedAt = now();
  const { sql } = opts;

  const estimates = opts.models.map((m) => ({
    model: m,
    usd: estimateModelUsd(m, opts.questions.length),
  }));
  log("Estimate (assumed profile, not a quote):");
  for (const e of estimates) log(`  ${e.model}: about $${e.usd.toFixed(2)}`);
  log(
    `  total about $${sum(estimates.map((e) => e.usd)).toFixed(2)}; caps $${modelCap.toFixed(2)} per model, $${totalCap.toFixed(2)} per run`,
  );

  const stops: StopRecord[] = [];
  const modelReports: ModelReport[] = [];
  const transcripts: Transcript[] = [];
  let runCost = 0;
  let guardRunCost = 0;
  const guardDisagreements: string[] = [];
  let runStopped = false;

  for (const model of opts.models) {
    const results: PairResult[] = [];
    let stoppedReason: string | null = null;
    const byQuestion = new Map<string, PairResult>();

    if (runStopped) {
      stoppedReason = "run stopped: total cost cap exceeded";
    } else {
      await prepareAskFixture(opts.sql);
    }
    const config: AgentConfig = {
      agentModel: model,
      agentEffort: AGENT_EFFORT,
      llmFallbacks: false,
    };
    // The transport reports the model each response names, so the served model can be asserted.
    // It also sums each response's cost from its usage and, once a cap is crossed, refuses the next
    // request without touching the network, so one long ask overruns by at most one request.
    const guard = createSpendGuard({
      capUsd: modelCap,
      label: "model",
      onRequest: () =>
        guardRunCost > totalCap
          ? `per-request guard: run cost $${guardRunCost.toFixed(4)} > $${totalCap.toFixed(2)}`
          : null,
      onCost: (c) => {
        guardRunCost += c;
        tally.usd += c;
      },
    });
    const probe: TransportProbe = guard;
    const transport = guard.wrap(opts.fetch ?? ((url, init) => fetch(url, init)), model);
    const llm = createLlm({
      mode: "live",
      apiKey: opts.apiKey,
      recordingsDir: DEFAULT_RECORDINGS_DIR,
      onCall: captureLlmCall,
      fetch: transport,
    });
    const app = createApp({
      llmMode: "live",
      pingDb: async () => true,
      read: createDbSource(sql),
      ask: { sql, llm, config, now: () => FIXTURE_ANCHOR },
    });

    let modelCost = 0;
    /** Records the first cap crossed (per-request guard or database cost) as this model's stop. */
    const checkCaps = () => {
      if (stoppedReason !== null) return;
      const trip = guard.trip();
      if (trip?.source === "own" || modelCost > modelCap) {
        stoppedReason =
          trip?.source === "own"
            ? `model cost cap exceeded, stopped: cap (${trip.reason})`
            : `model cost cap exceeded ($${modelCost.toFixed(4)} > $${modelCap.toFixed(2)})`;
        stops.push({ scope: "model", model, reason: stoppedReason });
      } else if (trip?.source === "outer" || runCost > totalCap) {
        runStopped = true;
        stoppedReason =
          trip?.source === "outer"
            ? `run cost cap exceeded, stopped: cap (${trip.reason})`
            : `run cost cap exceeded ($${runCost.toFixed(4)} > $${totalCap.toFixed(2)})`;
        stops.push({ scope: "run", model, reason: stoppedReason });
      }
    };
    for (const q of opts.questions) {
      checkCaps();
      if (stoppedReason !== null) {
        const r = emptyResult(model, q.id);
        r.detail = stoppedReason;
        results.push(r);
        byQuestion.set(q.id, r);
        continue;
      }
      let conversationId: number | null = null;
      if (q.followUpOf) {
        const parent = byQuestion.get(q.followUpOf);
        if (!parent || parent.conversationId === null || parent.outcome === "skipped") {
          const r = emptyResult(model, q.id);
          r.detail = `needs a conversation from ${q.followUpOf}, which has none`;
          results.push(r);
          byQuestion.set(q.id, r);
          continue;
        }
        conversationId = parent.conversationId;
      }
      log(`[${model}] ${q.id} ...`);
      const r = await askOne(sql, app, model, q, conversationId, transcripts, probe);
      modelCost += r.costUsd;
      runCost += r.costUsd;
      log(
        `[${model}] ${q.id}: ${r.outcome} ${(r.latencyMs / 1000).toFixed(1)}s $${r.costUsd.toFixed(4)}`,
      );
      results.push(r);
      byQuestion.set(q.id, r);
    }
    // A cap crossed by the last question still counts as a stop for this model.
    checkCaps();
    if (Math.abs(guard.spentUsd() - modelCost) > 1e-9) {
      guardDisagreements.push(
        `${model}: guard summed $${guard.spentUsd().toFixed(6)} from response usage, the database $${modelCost.toFixed(6)}`,
      );
    }
    modelReports.push({
      model,
      estimateUsd: estimates.find((e) => e.model === model)?.usd ?? 0,
      summary: summarise(results),
      stoppedReason,
      guardCostUsd: guard.spentUsd(),
      results,
    });
  }

  const finishedAt = now();
  const report: CompareReport = {
    label: opts.label,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    note: NO_SCORE_NOTE,
    config: {
      seed: FIXTURE_SEED,
      anchor: FIXTURE_ANCHOR.toISOString(),
      agentEffort: AGENT_EFFORT,
      llmFallbacks: false,
      modelCapUsd: modelCap,
      totalCapUsd: totalCap,
      models: opts.models,
      questions: opts.questions,
    },
    stops,
    guardDisagreements,
    totalCostUsd: runCost,
    models: modelReports,
  };
  const reportDir = join(opts.reportsDir, `${stamp(startedAt)}-agent-compare-${opts.label}`);
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(reportDir, "transcripts.json"), `${JSON.stringify(transcripts, null, 2)}\n`);
  await writeFile(join(reportDir, "report.md"), renderMarkdown(report));
  log(`report: ${reportDir}`);
  // A response served by another model fails the run (the report above records which and where).
  assertHaikuOnly(modelReports.flatMap((m) => m.results.flatMap((r) => r.servedModels)));
  return { report, reportDir };
}

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const usd = (n: number | null) => (n === null ? "-" : `$${n.toFixed(4)}`);

function pairCell(r: PairResult | undefined): string {
  if (!r) return "-";
  if (r.outcome === "skipped") return cell(`skipped (${r.detail ?? "not run"})`);
  const parts: string[] = [r.outcome];
  if (r.outcome === "error") parts.push(`${r.errorKind}: ${r.detail ?? ""}`);
  parts.push(secs(r.latencyMs), usd(r.costUsd));
  parts.push(
    `tools: ${r.tools.map((t) => (t.isError ? `${t.tool}(error)` : t.tool)).join(", ") || "none"}`,
  );
  parts.push(`facts ${r.citedFactCount}/${r.factCount} cited`);
  if (r.recommendations.length === 0) parts.push("no proposal");
  else {
    parts.push(
      r.recommendations
        .map(
          (x) =>
            `proposed ${x.optionId} (${x.equalsBest === null ? "best unknown" : x.equalsBest ? "= best" : `best is ${x.bestOptionId}`})`,
        )
        .join("; "),
    );
  }
  if (r.servedModelParseError) parts.push(`served-model parse error: ${r.servedModelParseError}`);
  if (!r.servedModelOk) parts.push(`SERVED MODEL MISMATCH: ${r.servedModels.join(", ")}`);
  return cell(parts.join("; "));
}

export function renderMarkdown(r: CompareReport): string {
  const out: string[] = [];
  out.push(`# Agent model comparison: ${r.label}`, "");
  out.push(`- Started: ${r.startedAt}`, `- Finished: ${r.finishedAt}`);
  out.push(
    `- World: seed ${r.config.seed}, anchor ${r.config.anchor}, agent effort ${r.config.agentEffort}, fallbacks off`,
  );
  out.push(`- Models: ${r.config.models.join(", ")}`);
  out.push(
    `- Caps: $${r.config.modelCapUsd.toFixed(2)} per model, $${r.config.totalCapUsd.toFixed(2)} per run; total spent ${usd(r.totalCostUsd)}`,
  );
  out.push("", `**${r.note}**`, "");
  if (r.stops.length > 0) {
    out.push("## Stops", "");
    for (const s of r.stops) out.push(`- ${s.scope}${s.model ? ` (${s.model})` : ""}: ${s.reason}`);
    out.push("");
  }

  out.push(
    r.guardDisagreements.length === 0
      ? "Spend guard: its per-request cost (from response usage) agrees with the database cost reported below."
      : `Spend guard DISAGREES with the database cost (the database figure is the reported one): ${r.guardDisagreements.join("; ")}`,
    "",
  );
  out.push("## Per-model summary", "");
  out.push(
    "Released answers = answered + repaired. Cost per answered = total cost / released answers.",
    "",
  );
  out.push(
    "| Model | Answered | Repaired | Withheld | Error | Skipped | Total latency | Mean latency | Total tokens | Total cost | Cost per answered |",
  );
  out.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const m of r.models) {
    const s = m.summary;
    out.push(
      `| ${m.model} | ${s.answered} | ${s.repaired} | ${s.withheld} | ${s.error} | ${s.skipped} | ${secs(s.totalLatencyMs)} | ${s.meanLatencyMs === null ? "-" : secs(s.meanLatencyMs)} | ${s.totalTokens} | ${usd(s.costUsd)} | ${usd(s.costPerAnswered)} |`,
    );
  }
  out.push("");

  out.push("## Per-question side by side", "");
  out.push(`| Question | ${r.models.map((m) => m.model).join(" | ")} |`);
  out.push(`|---|${r.models.map(() => "---").join("|")}|`);
  for (const q of r.config.questions) {
    const cells = r.models.map((m) => pairCell(m.results.find((x) => x.questionId === q.id)));
    out.push(`| ${q.id} (${q.kind}) | ${cells.join(" | ")} |`);
  }
  out.push("");

  out.push("## Answers", "");
  for (const q of r.config.questions) {
    out.push(`### ${q.id} (${q.kind})`, "", `> ${q.text}`, "");
    for (const m of r.models) {
      const x = m.results.find((y) => y.questionId === q.id);
      out.push(`#### ${m.model}`, "");
      if (!x) out.push("_not run_", "");
      else if (x.outcome === "skipped") out.push(`_skipped: ${x.detail ?? "not run"}_`, "");
      else if (x.outcome === "error") out.push(`_error (${x.errorKind}): ${x.detail}_`, "");
      else if (x.outcome === "withheld") {
        out.push(
          `_Withheld by the release gate. Ungrounded: ${x.ungroundedNumbers.join(", ") || "none"}._`,
          "",
          x.withheldAnswer ?? "",
          "",
        );
      } else out.push(x.answer ?? "", "");
    }
  }
  return out.join("\n");
}

export function parseArgs(argv: string[]): {
  models: string[];
  questions: string[] | null;
  label: string;
} {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const list = (v: string) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const label = get("--label") ?? "default";
  const modelsArg = get("--models");
  if (modelsArg) assertHaikuOnly(list(modelsArg));
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error("--label needs a name made of letters, digits, '.', '_' or '-'");
  }
  const models = get("--models");
  const questions = get("--questions");
  return {
    models: models ? list(models) : DEFAULT_MODELS,
    questions: questions ? list(questions) : null,
    label,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = requireApiKey(process.env);
  const { questions, added } = selectQuestions(QUESTIONS, args.questions);
  if (added.length > 0)
    console.log(`Adding ${added.join(", ")}: a follow-up needs its first question.`);
  const sql = await connectTestDb("compare");
  if (!sql) throw new Error("Postgres is unreachable (start it with docker compose up -d db).");
  try {
    await runCompare({
      sql,
      apiKey,
      models: args.models,
      questions,
      label: args.label,
      reportsDir: resolve(REPO_ROOT, "evals", "reports"),
      ledger: {},
    });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[compare] ${(err as Error).message}`);
    process.exit(1);
  });
}
