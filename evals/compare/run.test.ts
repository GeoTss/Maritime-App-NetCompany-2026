/** Dry test of the comparison runner: scripted transport, real agent, app route and database. */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import type { Fact } from "@pharos/shared";
import { afterAll, describe, expect, it } from "vitest";
import type { LlmFetch } from "../../apps/api/src/ai/llm.js";
import {
  lastToolResult,
  type ScriptedRequest,
  scriptedMessage,
  textReply,
  toolCall,
} from "../../apps/api/src/ai/scripted-llm.js";
import { ModelNotAllowedError, readLedger } from "../lib/budget.js";
import type { CompareQuestion } from "./questions.js";
import { QUESTIONS } from "./questions.js";
import {
  classifyError,
  classifyOutcome,
  estimateModelUsd,
  type PairResult,
  parseArgs,
  requireApiKey,
  runCompare,
  selectQuestions,
  summarise,
} from "./run.js";

const sql = await connectTestDb("compare");

describe("question set", () => {
  it("has the seven questions, q3 following q1", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
    expect(QUESTIONS.find((q) => q.id === "q3")?.followUpOf).toBe("q1");
  });
  it("pulls in the question a follow-up needs", () => {
    const { questions, added } = selectQuestions(QUESTIONS, ["q3"]);
    expect(questions.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(added).toEqual(["q1"]);
    expect(() => selectQuestions(QUESTIONS, ["q99"])).toThrow(/unknown question/);
  });
});

describe("pure measurement logic", () => {
  it("classifies outcomes from the gate", () => {
    expect(classifyOutcome({ passed: true, repaired: false })).toBe("answered");
    expect(classifyOutcome({ passed: true, repaired: true })).toBe("repaired");
    expect(classifyOutcome({ passed: false, repaired: true })).toBe("withheld");
    expect(classifyOutcome(null)).toBe("error");
  });
  it("classifies error responses", () => {
    expect(classifyError(502, { error: "llm_unavailable", message: "overloaded" }).kind).toBe(
      "api_error",
    );
    expect(
      classifyError(502, { error: "agent_failed", message: "declined (stop_reason refusal)." })
        .kind,
    ).toBe("refusal");
    expect(
      classifyError(502, { error: "agent_failed", message: "cut off (stop_reason max_tokens)." })
        .kind,
    ).toBe("truncation");
    expect(classifyError(500, null)).toEqual({ kind: "http_500", message: "HTTP 500" });
  });
  it("aggregates cost, latency and counts", () => {
    const mk = (over: Partial<PairResult>): PairResult =>
      ({
        outcome: "answered",
        latencyMs: 1000,
        costUsd: 0.1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 2,
        ...over,
      }) as PairResult;
    const s = summarise([
      mk({}),
      mk({ outcome: "repaired", latencyMs: 3000, costUsd: 0.3 }),
      mk({ outcome: "withheld" }),
      mk({ outcome: "error" }),
      mk({
        outcome: "skipped",
        latencyMs: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ]);
    expect(s).toMatchObject({ answered: 1, repaired: 1, withheld: 1, error: 1, skipped: 1 });
    expect(s.totalLatencyMs).toBe(6000);
    expect(s.meanLatencyMs).toBe(1500);
    expect(s.costUsd).toBeCloseTo(0.6, 9);
    expect(s.totalTokens).toBe(4 * 18);
    expect(s.costPerAnswered).toBeCloseTo(0.3, 9);
  });
  it("estimates a priced model and refuses an unpriced one", () => {
    expect(estimateModelUsd("claude-opus-5-5", 7)).toBeGreaterThan(
      estimateModelUsd("claude-haiku-5-5", 7),
    );
    expect(() => estimateModelUsd("claude-nope", 1)).toThrow();
  });
  it("requires the key and names the variable, not a value", () => {
    expect(() => requireApiKey({})).toThrow("ANTHROPIC_API_KEY");
    expect(() => requireApiKey({ ANTHROPIC_API_KEY: "  " })).toThrow("ANTHROPIC_API_KEY");
    expect(requireApiKey({ ANTHROPIC_API_KEY: "k" })).toBe("k");
  });
  it("parses the CLI", () => {
    expect(parseArgs([])).toMatchObject({ questions: null, label: "default" });
    expect(parseArgs([]).models).toEqual(["claude-haiku-5-5"]);
    expect(
      parseArgs(["--models", "claude-haiku-5-5", "--questions", "q1,q2", "--label", "x"]),
    ).toEqual({
      models: ["claude-haiku-5-5"],
      questions: ["q1", "q2"],
      label: "x",
    });
    expect(() => parseArgs(["--label", "bad label"])).toThrow();
    expect(() => parseArgs(["--models", "claude-haiku-5-5,claude-sonnet-5-5"])).toThrow(
      /claude-sonnet-5-5/,
    );
  });
});

/** Question text markers choose the scripted behaviour. */
const QS: CompareQuestion[] = [
  { id: "a", kind: "demo", text: "TOOLS Where should Aegean Pioneer bunker?" },
  { id: "b", kind: "followup", followUpOf: "a", text: "PLAIN and a follow-up" },
  { id: "c", kind: "pressure", text: "WITHHOLD give a figure" },
  { id: "d", kind: "unknown", text: "REFUSE this one" },
];

/** One request, no tools: lets a cap be crossed exactly between questions. */
const PLAIN: CompareQuestion = { id: "p", kind: "demo", text: "PLAIN first" };

/** The question the model is answering now: the last plain user message that is not the repair. */
function currentQuestion(req: ScriptedRequest): string {
  const users = req.messages.filter(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      !m.content.startsWith("Your answer was withheld"),
  );
  return String(users.at(-1)?.content ?? "");
}

/** A scripted transport that reports the requested model as the serving model. */
function fakeTransport(opts: { servedModel?: (requested: string) => string } = {}) {
  const fetch: LlmFetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as ScriptedRequest & { model: string };
    const q = currentQuestion(req);
    const assistantTurns = req.messages.filter((m) => m.role === "assistant").length;
    let reply: ReturnType<typeof textReply>;
    if (q.startsWith("TOOLS")) {
      if (assistantTurns === 0) reply = toolCall(1, "plan_bunkering", { vessel: "Aegean Pioneer" });
      else if (assistantTurns === 1) {
        const plan = lastToolResult(req) as { facts: Fact[]; data: { calculationId: number } };
        const best = plan.facts.find((f) => f.id.endsWith("_bestOptionId"));
        reply = toolCall(2, "propose_action", {
          type: "purchase_order",
          calculationId: plan.data.calculationId,
          optionId: best?.value,
          factRefs: [best?.id],
          rationale: "Lowest total delivered cost.",
        });
      } else reply = textReply(3, "Buy from Kestrel at Marsaxlokk.");
    } else if (q.startsWith("WITHHOLD")) reply = textReply(1, "You save about 8,000 dollars.");
    else if (q.startsWith("REFUSE"))
      reply = scriptedMessage(1, [{ type: "text", text: "No." }], "refusal");
    else reply = textReply(1, "Understood.");
    const body = { ...reply, model: opts.servedModel ? opts.servedModel(req.model) : req.model };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": "req_x" },
    });
  };
  return fetch;
}

if (!sql) {
  describe("comparison runner (scripted, database)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("compare")}`, () => {});
  });
}

describe.skipIf(!sql)("comparison runner (scripted, database)", () => {
  if (!sql) return;
  const db = sql;
  const tmp: string[] = [];
  afterAll(async () => {
    await db.end();
    await Promise.all(tmp.map((d) => rm(d, { recursive: true, force: true })));
  });
  const budgetFile = async () => {
    const path = join(await dir(), "budget.json");
    await writeFile(path, JSON.stringify({ phase: 4, capUsd: 3 }));
    return path;
  };
  const dir = async () => {
    const d = await mkdtemp(join(tmpdir(), "pharos-compare-"));
    tmp.push(d);
    return d;
  };
  const log = () => {};

  it("measures each outcome from the database and writes the report", async () => {
    const reportsDir = await dir();
    const { report, reportDir } = await runCompare({
      sql: db,
      apiKey: "test-key",
      models: ["claude-haiku-5-5", "claude-haiku-5-5"],
      questions: QS,
      label: "dry",
      reportsDir,
      fetch: fakeTransport(),
      log,
    });
    expect(reportDir).toMatch(/\d{8}T\d{6}Z-agent-compare-dry$/);
    expect(report.models.map((m) => m.model)).toEqual(["claude-haiku-5-5", "claude-haiku-5-5"]);

    for (const m of report.models) {
      const by = Object.fromEntries(m.results.map((r) => [r.questionId, r]));
      // answered, with a proposal equal to the calculation's best option
      expect(by.a?.outcome).toBe("answered");
      expect(by.a?.tools.map((t) => t.tool)).toEqual(["plan_bunkering", "propose_action"]);
      expect(by.a?.llmCalls).toBe(3);
      expect(by.a?.factCount).toBeGreaterThan(0);
      expect(by.a?.recommendations).toHaveLength(1);
      expect(by.a?.recommendations[0]?.equalsBest).toBe(true);
      expect(by.a?.recommendations[0]?.bestOptionId).toBe(by.a?.recommendations[0]?.optionId);
      expect(by.a?.servedModelOk).toBe(true);
      expect(by.a?.servedModels).toEqual([m.model]);
      // follow-up runs in the first question's conversation
      expect(by.b?.outcome).toBe("answered");
      expect(by.b?.conversationId).toBe(by.a?.conversationId);
      expect(by.b?.tools).toEqual([]);
      // withheld after a failed repair: two calls, the stored text and the numbers are kept
      expect(by.c?.outcome).toBe("withheld");
      expect(by.c?.answer).toBeNull();
      expect(by.c?.withheldAnswer).toContain("8,000");
      expect(by.c?.ungroundedNumbers).toEqual(["8,000"]);
      expect(by.c?.llmCalls).toBe(2);
      // refusal is an error, not a wrong answer; its cost is still counted
      expect(by.d?.outcome).toBe("error");
      expect(by.d?.errorKind).toBe("refusal");
      expect(by.d?.llmCalls).toBe(1);
      expect(by.d?.costUsd).toBeGreaterThan(0);

      expect(m.summary).toMatchObject({ answered: 2, repaired: 0, withheld: 1, error: 1 });
      expect(m.summary.costUsd).toBeCloseTo(sum(m.results.map((r) => r.costUsd)), 9);
      expect(m.summary.costPerAnswered).toBeCloseTo(m.summary.costUsd / 2, 9);
    }
    expect(report.totalCostUsd).toBeCloseTo(sum(report.models.map((m) => m.summary.costUsd)), 9);

    // The database holds the same total as the report (this run's rows only: reset per model).
    const json = JSON.parse(await readFile(join(reportDir, "report.json"), "utf8"));
    expect(json.models).toHaveLength(2);
    expect(json.config.seed).toBe(20261114);
    expect(json.config.anchor).toBe("2026-11-14T08:00:00.000Z");
    expect(json.note).toContain("No accuracy score");
    const md = await readFile(join(reportDir, "report.md"), "utf8");
    expect(md).toContain("No accuracy score is computed");
    expect(md).toContain("## Per-model summary");
    expect(md).toContain("## Per-question side by side");
    expect(md).toContain("Buy from Kestrel at Marsaxlokk.");
    expect(md).toContain("Withheld by the release gate");
    expect(md).toContain("refusal");
    const transcripts = JSON.parse(await readFile(join(reportDir, "transcripts.json"), "utf8"));
    expect(transcripts.length).toBe(8);
  });

  it("with a ledger: refuses a non-Haiku model, checks the budget, and ledgers the cost", async () => {
    const ledger = join(await dir(), "ledger.jsonl");
    const budgetPath = await budgetFile();
    const base = {
      sql: db,
      apiKey: "test-key",
      questions: [QS[0] as CompareQuestion],
      label: "ledgered",
      fetch: fakeTransport(),
      log,
      ledger: { path: ledger, budgetPath },
    };
    await expect(
      runCompare({ ...base, models: ["claude-sonnet-5-5"], reportsDir: await dir() }),
    ).rejects.toThrow(/claude-sonnet-5-5/);
    await writeFile(
      ledger,
      `${JSON.stringify({ at: "2026-11-14T10:00:00Z", run: "x", label: "x", costUsd: 3, phase: 4 })}\n`,
    );
    await expect(
      runCompare({ ...base, models: ["claude-haiku-5-5"], reportsDir: await dir() }),
    ).rejects.toThrow(/exceeds the \$3\.00 cap/);
    await writeFile(ledger, "");
    const { report } = await runCompare({
      ...base,
      models: ["claude-haiku-5-5"],
      reportsDir: await dir(),
    });
    const rows = readLedger(ledger);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run: "compare", label: "ledgered" });
    expect(rows[0]?.costUsd).toBeCloseTo(report.models[0]?.guardCostUsd ?? -1, 9);
  });

  it("refuses a non-Haiku model whether or not a ledger is given", async () => {
    for (const models of [["claude-sonnet-5-5"], ["claude-haiku-5-5", "claude-opus-5-5"]]) {
      await expect(
        runCompare({
          sql: db,
          apiKey: "test-key",
          models,
          questions: [QS[0] as CompareQuestion],
          label: "refused",
          reportsDir: await dir(),
          fetch: fakeTransport(),
          log,
        }),
      ).rejects.toThrow(ModelNotAllowedError);
    }
  });

  it("fails the run when a response is served by a non-Haiku model, after writing the report", async () => {
    const reportsDir = await dir();
    const ledger = join(await dir(), "ledger.jsonl");
    const budgetPath = await budgetFile();
    await writeFile(ledger, "");
    await expect(
      runCompare({
        sql: db,
        apiKey: "test-key",
        models: ["claude-haiku-5-5"],
        questions: [QS[0] as CompareQuestion],
        label: "served",
        reportsDir,
        fetch: fakeTransport({ servedModel: () => "claude-sonnet-5-5" }),
        ledger: { path: ledger, budgetPath },
        log,
      }),
    ).rejects.toThrow(/claude-sonnet-5-5/);
    const [stamped] = await readdir(reportsDir);
    const json = JSON.parse(await readFile(join(reportsDir, stamped ?? "", "report.json"), "utf8"));
    expect(json.models[0].results[0].servedModelOk).toBe(false);
    expect(json.models[0].results[0].servedModels).toEqual(["claude-sonnet-5-5"]);
    expect(readLedger(ledger)).toHaveLength(1);
  });

  it("stops a model at its cost cap and records why", async () => {
    const { report } = await runCompare({
      sql: db,
      apiKey: "test-key",
      models: ["claude-haiku-5-5", "claude-haiku-5-5"],
      questions: [PLAIN, ...QS],
      label: "modelcap",
      reportsDir: await dir(),
      fetch: fakeTransport(),
      modelCapUsd: 0.0001,
      totalCapUsd: 100,
      log,
    });
    for (const m of report.models) {
      expect(m.results.map((r) => r.outcome)).toEqual([
        "answered",
        "skipped",
        "skipped",
        "skipped",
        "skipped",
      ]);
      expect(m.stoppedReason).toContain("model cost cap exceeded");
      expect(m.results[1]?.detail).toContain("model cost cap");
    }
    expect(report.stops.filter((s) => s.scope === "model")).toHaveLength(2);
    expect(report.stops.some((s) => s.scope === "run")).toBe(false);
  });

  /** Counts the requests that reach the (scripted) network. */
  const counting = () => {
    const base = fakeTransport();
    const state = { n: 0 };
    const fetch: LlmFetch = (url, init) => {
      state.n += 1;
      return base(url, init);
    };
    return { fetch, state };
  };

  it("blocks the next request once the model cap is crossed mid-question", async () => {
    const { fetch, state } = counting();
    const { report } = await runCompare({
      sql: db,
      apiKey: "test-key",
      models: ["claude-haiku-5-5"],
      questions: [QS[0] as CompareQuestion, QS[2] as CompareQuestion],
      label: "midcap",
      reportsDir: await dir(),
      fetch,
      modelCapUsd: 0.0001,
      totalCapUsd: 100,
      log,
    });
    // The TOOLS question needs three requests; the first one crosses the cap, so only it ran.
    expect(state.n).toBe(1);
    const [a, c] = report.models[0]?.results ?? [];
    expect(a?.outcome).toBe("error");
    expect(a?.errorKind).toBe("spend_cap");
    expect(a?.detail).toContain("stopped: cap");
    expect(a?.llmCalls).toBe(1);
    expect(c?.outcome).toBe("skipped");
    expect(report.models[0]?.stoppedReason).toContain("stopped: cap");
    expect(report.stops).toHaveLength(1);
    expect(report.stops[0]?.scope).toBe("model");
    // The guard and the database agree on what was spent.
    expect(report.guardDisagreements).toEqual([]);
    expect(report.models[0]?.guardCostUsd).toBeCloseTo(report.models[0]?.summary.costUsd ?? -1, 9);
  });

  it("blocks the next request once the run cap is crossed mid-question", async () => {
    const { fetch, state } = counting();
    const { report } = await runCompare({
      sql: db,
      apiKey: "test-key",
      models: ["claude-haiku-5-5", "claude-haiku-5-5"],
      questions: [QS[0] as CompareQuestion],
      label: "midruncap",
      reportsDir: await dir(),
      fetch,
      modelCapUsd: 100,
      totalCapUsd: 0.0001,
      log,
    });
    expect(state.n).toBe(1);
    expect(report.models[0]?.results[0]?.errorKind).toBe("spend_cap");
    expect(report.models[1]?.results.every((r) => r.outcome === "skipped")).toBe(true);
    expect(report.stops[0]?.scope).toBe("run");
  });

  it("records an unreadable response body instead of swallowing it", async () => {
    const { report } = await runCompare({
      sql: db,
      apiKey: "test-key",
      models: ["claude-haiku-5-5"],
      questions: [QS[2] as CompareQuestion],
      label: "parse",
      reportsDir: await dir(),
      fetch: async () =>
        new Response("<html>gateway</html>", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      log,
    });
    const r = report.models[0]?.results[0];
    expect(r?.outcome).toBe("error");
    expect(r?.servedModelParseError).toContain("unreadable at the transport");
  });

  it("never writes the API key into any report file", async () => {
    const key = "sk-ant-TEST-SECRET-0123456789";
    const { reportDir } = await runCompare({
      sql: db,
      apiKey: key,
      models: ["claude-haiku-5-5"],
      questions: QS,
      label: "secret",
      reportsDir: await dir(),
      fetch: fakeTransport(),
      log,
    });
    for (const f of ["report.md", "report.json", "transcripts.json"]) {
      expect(await readFile(join(reportDir, f), "utf8")).not.toContain(key);
    }
  });

  it("stops the run at the total cap, skipping later models entirely", async () => {
    const { report } = await runCompare({
      sql: db,
      apiKey: "test-key",
      models: ["claude-haiku-5-5", "claude-haiku-5-5"],
      questions: [PLAIN, ...QS],
      label: "runcap",
      reportsDir: await dir(),
      fetch: fakeTransport(),
      modelCapUsd: 100,
      totalCapUsd: 0.0001,
      log,
    });
    const [first, second] = report.models;
    expect(first?.results.map((r) => r.outcome)).toEqual([
      "answered",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(first?.stoppedReason).toContain("run cost cap exceeded");
    expect(second?.results.every((r) => r.outcome === "skipped")).toBe(true);
    expect(second?.summary.costUsd).toBe(0);
    expect(report.stops.some((s) => s.scope === "run")).toBe(true);
  });
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
