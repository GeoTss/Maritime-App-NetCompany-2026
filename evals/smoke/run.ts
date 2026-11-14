/**
 * Live smoke + measurement: drives the running API over HTTP (deliver both demo emails, wait for
 * extraction, check the two quotes, ask the demo question, approve the recommendation) and reports
 * step latencies and every model call's tokens, latency and cost.
 *
 *   npm run eval:smoke -- [--label <name>]        (API_URL, default http://localhost:4000)
 *
 * Needs no key: the API holds it. Before it starts it checks the Phase 3 budget ledger
 * (evals/spend-ledger.jsonl) and afterwards appends its cost; any non-Haiku model in
 * /api/llm-calls fails the run. Exits 2 if the API is not in live mode, 1 on any failed
 * assertion (all listed), 0 on success (and touches the live-smoke marker).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEMO_SCENARIO } from "@pharos/db";
import {
  AskResponse,
  DecisionResult,
  DeliverResult,
  HealthResponse,
  InboxItemDetail,
  type LlmCallView,
  LlmCallView as LlmCallViewSchema,
  type LlmMode,
  QuoteView,
  RecommendationView,
} from "@pharos/shared";
import { z } from "zod";
import { appendSpend, assertBudget, assertHaikuOnly } from "../lib/budget.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The demo question (same text as DEMO_QUESTION in apps/api/src/ask/demo-fixture.ts). */
export const DEMO_QUESTION = "Where should Aegean Pioneer bunker, and who should we buy from?";
/** The option the agent must propose a purchase for. */
export const EXPECTED_OPTION_ID = "MTMLA-kestrel";

/** Section 6 targets (ms). */
export const TARGET_EMAIL_MS = 20_000;
export const TARGET_ASK_MS = 45_000;
/** A run costing more than this fails (and writes no marker). Per run; not the $3 phase budget. */
export const RUN_CAP_USD = 0.25;
/** Estimated cost of one smoke run (about $0.004 measured); checked against the ledger up front. */
export const SMOKE_ESTIMATE_USD = 0.01;

/** The two demo emails, in delivery (file-name) order, with the values DEMO_SCENARIO expects. */
const EXPECTED_EMAILS = [
  { key: "kestrel", supplierName: "Kestrel Marine Fuels", portName: "Marsaxlokk" },
  { key: "straitline", supplierName: "Strait Line Fuels", portName: "Gibraltar" },
] as const;

export const INBOX_ALREADY_DELIVERED =
  "inbox already delivered — restart the API and ERP (docker compose up -d --force-recreate api erp) to reset the demo world";

export interface SmokeOptions {
  baseUrl: string;
  fetch: typeof fetch;
  label: string;
  /** The llmMode /api/health must report. Default "live". */
  expectedLlmMode?: LlmMode;
  reportsDir: string;
  markersDir: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Per-email wait for extraction to leave pending. Default 90 s. */
  extractionTimeoutMs?: number;
  log?: (line: string) => void;
  /** Phase 3 spend ledger: budget check before the run, cost appended after. Omit in dry tests. */
  ledger?: { path?: string };
}

export interface StepTiming {
  name: "email-1" | "email-2" | "ask" | "approve";
  latencyMs: number;
  targetMs: number | null;
}

export interface CallRow {
  id: number;
  purpose: "extract" | "agent";
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

export interface PurposeTotals {
  purpose: "extract" | "agent";
  models: string[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  costUsd: number;
}

export interface SmokeReport {
  label: string;
  startedAt: string;
  apiUrl: string;
  llmMode: LlmMode | null;
  ok: boolean;
  failures: string[];
  steps: StepTiming[];
  calls: CallRow[];
  byPurpose: PurposeTotals[];
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number;
  };
}

export interface SmokeResult {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  failures: string[];
  report: SmokeReport;
  reportDir: string;
}

/** Raised to stop the run at once (as opposed to a failed assertion, which the run continues past). */
class Stop extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
  }
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function summarise(calls: CallRow[]): Pick<SmokeReport, "byPurpose" | "totals"> {
  const byPurpose = (["extract", "agent"] as const)
    .map((purpose): PurposeTotals | null => {
      const rows = calls.filter((c) => c.purpose === purpose);
      if (rows.length === 0) return null;
      return {
        purpose,
        models: [...new Set(rows.map((r) => r.model))].sort(),
        calls: rows.length,
        inputTokens: sum(rows.map((r) => r.inputTokens)),
        outputTokens: sum(rows.map((r) => r.outputTokens)),
        cacheReadTokens: sum(rows.map((r) => r.cacheReadTokens)),
        cacheWriteTokens: sum(rows.map((r) => r.cacheWriteTokens)),
        latencyMs: sum(rows.map((r) => r.latencyMs)),
        costUsd: sum(rows.map((r) => r.costUsd)),
      };
    })
    .filter((p): p is PurposeTotals => p !== null);
  return {
    byPurpose,
    totals: {
      calls: calls.length,
      inputTokens: sum(calls.map((c) => c.inputTokens)),
      outputTokens: sum(calls.map((c) => c.outputTokens)),
      latencyMs: sum(calls.map((c) => c.latencyMs)),
      costUsd: sum(calls.map((c) => c.costUsd)),
    },
  };
}

export function renderMarkdown(r: SmokeReport): string {
  const out: string[] = [];
  out.push(`# Live smoke: ${r.label}`, "");
  out.push(`- Started: ${r.startedAt}`, `- API: ${r.apiUrl} (llmMode ${r.llmMode ?? "unknown"})`);
  out.push(`- Result: ${r.ok ? "PASS" : "FAIL"}`);
  for (const f of r.failures) out.push(`  - ${f}`);
  out.push(
    "",
    "## Step latency",
    "",
    "| Step | Latency | Target | Within |",
    "|---|---:|---:|---|",
  );
  for (const s of r.steps) {
    const within = s.targetMs === null ? "-" : s.latencyMs <= s.targetMs ? "yes" : "NO";
    out.push(
      `| ${s.name} | ${sec(s.latencyMs)} | ${s.targetMs === null ? "-" : sec(s.targetMs)} | ${within} |`,
    );
  }
  out.push("", "## By purpose", "");
  out.push(
    "| Purpose | Model | Calls | Input tok | Output tok | Cache read | Cache write | Latency | Cost USD |",
  );
  out.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const p of r.byPurpose) {
    out.push(
      `| ${p.purpose} | ${p.models.join(", ")} | ${p.calls} | ${p.inputTokens} | ${p.outputTokens} | ${p.cacheReadTokens} | ${p.cacheWriteTokens} | ${sec(p.latencyMs)} | ${p.costUsd.toFixed(6)} |`,
    );
  }
  const t = r.totals;
  out.push(
    `| **total** | | ${t.calls} | ${t.inputTokens} | ${t.outputTokens} | | | ${sec(t.latencyMs)} | ${t.costUsd.toFixed(6)} (cap ${RUN_CAP_USD.toFixed(2)}) |`,
  );
  out.push("", "## Model calls", "");
  out.push(
    "| Id | Purpose | Model | Mode | Input | Output | Cache read | Cache write | Latency | Cost USD | Stop |",
  );
  out.push("|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|");
  for (const c of r.calls) {
    out.push(
      `| ${c.id} | ${c.purpose} | ${c.model} | ${c.mode} | ${c.inputTokens} | ${c.outputTokens} | ${c.cacheReadTokens} | ${c.cacheWriteTokens} | ${sec(c.latencyMs)} | ${c.costUsd.toFixed(6)} | ${c.stopReason ?? ""} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

export async function runSmoke(opts: SmokeOptions): Promise<SmokeResult> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollIntervalMs ?? 1000;
  const timeoutMs = opts.extractionTimeoutMs ?? 90_000;
  const expectedMode = opts.expectedLlmMode ?? "live";
  const log = opts.log ?? ((line: string) => console.log(line));
  const base = opts.baseUrl.replace(/\/+$/, "");
  const startedAt = now();
  if (opts.ledger) assertBudget(SMOKE_ESTIMATE_USD, opts.ledger.path);

  const failures: string[] = [];
  const steps: StepTiming[] = [];
  let calls: CallRow[] = [];
  let llmMode: LlmMode | null = null;
  let exitCode: 0 | 1 | 2 = 0;
  const documentIds: number[] = [];
  let askCallIds: number[] = [];

  const check = (cond: boolean, message: string) => {
    if (!cond) failures.push(message);
    return cond;
  };
  const call = async (method: string, path: string, body?: unknown) => {
    try {
      return await opts.fetch(`${base}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new Stop(`${method} ${path} failed: ${(err as Error).message}`);
    }
  };
  const parsed = async <T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> => {
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Stop(`${what}: HTTP ${res.status}, body is not JSON: ${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new Stop(`${what}: HTTP ${res.status} ${text.slice(0, 300)}`);
    const r = schema.safeParse(json);
    if (!r.success) throw new Stop(`${what}: unexpected response shape: ${r.error.message}`);
    return r.data;
  };
  const time = async <T>(
    name: StepTiming["name"],
    targetMs: number | null,
    fn: () => Promise<T>,
  ) => {
    const t0 = now().getTime();
    try {
      return await fn();
    } finally {
      steps.push({ name, latencyMs: now().getTime() - t0, targetMs });
    }
  };

  /** This run's model calls: the delivered documents' extractions plus the ask's calls. */
  const loadCalls = async () => {
    const all = (
      await parsed(
        await call("GET", "/api/llm-calls"),
        z.object({ items: z.array(LlmCallViewSchema) }),
        "GET /api/llm-calls",
      )
    ).items;
    const ours = new Set(askCallIds);
    const ofDocuments = (c: LlmCallView) =>
      c.documentId !== null && documentIds.includes(c.documentId);
    // An ask that failed part way never returned its call ids, so its agent calls are those made
    // after this run's first document call (the run starts on a freshly restarted API).
    const firstDocumentCall = Math.min(...all.filter(ofDocuments).map((c) => c.id));
    const rows = all
      .filter(
        (c: LlmCallView) =>
          ours.has(c.id) || ofDocuments(c) || (c.purpose === "agent" && c.id > firstDocumentCall),
      )
      .sort((a, b) => a.id - b.id)
      .map(
        (c): CallRow => ({
          id: c.id,
          purpose: c.purpose,
          model: c.model,
          mode: c.mode,
          inputTokens: c.inputTokens,
          outputTokens: c.outputTokens,
          cacheReadTokens: c.cacheReadTokens,
          cacheWriteTokens: c.cacheWriteTokens,
          latencyMs: c.latencyMs,
          costUsd: c.costUsd,
          stopReason: c.stopReason,
        }),
      );
    return { all, rows };
  };

  try {
    const health = await parsed(
      await call("GET", "/api/health"),
      HealthResponse,
      "GET /api/health",
    );
    llmMode = health.llmMode;
    if (health.llmMode !== expectedMode) {
      throw new Stop(
        `API reports llmMode ${health.llmMode}: start the API with LLM_MODE=${expectedMode}`,
        2,
      );
    }
    check(health.status === "ok", `health status is ${health.status}, expected ok`);

    // 1. Deliver both demo emails; time deliver -> extraction leaves pending.
    for (const [i, email] of EXPECTED_EMAILS.entries()) {
      const name = i === 0 ? "email-1" : "email-2";
      await time(name, TARGET_EMAIL_MS, async () => {
        const res = await call("POST", "/api/inbox/deliver-next");
        if (res.status === 409) throw new Stop(INBOX_ALREADY_DELIVERED);
        const delivered = await parsed(res, DeliverResult, "POST /api/inbox/deliver-next");
        documentIds.push(delivered.documentId);
        const deadline = now().getTime() + timeoutMs;
        for (;;) {
          const item = await parsed(
            await call("GET", `/api/inbox/${delivered.documentId}`),
            InboxItemDetail,
            `GET /api/inbox/${delivered.documentId}`,
          );
          if (item.extractionStatus !== "pending") {
            if (item.extractionStatus !== "extracted") {
              const failed = item.checkResults
                .filter((c) => !c.passed)
                .map((c) => `${c.check}: ${c.detail ?? "failed"}`);
              const processing = item.checkResults.find((c) => c.check === "processing")?.detail;
              const why = failed.length > 0 ? failed.join("; ") : (processing ?? "");
              // Stop here: carrying on would make a paid ask over a broken inbox.
              throw new Stop(
                `${email.key}: extraction ended ${item.extractionStatus}, expected extracted${why ? ` (${why})` : ""}`,
              );
            }
            return;
          }
          if (now().getTime() >= deadline) {
            throw new Stop(`${email.key}: extraction still pending after ${sec(timeoutMs)}`);
          }
          await sleep(pollMs);
        }
      });
    }

    // 2. The two quotes match DEMO_SCENARIO.
    const quotes = (
      await parsed(
        await call("GET", "/api/quotes"),
        z.object({ items: z.array(QuoteView) }),
        "GET /api/quotes",
      )
    ).items;
    for (const [i, email] of EXPECTED_EMAILS.entries()) {
      const option = DEMO_SCENARIO.options.find((o) => o.supplierKey === email.key);
      const q = quotes.find((x) => x.documentId === documentIds[i]);
      if (
        !option ||
        !check(q !== undefined, `${email.key}: no quote for document ${documentIds[i]}`) ||
        !q
      )
        continue;
      const line = q.lines[0];
      check(
        q.supplierName === email.supplierName,
        `${email.key}: supplier ${q.supplierName}, expected ${email.supplierName}`,
      );
      check(
        q.portName === email.portName,
        `${email.key}: port ${q.portName}, expected ${email.portName}`,
      );
      check(
        q.currency === option.currency,
        `${email.key}: currency ${q.currency}, expected ${option.currency}`,
      );
      check(
        q.bargeFee === option.bargeFee,
        `${email.key}: barge fee ${q.bargeFee}, expected ${option.bargeFee}`,
      );
      check(q.lines.length === 1, `${email.key}: ${q.lines.length} quote lines, expected 1`);
      check(
        line?.grade === DEMO_SCENARIO.requirement.grade,
        `${email.key}: grade ${line?.grade}, expected ${DEMO_SCENARIO.requirement.grade}`,
      );
      check(
        line?.pricePerMt === option.pricePerMt,
        `${email.key}: price ${line?.pricePerMt}, expected ${option.pricePerMt}`,
      );
      check(
        line?.qtyMt === option.qtyMt,
        `${email.key}: quantity ${line?.qtyMt}, expected ${option.qtyMt}`,
      );
    }

    // 3. Ask the demo question.
    const answer = await time("ask", TARGET_ASK_MS, async () =>
      parsed(
        await call("POST", "/api/ask", { question: DEMO_QUESTION, conversationId: null }),
        AskResponse,
        "POST /api/ask",
      ),
    );
    check(
      answer.gate.passed,
      `release gate did not pass (ungrounded: ${answer.gate.ungroundedNumbers.join(", ") || "none"})`,
    );
    check(answer.answer !== null && answer.answer.trim() !== "", "answer is empty or withheld");
    check(answer.facts.length >= 1, "answer carries no facts (no fact chip)");

    let target: RecommendationView | undefined;
    for (const id of answer.recommendationIds) {
      const rec = await parsed(
        await call("GET", `/api/recommendations/${id}`),
        RecommendationView,
        `GET /api/recommendations/${id}`,
      );
      if (rec.optionId === EXPECTED_OPTION_ID && rec.status === "pending") target = rec;
    }
    if (
      check(
        target !== undefined,
        `no pending recommendation for ${EXPECTED_OPTION_ID} (got ${answer.recommendationIds.length} recommendation(s))`,
      ) &&
      target
    ) {
      // 4. Approve it.
      const decision = await time("approve", null, async () =>
        parsed(
          await call("POST", `/api/recommendations/${target.id}/approve`, {}),
          DecisionResult,
          `POST /api/recommendations/${target.id}/approve`,
        ),
      );
      check(
        typeof decision.erpPoNumber === "string" && decision.erpPoNumber !== "",
        `approve returned no erpPoNumber (status ${decision.status}, erp ${decision.erpSyncStatus})`,
      );
    }

    // 5. This run's model calls: the two documents' extractions plus the ask's calls.
    askCallIds = answer.llmCallIds;
    const loaded = await loadCalls();
    calls = loaded.rows;
    const all = loaded.all;
    const runCost = sum(calls.map((c) => c.costUsd));
    check(
      runCost <= RUN_CAP_USD,
      `run cost $${runCost.toFixed(4)} exceeds the $${RUN_CAP_USD.toFixed(2)} cap`,
    );
    check(
      calls.filter((c) => c.purpose === "extract").length >= 2,
      "fewer than 2 extract calls recorded for this run",
    );
    check(
      calls.some((c) => c.purpose === "agent"),
      "no agent call recorded for this run",
    );
    check(
      answer.llmCallIds.every((id) => all.some((c) => c.id === id)),
      "some of the ask's llmCallIds are not in /api/llm-calls",
    );
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    failures.push(err.message);
    exitCode = err.exitCode;
  }

  // A run that stopped early may still have spent money on the calls it made: ledger those too.
  if (calls.length === 0 && documentIds.length > 0) {
    try {
      calls = (await loadCalls()).rows;
    } catch {
      // The API is unreachable; there is nothing more to read.
    }
  }
  // Every run checks whatever calls it loaded, so an early stop cannot hide another model.
  try {
    assertHaikuOnly(calls.map((c) => c.model));
  } catch (err) {
    failures.push((err as Error).message);
  }
  if (opts.ledger && calls.length > 0) {
    appendSpend(
      {
        at: startedAt.toISOString(),
        run: "smoke",
        label: opts.label,
        costUsd: sum(calls.map((c) => c.costUsd)),
      },
      opts.ledger.path,
    );
  }

  const ok = failures.length === 0;
  if (!ok && exitCode === 0) exitCode = 1;

  const report: SmokeReport = {
    label: opts.label,
    startedAt: startedAt.toISOString(),
    apiUrl: base,
    llmMode,
    ok,
    failures,
    steps,
    calls,
    ...summarise(calls),
  };
  const reportDir = join(opts.reportsDir, `${stamp(startedAt)}-smoke-${opts.label}`);
  if (exitCode !== 2) {
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(reportDir, "report.md"), renderMarkdown(report));
    log(renderMarkdown(report));
    log(`report: ${reportDir}`);
  }
  if (ok) {
    await mkdir(opts.markersDir, { recursive: true });
    await writeFile(join(opts.markersDir, "live-smoke"), `${now().toISOString()}\n`);
  } else {
    for (const f of failures) log(`FAIL: ${f}`);
  }
  return { ok, exitCode, failures, report, reportDir };
}

function parseArgs(argv: string[]): { label: string } {
  const i = argv.indexOf("--label");
  const label = i >= 0 ? argv[i + 1] : "default";
  if (!label || label.startsWith("--") || !/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error("--label needs a name made of letters, digits, '.', '_' or '-'");
  }
  return { label };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { label } = parseArgs(process.argv.slice(2));
    const result = await runSmoke({
      baseUrl: process.env.API_URL?.trim() || "http://localhost:4000",
      fetch,
      label,
      reportsDir: resolve(REPO_ROOT, "evals", "reports"),
      markersDir:
        process.env.MARKERS_DIR?.trim() || resolve(REPO_ROOT, ".claude", "state", "markers"),
      ledger: {},
    });
    process.exit(result.exitCode);
  } catch (err) {
    console.error(`[smoke] ${(err as Error).message}`);
    process.exit(1);
  }
}
