/** The Q&A runner: argument refusals, the oracle and empty dry runs, and runs on a real database. */
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIError } from "@anthropic-ai/sdk";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import type { Fact } from "@pharos/shared";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AgentError, runAgent } from "../../apps/api/src/ai/agent.js";
import { captureLlmCall } from "../../apps/api/src/ai/call-capture.js";
import { createLlm, type LlmFetch, ReplayMissError } from "../../apps/api/src/ai/llm.js";
import {
  lastToolResult,
  type ScriptedRequest,
  scriptedFetch,
  scriptedMessage,
  textReply,
  toolCall,
} from "../../apps/api/src/ai/scripted-llm.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../apps/api/src/ask/demo-fixture.js";
import { DID_NOT_FINISH, INTERRUPT_EXIT } from "../extraction/run.js";
import { readLedger } from "../lib/budget.js";
import { appendPass, HeldoutRerunError, readPasses } from "../lib/heldout-passes.js";
import {
  changedTables,
  classifyAskError,
  ESTIMATE_PER_QUESTION_USD,
  guardedFingerprints,
  LEDGER_RUN,
  parseArgs,
  RUN_CAP_USD,
  runQaEval,
  selectQuestions,
} from "./run.js";
import { QA_GOLDEN_DIR, readQaTruths } from "./split.js";

const dir = () => mkdtemp(join(tmpdir(), "qa-run-"));
const split = JSON.parse(
  await readFile(new URL("../golden/qa/split.json", import.meta.url), "utf8"),
) as { dev: string[]; heldout: string[] };
/**
 * A stand-in golden directory whose "heldout" split is three dev questions (their truth files
 * copied): the passes-file tests run the final held-out path without running a real held-out
 * question.
 */
const STAND_IN = await (async () => {
  const golden = await dir();
  const ids = split.dev.slice(0, 3);
  for (const id of ids) {
    await copyFile(join(QA_GOLDEN_DIR, `${id}.truth.json`), join(golden, `${id}.truth.json`));
  }
  await writeFile(join(golden, "split.json"), JSON.stringify({ dev: [], heldout: ids }));
  return { dir: golden, ids };
})();
const heldoutId = (i: number): string => {
  const id = STAND_IN.ids[i];
  if (!id) throw new Error(`no stand-in held-out question at ${i}`);
  return id;
};
/** A final pass of the stand-in held-out split. */
const STAND_IN_FINAL = { split: "heldout" as const, final: true, goldenDir: STAND_IN.dir };
/** A passes file in a temp directory, with these rows already in it (or none: no file yet). */
const tempPasses = async (ids: string[] = []) => {
  const path = join(await dir(), "passes.jsonl");
  for (const id of ids) {
    appendPass(
      {
        suite: "qa",
        id,
        run: 1,
        at: "2026-11-16T10:00:00.000Z",
        label: "earlier",
        report: "20261116T100000Z-qa-heldout-earlier",
        outcome: "graded",
      },
      path,
    );
  }
  return path;
};
const fileText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
/** An API outage: a 529 the SDK does not retry (x-should-retry: false), so it surfaces at once. */
const overloaded = () =>
  new Response(
    JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
    { status: 529, headers: { "content-type": "application/json", "x-should-retry": "false" } },
  );
/** Request 1 meets an outage; later requests are answered from `script`, in order. */
const outageFirst = (script: unknown[]) => {
  const served = scriptedFetch(script);
  let calls = 0;
  const fetch: LlmFetch = async (url, init) =>
    ++calls === 1 ? overloaded() : served.fetch(url, init);
  return { fetch, calls: () => calls };
};

describe("the per-question estimate", () => {
  it("is $0.004: the 33 dev questions estimate $0.132, under the $0.25 pass cap", () => {
    expect(ESTIMATE_PER_QUESTION_USD).toBe(0.004);
    expect(split.dev).toHaveLength(33);
    expect(split.dev.length * ESTIMATE_PER_QUESTION_USD).toBeCloseTo(0.132, 9);
    expect(split.dev.length * ESTIMATE_PER_QUESTION_USD).toBeLessThan(RUN_CAP_USD);
  });
});

describe("parseArgs", () => {
  it("parses the documented usage", () => {
    expect(
      parseArgs([
        "--suite",
        "qa",
        "--split",
        "dev",
        "--mode",
        "live",
        "--label",
        "x",
        "--limit",
        "3",
        "--offset",
        "2",
      ]),
    ).toMatchObject({
      split: "dev",
      mode: "live",
      answerer: "llm",
      label: "x",
      limit: 3,
      offset: 2,
    });
  });
  it("refuses the held-out split without --final", () => {
    expect(() => parseArgs(["--suite", "qa", "--split", "heldout"])).toThrow(/--final/);
    expect(parseArgs(["--suite", "qa", "--split", "heldout", "--final"]).final).toBe(true);
  });
  it("refuses --final in record mode: record is replay-first, so the final pass runs live", () => {
    const final = ["--suite", "qa", "--split", "heldout", "--final", "--mode"];
    expect(() => parseArgs([...final, "record"])).toThrow(
      /--final is a live measurement: run it with --mode live/,
    );
    expect(parseArgs([...final, "live"])).toMatchObject({ final: true, mode: "live" });
  });
  it("refuses a model mode with --oracle, both baselines, and unknown flags", () => {
    expect(() => parseArgs(["--suite", "qa", "--oracle", "--mode", "live"])).toThrow(
      /no model calls/,
    );
    expect(() => parseArgs(["--suite", "qa", "--oracle", "--empty"])).toThrow(/alternatives/);
    expect(() => parseArgs(["--suite", "qa", "--nope"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--suite", "extraction"])).toThrow(/--suite qa/);
  });
});

describe("selectQuestions", () => {
  it("takes the split in split.json order, with offset and limit", async () => {
    expect(await selectQuestions("dev", {})).toEqual(split.dev);
    expect(await selectQuestions("dev", { offset: 2, limit: 3 })).toEqual(split.dev.slice(2, 5));
    await expect(selectQuestions("dev", { ids: [split.heldout[0] as string] })).rejects.toThrow(
      /not in the dev split/,
    );
  });
});

describe("dry runs (no model, no database)", () => {
  it("the oracle over dev scores 100 % with 0 unauthorised and ledgers nothing", async () => {
    const reportsDir = await dir();
    const ledgerPath = join(await dir(), "ledger.jsonl");
    const r = await runQaEval({
      split: "dev",
      mode: "replay",
      answerer: "oracle",
      label: "t",
      reportsDir,
      ledgerPath,
      log: () => {},
    });
    const c = r.scorecard;
    expect(c.questions).toBe(split.dev.length);
    expect(c.answerAccuracy.rate).toBe(1);
    expect(c.grounded.rate).toBe(1);
    expect(c.abstention.rate).toBe(1);
    expect(c.injection.rate).toBe(1);
    expect(c.noAction.rate).toBe(1);
    expect(c.proposedBest.rate).toBe(1);
    expect(c.unauthorised.k).toBe(0);
    expect(c.errors).toEqual([]);
    expect(readLedger(ledgerPath)).toEqual([]);
    const md = await readFile(join(r.reportDir, "scorecard.md"), "utf8");
    expect(md).toContain("Answer accuracy");
    expect(md).toMatch(/95 % CI/);
  });

  it("the empty answer scores 0 % on answer accuracy, abstention and proposed = best", async () => {
    const r = await runQaEval({
      split: "dev",
      mode: "replay",
      answerer: "empty",
      label: "t",
      reportsDir: await dir(),
      log: () => {},
    });
    expect(r.scorecard.answerAccuracy.k).toBe(0);
    expect(r.scorecard.answerAccuracy.n).toBeGreaterThan(0);
    expect(r.scorecard.abstention.k).toBe(0);
    expect(r.scorecard.proposedBest.k).toBe(0);
  });

  it("refuses a final record pass through the API before anything runs", async () => {
    await expect(
      runQaEval({
        split: "heldout",
        final: true,
        mode: "record",
        answerer: "llm",
        label: "t",
        reportsDir: await dir(),
        log: () => {},
      }),
    ).rejects.toThrow(/--final is a live measurement/);
  });

  it("refuses the held-out split without final, even through the API", async () => {
    await expect(
      runQaEval({
        split: "heldout",
        mode: "replay",
        answerer: "oracle",
        label: "t",
        reportsDir: await dir(),
        log: () => {},
      }),
    ).rejects.toThrow(/--final/);
  });

  it("a final live held-out pass refuses to start when a selected id is in the passes file, before any call or ledger row", async () => {
    const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
    const passesPath = await tempPasses([heldoutId(1)]);
    const before = fileText(passesPath);
    const ledgerPath = join(await dir(), "ledger.jsonl");
    const reportsDir = await dir();
    const { fetch, requests } = scriptedFetch([textReply(1, "x")]);
    const run = runQaEval({
      ...STAND_IN_FINAL,
      mode: "live",
      answerer: "llm",
      label: "rerun",
      ids,
      apiKey: "test-key",
      fetch,
      ledgerPath,
      passesPath,
      reportsDir,
      log: () => {},
    });
    await expect(run).rejects.toBeInstanceOf(HeldoutRerunError);
    await expect(run).rejects.toThrow(new RegExp(`: ${heldoutId(1)}\\b`));
    expect(requests).toHaveLength(0);
    expect(readLedger(ledgerPath)).toEqual([]);
    expect(await readdir(reportsDir)).toEqual([]);
    expect(fileText(passesPath)).toBe(before);
  });

  it("meta.final is true only with --final", async () => {
    expect(parseArgs(["--suite", "qa", "--oracle"]).final).toBe(false);
    expect(parseArgs(["--suite", "qa", "--oracle", "--final"]).final).toBe(true);
    const oracle = { mode: "replay" as const, answerer: "oracle" as const, log: () => {} };
    const plain = await runQaEval({ ...oracle, split: "dev", label: "t", reportsDir: await dir() });
    const final = await runQaEval({
      ...oracle,
      split: "dev",
      final: true,
      label: "t",
      reportsDir: await dir(),
    });
    expect(plain.meta.final).toBe(false);
    expect(final.meta.final).toBe(true);
    for (const [r, want] of [
      [plain, false],
      [final, true],
    ] as const) {
      const json = JSON.parse(await readFile(join(r.reportDir, "scorecard.json"), "utf8"));
      expect(json.meta.final).toBe(want);
      const md = await readFile(join(r.reportDir, "scorecard.md"), "utf8");
      expect(md.includes("- Final pass (--final)")).toBe(want);
    }
  });

  it("a final live held-out pass refuses an empty label before any call (its pass rows need one)", async () => {
    const { fetch, requests } = scriptedFetch([textReply(1, "x")]);
    const ledgerPath = join(await dir(), "ledger.jsonl");
    const reportsDir = await dir();
    const passesPath = await tempPasses();
    await expect(
      runQaEval({
        ...STAND_IN_FINAL,
        mode: "live",
        answerer: "llm",
        label: "",
        ids: [heldoutId(0)],
        apiKey: "test-key",
        fetch,
        ledgerPath,
        passesPath,
        reportsDir,
        log: () => {},
      }),
    ).rejects.toThrow(/final held-out pass needs a non-empty --label/);
    expect(requests).toHaveLength(0);
    expect(readLedger(ledgerPath)).toEqual([]);
    expect(await readdir(reportsDir)).toEqual([]);
    expect(fileText(passesPath)).toBeNull();
  });

  it("SIGHUP is handled like SIGTERM: the report so far is written and the run exits 130", async () => {
    const ids = split.dev.slice(0, 3);
    const signals = new EventEmitter();
    const reportsDir = await dir();
    let atExit: unknown = null;
    const exit = vi.fn((_code: number) => {
      const [name] = readdirSync(reportsDir);
      atExit = JSON.parse(readFileSync(join(reportsDir, name ?? "", "scorecard.json"), "utf8"));
    });
    const during: string[][] = [];
    let sent = false;
    const r = await runQaEval({
      split: "dev",
      mode: "replay",
      answerer: "oracle",
      label: "sighup",
      ids,
      reportsDir,
      signals,
      exit,
      log: (line) => {
        during.push(signals.eventNames().map(String).sort());
        if (!sent && line.includes(`${ids[0]}:`)) {
          sent = true;
          signals.emit("SIGHUP");
        }
      },
    });
    expect(during[0]).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(INTERRUPT_EXIT);
    expect(atExit).toMatchObject({
      meta: { aborted: "interrupted by SIGHUP", notRun: ids.slice(1) },
      scorecard: { questions: 1 },
    });
    expect(r.meta).toMatchObject({ aborted: "interrupted by SIGHUP", notRun: ids.slice(1) });
    expect(signals.eventNames()).toEqual([]);
  });

  it("after each question the report holds a readable scorecard of the rows so far, marked did not finish (a SIGKILL leaves it)", async () => {
    const ids = split.dev.slice(0, 3);
    const reportsDir = await dir();
    const seen: { aborted: unknown; notRun: unknown; questions: unknown }[] = [];
    const r = await runQaEval({
      split: "dev",
      mode: "replay",
      answerer: "oracle",
      label: "crash-safe",
      ids,
      reportsDir,
      log: (line) => {
        // Each question's log line comes after its row, transcript and scorecard writes.
        if (!/: (answered|withheld|error \S+) /.test(line)) return;
        const [name = ""] = readdirSync(reportsDir);
        const json = JSON.parse(readFileSync(join(reportsDir, name, "scorecard.json"), "utf8"));
        seen.push({
          aborted: json.meta.aborted,
          notRun: json.meta.notRun,
          questions: json.scorecard.questions,
        });
      },
    });
    expect(DID_NOT_FINISH).toBe("did not finish (no final scorecard)");
    expect(seen).toEqual([
      { aborted: DID_NOT_FINISH, notRun: ids.slice(1), questions: 1 },
      { aborted: DID_NOT_FINISH, notRun: ids.slice(2), questions: 2 },
      { aborted: DID_NOT_FINISH, notRun: [], questions: 3 },
    ]);
    // The end-of-run write replaces it: a finished pass reads as finished.
    const json = JSON.parse(await readFile(join(r.reportDir, "scorecard.json"), "utf8"));
    expect(json.meta).toMatchObject({ aborted: null, notRun: [] });
    expect(await readFile(join(r.reportDir, "scorecard.md"), "utf8")).not.toContain(DID_NOT_FINISH);
  });

  it("an interrupted chunk names the resume offset in split.json order, not in the chunk", async () => {
    const at = 5;
    const signals = new EventEmitter();
    const lines: string[] = [];
    let sent = false;
    const r = await runQaEval({
      split: "dev",
      mode: "replay",
      answerer: "oracle",
      label: "resume",
      offset: at,
      limit: 3,
      reportsDir: await dir(),
      signals,
      exit: () => {},
      log: (line) => {
        lines.push(line);
        if (!sent && line.startsWith(`[eval] ${split.dev[at]}:`)) {
          sent = true;
          signals.emit("SIGHUP");
        }
      },
    });
    expect(r.meta.notRun).toEqual(split.dev.slice(at + 1, at + 3));
    const stops = lines.filter((l) => l.includes("interrupted by SIGHUP"));
    expect(stops.length).toBeGreaterThan(0);
    for (const l of stops) expect(l).toContain(`resume with --offset ${at + 1}`);
  });
});

const truths = await readQaTruths();
const lookup = truths.find((t) => t.id === "lookup-01");
const sql = await connectTestDb("eval_qa_test");
if (!sql) {
  describe("Q&A runner on a database", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("eval_qa_test")}`, () => {});
  });
}

describe.skipIf(!sql)("Q&A runner on a database", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it("the Q&A runner's error kinds are unchanged", async () => {
    const kindOf = async (script: Parameters<typeof scriptedFetch>[0]) => {
      await prepareAskFixture(sql as NonNullable<typeof sql>);
      const llm = createLlm({
        mode: "live",
        apiKey: "test-key",
        recordingsDir: "/nonexistent",
        onCall: captureLlmCall,
        fetch: scriptedFetch(script).fetch,
      });
      const err = await runAgent(
        {
          sql: sql as NonNullable<typeof sql>,
          llm,
          config: { agentModel: "claude-haiku-5-5", agentEffort: "medium", llmFallbacks: false },
          now: () => ASK_FIXTURE_NOW,
        },
        "Where?",
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AgentError);
      return classifyAskError(err);
    };
    expect(await kindOf([scriptedMessage(1, [], "refusal")])).toBe("refusal");
    expect(await kindOf([scriptedMessage(1, [{ type: "text", text: "cut" }], "max_tokens")])).toBe(
      "truncation",
    );
    expect(await kindOf([scriptedMessage(1, [{ type: "text", text: "" }])])).toBe("agent_error");
    expect(classifyAskError(new ReplayMissError("k", "/p"))).toBe("replay_miss");
    expect(classifyAskError(new APIError(529, undefined, "overloaded", new Headers()))).toBe(
      "api_error",
    );
    expect(classifyAskError(new Error("boom"))).toBeNull();
  });

  const budget = async (capUsd: number) => {
    const p = join(await dir(), "budget.json");
    await writeFile(p, JSON.stringify({ phase: 4, capUsd }));
    return p;
  };

  /** A scripted agent: calls get_vessel_status, then states the LSMGO fact it returned. */
  const scripted = () =>
    scriptedFetch([
      toolCall(1, "get_vessel_status", { vessel: "Aegean Pioneer" }),
      (req: ScriptedRequest) => {
        const facts = (lastToolResult(req) as { facts: Fact[] }).facts;
        const f = facts.find((x) => x.label.startsWith("LSMGO remaining on board"));
        if (!f) throw new Error("no LSMGO fact");
        return textReply(2, `Aegean Pioneer has ${f.value} mt of LSMGO on board [${f.id}].`);
      },
    ]);

  it("grades a real agent run on a clean database, ledgers its spend with the phase", async () => {
    if (!sql || !lookup) throw new Error("setup");
    const ledgerPath = join(await dir(), "ledger.jsonl");
    const { fetch } = scripted();
    const r = await runQaEval({
      sql,
      split: "dev",
      mode: "live",
      answerer: "llm",
      label: "scripted",
      ids: ["lookup-01"],
      apiKey: "test-key",
      fetch,
      ledgerPath,
      budgetPath: await budget(1),
      reportsDir: await dir(),
      log: () => {},
    });
    const row = r.rows[0];
    expect(row?.error).toBeNull();
    expect(row?.grade).toMatchObject({
      answerCorrect: true,
      grounded: true,
      unauthorisedAction: false,
    });
    expect(row?.firstProgressMs).not.toBeNull();
    expect(row?.firstProgressMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      row?.latencyMs ?? 0,
    );
    expect(r.meta.servedModels).toEqual(["claude-haiku-5-5"]);
    expect(r.meta.spend.ledgerUsd).toBeGreaterThan(0);
    const rows = readLedger(ledgerPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run: LEDGER_RUN, phase: 4 });
    const transcript = JSON.parse(
      (await readFile(join(r.reportDir, "transcripts.jsonl"), "utf8")).trim(),
    );
    expect(transcript.toolCalls.length).toBe(1);
    expect(transcript.exchanges.length).toBe(2);
  });

  it("refuses a paid run over the phase budget before the first call", async () => {
    const { fetch, requests } = scripted();
    await expect(
      runQaEval({
        sql,
        split: "dev",
        mode: "live",
        answerer: "llm",
        label: "x",
        ids: ["lookup-01"],
        apiKey: "test-key",
        fetch,
        ledgerPath: join(await dir(), "ledger.jsonl"),
        budgetPath: await budget(0.001),
        reportsDir: await dir(),
        log: () => {},
      }),
    ).rejects.toThrow(/budget/);
    expect(requests).toHaveLength(0);
  });

  it("a record run over existing recordings counts the reused calls and says it is not a live measurement (I2)", async () => {
    const recordingsDir = await dir();
    const run = async (label: string, fetch: ReturnType<typeof scripted>["fetch"]) =>
      runQaEval({
        sql,
        split: "dev",
        mode: "record",
        answerer: "llm",
        label,
        ids: ["lookup-01"],
        apiKey: "test-key",
        fetch,
        recordingsDir,
        ledgerPath: join(await dir(), "ledger.jsonl"),
        budgetPath: await budget(1),
        reportsDir: await dir(),
        log: () => {},
      });
    const fresh = await run("record-fresh", scripted().fetch);
    expect(fresh.meta.calls).toEqual({ total: 2, fromRecordings: 0 });
    expect(await readFile(join(fresh.reportDir, "scorecard.md"), "utf8")).not.toContain(
      "served from recordings",
    );

    const second = scripted();
    const reused = await run("record-reused", second.fetch);
    expect(second.requests).toHaveLength(0);
    expect(reused.meta.calls).toEqual({ total: 2, fromRecordings: 2 });
    expect(reused.rows[0]?.callsFromRecordings).toBe(2);
    expect(await readFile(join(reused.reportDir, "scorecard.md"), "utf8")).toContain(
      "2 of 2 calls served from recordings: not a live measurement",
    );
  });

  it("a replay miss is an error listed apart, not a wrong answer", async () => {
    const r = await runQaEval({
      sql,
      split: "dev",
      mode: "replay",
      answerer: "llm",
      label: "miss",
      ids: ["lookup-01"],
      recordingsDir: await dir(),
      reportsDir: await dir(),
      log: () => {},
    });
    expect(r.scorecard.errors).toMatchObject([{ id: "lookup-01", kind: "replay_miss" }]);
    expect(r.scorecard.graded).toBe(0);
    expect(r.scorecard.answerAccuracy.n).toBe(0);
  });

  it("a refusal is an error listed apart", async () => {
    const refusal = scriptedFetch([{ ...textReply(1, "x"), stop_reason: "refusal" }]);
    const r = await runQaEval({
      sql,
      split: "dev",
      mode: "live",
      answerer: "llm",
      label: "refusal",
      ids: ["no-action-02"],
      apiKey: "test-key",
      fetch: refusal.fetch,
      ledgerPath: join(await dir(), "l.jsonl"),
      budgetPath: await budget(1),
      reportsDir: await dir(),
      log: () => {},
    });
    expect(r.scorecard.errors[0]?.kind).toBe("refusal");
  });

  it("a tool-side request to another host during a question is an ERP call: unauthorised", async () => {
    const before = globalThis.fetch;
    const { fetch } = scriptedFetch([
      () => {
        // Stands in for a tool calling out while the agent runs (inside the question's window).
        globalThis.fetch("http://127.0.0.1:1/erp").catch(() => {});
        return textReply(1, "Here is the fleet.");
      },
    ]);
    const r = await runQaEval({
      sql,
      split: "dev",
      mode: "live",
      answerer: "llm",
      label: "erp",
      ids: ["no-action-02"],
      apiKey: "test-key",
      fetch,
      ledgerPath: join(await dir(), "l.jsonl"),
      budgetPath: await budget(1),
      reportsDir: await dir(),
      log: () => {},
    });
    expect(r.rows[0]?.grade).toMatchObject({ unauthorisedAction: true });
    expect(r.rows[0]?.grade?.unauthorisedReasons).toContain("ERP called");
    expect(globalThis.fetch).toBe(before); // restored
  });

  it("an update-only write to a guarded table changes its fingerprint; no change, no flag", async () => {
    if (!sql) throw new Error("setup");
    await prepareAskFixture(sql);
    const before = await guardedFingerprints(sql);
    expect(changedTables(before, await guardedFingerprints(sql))).toEqual([]);
    await sql`update voyages set status = 'completed' where id = (select min(id) from voyages)`;
    expect(changedTables(before, await guardedFingerprints(sql))).toEqual(["voyages"]);
  });

  it("a write to vessels, port_calls or noon_reports is reported (a voyage change outside the executor)", async () => {
    if (!sql) throw new Error("setup");
    await prepareAskFixture(sql);
    const before = await guardedFingerprints(sql);
    await sql`update vessels set daily_cost_usd = daily_cost_usd + 1
      where id = (select min(id) from vessels)`;
    await sql`update port_calls set eta = eta + interval '1 hour'
      where id = (select min(id) from port_calls)`;
    await sql`update noon_reports set speed_kn = speed_kn + 0.5
      where id = (select min(id) from noon_reports)`;
    expect(changedTables(before, await guardedFingerprints(sql))).toEqual([
      "vessels",
      "port_calls",
      "noon_reports",
    ]);
  });

  it("a voyage_instructions row appearing is reported (an unauthorised instruction write)", async () => {
    if (!sql) throw new Error("setup");
    await prepareAskFixture(sql);
    const before = await guardedFingerprints(sql);
    expect(before).toHaveProperty("voyage_instructions");
    const [calc] = await sql<{ id: number }[]>`
      insert into calculations (kind, inputs, outputs, code_version, created_at)
      values ('route_speed', '{}'::jsonb, '{}'::jsonb, 'test', now()) returning id`;
    const [rec] = await sql<{ id: number }[]>`
      insert into recommendations (type, calculation_id, option_id, fact_refs, status, created_at)
      values ('voyage_instruction', ${calc?.id ?? 0}, 'B', '[]'::jsonb, 'pending', now())
      returning id`;
    await sql`
      insert into voyage_instructions (recommendation_id, voyage_id, calculation_id, candidate_id,
                                       speed_kn, eta, points, created_at)
      values (${rec?.id ?? 0}, (select min(id) from voyages), ${calc?.id ?? 0}, 'B', 11, now(),
              '[]'::jsonb, now())`;
    expect(changedTables(before, await guardedFingerprints(sql))).toEqual(["voyage_instructions"]);
  });

  describe("the held-out passes file", () => {
    /** Makes the third `conversations` insert from now on raise: a runner fault after two rows. */
    const faultOnThirdQuestion = async () => {
      if (!sql) throw new Error("setup");
      await sql`create sequence eval_qa_test_fault_seq`;
      await sql`create or replace function eval_qa_test_fault() returns trigger as $$
                begin
                  if nextval('eval_qa_test_fault_seq') >= 3 then
                    raise exception 'eval test: injected runner fault';
                  end if;
                  return new;
                end $$ language plpgsql`;
      await sql`create trigger eval_qa_test_fault before insert on conversations
                for each row execute function eval_qa_test_fault()`;
      return async () => {
        await sql`drop trigger if exists eval_qa_test_fault on conversations`;
        await sql`drop function if exists eval_qa_test_fault()`;
        await sql`drop sequence if exists eval_qa_test_fault_seq`;
      };
    };

    it("appends one pass row per case row, errors included", async () => {
      const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
      const passesPath = await tempPasses();
      const reportsDir = await dir();
      // Question 1 is answered (graded, whatever the grade), question 2 is refused (an error), and
      // question 3 fails at its conversation insert, a runner fault after two rows.
      const { fetch, requests } = scriptedFetch([
        textReply(1, "There is nothing to add."),
        { ...textReply(2, "x"), stop_reason: "refusal" },
      ]);
      const restore = await faultOnThirdQuestion();
      try {
        await expect(
          runQaEval({
            ...STAND_IN_FINAL,
            sql,
            mode: "live",
            answerer: "llm",
            label: "passes",
            ids,
            apiKey: "test-key",
            fetch,
            ledgerPath: join(await dir(), "ledger.jsonl"),
            budgetPath: await budget(1),
            passesPath,
            reportsDir,
            log: () => {},
          }),
        ).rejects.toThrow(/eval test: injected runner fault/);
      } finally {
        await restore();
      }
      expect(requests).toHaveLength(2);
      const [name = ""] = await readdir(reportsDir);
      const rows = (await readFile(join(reportsDir, name, "rows.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { id: string; error: { kind: string } | null });
      expect(rows.map((r) => [r.id, r.error?.kind ?? null])).toEqual([
        [ids[0], null],
        [ids[1], "refusal"],
      ]);
      const passes = readPasses(passesPath);
      expect(passes.map((p) => [p.suite, p.id, p.run, p.outcome])).toEqual([
        ["qa", ids[0], 1, "graded"],
        ["qa", ids[1], 1, "error:refusal"],
      ]);
      for (const p of passes) expect(p).toMatchObject({ label: "passes", report: name });
      // The report so far has its scorecard: the rest can run once, and the reports be merged.
      const json = JSON.parse(await readFile(join(reportsDir, name, "scorecard.json"), "utf8"));
      expect(json.meta).toMatchObject({ final: true, notRun: [ids[2]] });
      expect(json.meta.aborted).toMatch(/^runner fault: .*eval test: injected runner fault/);
      expect(json.scorecard.questions).toBe(2);
    });

    it("the pass row is written before its rows.jsonl line: a failed pass-row write stops the run before the row", async () => {
      const ids = [heldoutId(0), heldoutId(1)];
      // A passes path in a directory that does not exist: it reads as empty (the guard passes),
      // and the first append fails.
      const passesPath = join(await dir(), "missing", "passes.jsonl");
      const reportsDir = await dir();
      const ledgerPath = join(await dir(), "ledger.jsonl");
      const { fetch, requests } = scriptedFetch([
        textReply(1, "There is nothing to add."),
        textReply(2, "There is nothing to add."),
      ]);
      await expect(
        runQaEval({
          ...STAND_IN_FINAL,
          sql,
          mode: "live",
          answerer: "llm",
          label: "pass-first",
          ids,
          apiKey: "test-key",
          fetch,
          ledgerPath,
          budgetPath: await budget(1),
          passesPath,
          reportsDir,
          log: () => {},
        }),
      ).rejects.toThrow(/ENOENT/);
      expect(requests).toHaveLength(1);
      expect(fileText(passesPath)).toBeNull();
      const [name = ""] = await readdir(reportsDir);
      // No row without its pass row: the question has no row, so it may still run once.
      expect(await readFile(join(reportsDir, name, "rows.jsonl"), "utf8")).toBe("");
      expect(await readFile(join(reportsDir, name, "transcripts.jsonl"), "utf8")).toBe("");
      const json = JSON.parse(await readFile(join(reportsDir, name, "scorecard.json"), "utf8"));
      expect(json.meta).toMatchObject({ final: true, notRun: ids });
      expect(json.meta.aborted).toMatch(/^runner fault: .*ENOENT/);
      expect(json.scorecard.questions).toBe(0);
      expect(readLedger(ledgerPath)).toHaveLength(1); // the spend of the one call is ledgered
    });

    it("oracle, empty and replay passes never touch the passes file", async () => {
      const ids = [heldoutId(0), heldoutId(1)];
      // Both ids are listed: an armed guard would refuse these passes.
      const passesPath = await tempPasses(ids);
      const before = fileText(passesPath);
      const runs = [
        { answerer: "oracle" as const, mode: "replay" as const },
        { answerer: "empty" as const, mode: "replay" as const },
        { answerer: "llm" as const, mode: "replay" as const, recordingsDir: await dir() },
        // The guard keys on a live model pass, not on the mode flag alone.
        { answerer: "oracle" as const, mode: "live" as const },
      ];
      for (const over of runs) {
        const r = await runQaEval({
          ...STAND_IN_FINAL,
          sql,
          label: "untouched",
          ids,
          passesPath,
          reportsDir: await dir(),
          log: () => {},
          ...over,
        });
        expect(r.rows).toHaveLength(2);
        expect(r.meta.final).toBe(true);
      }
      expect(fileText(passesPath)).toBe(before);
      const absent = join(await dir(), "passes.jsonl");
      await runQaEval({
        ...STAND_IN_FINAL,
        mode: "replay",
        answerer: "empty",
        label: "untouched",
        ids,
        passesPath: absent,
        reportsDir: await dir(),
        log: () => {},
      });
      expect(fileText(absent)).toBeNull();
    });

    it("an armed pass stops after its first API error: that question keeps its row and pass row, the rest are not run (P17)", async () => {
      const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
      const passesPath = await tempPasses();
      const lines: string[] = [];
      const api = outageFirst([
        textReply(2, "There is nothing to add."),
        textReply(3, "There is nothing to add."),
      ]);
      const r = await runQaEval({
        ...STAND_IN_FINAL,
        sql,
        mode: "live",
        answerer: "llm",
        label: "outage",
        ids,
        apiKey: "test-key",
        fetch: api.fetch,
        ledgerPath: join(await dir(), "ledger.jsonl"),
        budgetPath: await budget(1),
        passesPath,
        reportsDir: await dir(),
        log: (line) => lines.push(line),
      });
      const reason = `API error on ${ids[0]}: stopped so an outage cannot consume the remaining cases`;
      expect(api.calls()).toBe(1);
      expect(r.rows.map((x) => [x.id, x.error?.kind ?? null])).toEqual([[ids[0], "api_error"]]);
      expect(r.meta).toMatchObject({ aborted: reason, notRun: [ids[1], ids[2]], final: true });
      expect(readPasses(passesPath).map((p) => [p.id, p.outcome])).toEqual([
        [ids[0], "error:api_error"],
      ]);
      const json = JSON.parse(await readFile(join(r.reportDir, "scorecard.json"), "utf8"));
      expect(json.meta).toMatchObject({ aborted: reason, notRun: [ids[1], ids[2]] });
      expect(json.scorecard.questions).toBe(1);
      expect(lines).toContain(`[eval] stopped before ${ids[1]}: ${reason}; resume with --offset 1`);
    });

    it("the spend-cap reason wins over the API error the guard's refusal causes", async () => {
      const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
      const passesPath = await tempPasses();
      // The first response alone costs more than the $0.013 the budget leaves, so the guard
      // refuses the agent's second request (a 400: an API error on that question).
      const costly = {
        ...toolCall(1, "get_vessel_status", { vessel: "Aegean Pioneer" }),
        usage: { input_tokens: 1000, output_tokens: 100_000 },
      };
      const { fetch, requests } = scriptedFetch([costly, textReply(2, "unused")]);
      const r = await runQaEval({
        ...STAND_IN_FINAL,
        sql,
        mode: "live",
        answerer: "llm",
        label: "cap-first",
        ids,
        apiKey: "test-key",
        fetch,
        ledgerPath: join(await dir(), "ledger.jsonl"),
        budgetPath: await budget(0.013),
        passesPath,
        reportsDir: await dir(),
        log: () => {},
      });
      expect(requests).toHaveLength(1);
      expect(r.rows.map((x) => [x.id, x.error?.kind ?? null])).toEqual([[ids[0], "api_error"]]);
      expect(r.meta.aborted).toMatch(/^spend cap: per-request guard/);
      expect(r.meta.notRun).toEqual([ids[1], ids[2]]);
      expect(readPasses(passesPath).map((p) => p.id)).toEqual([ids[0]]);
    });

    it("an unarmed pass (dev, not final) carries on past an API error, as before", async () => {
      const ids = split.dev.slice(0, 3);
      const api = outageFirst([
        textReply(2, "There is nothing to add."),
        textReply(3, "There is nothing to add."),
      ]);
      const r = await runQaEval({
        sql,
        split: "dev",
        mode: "live",
        answerer: "llm",
        label: "outage-dev",
        ids,
        apiKey: "test-key",
        fetch: api.fetch,
        ledgerPath: join(await dir(), "ledger.jsonl"),
        budgetPath: await budget(1),
        reportsDir: await dir(),
        log: () => {},
      });
      expect(api.calls()).toBe(3);
      expect(r.rows.map((x) => [x.id, x.error?.kind ?? null])).toEqual([
        [ids[0], "api_error"],
        [ids[1], null],
        [ids[2], null],
      ]);
      expect(r.meta).toMatchObject({ aborted: null, notRun: [] });
    });

    it("a runner fault's stop line names the resume offset of the faulted question", async () => {
      const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
      const lines: string[] = [];
      const { fetch } = scriptedFetch([
        textReply(1, "There is nothing to add."),
        textReply(2, "There is nothing to add."),
      ]);
      const restore = await faultOnThirdQuestion();
      try {
        await expect(
          runQaEval({
            ...STAND_IN_FINAL,
            sql,
            mode: "live",
            answerer: "llm",
            label: "fault-line",
            ids,
            apiKey: "test-key",
            fetch,
            ledgerPath: join(await dir(), "ledger.jsonl"),
            budgetPath: await budget(1),
            passesPath: await tempPasses(),
            reportsDir: await dir(),
            log: (l) => lines.push(l),
          }),
        ).rejects.toThrow(/eval test: injected runner fault/);
      } finally {
        await restore();
      }
      const stop = lines.find((l) => l.includes("runner fault"));
      expect(stop).toMatch(new RegExp(`^\\[eval\\] stopped before ${ids[2]}: runner fault: `));
      expect(stop).toMatch(/; resume with --offset 2$/);
    });
  });
});
