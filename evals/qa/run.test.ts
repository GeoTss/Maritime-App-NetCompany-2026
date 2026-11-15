/** The Q&A runner: argument refusals, the oracle and empty dry runs, and runs on a real database. */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import type { Fact } from "@pharos/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  lastToolResult,
  type ScriptedRequest,
  scriptedFetch,
  textReply,
  toolCall,
} from "../../apps/api/src/ai/scripted-llm.js";
import { readLedger } from "../lib/budget.js";
import { LEDGER_RUN, parseArgs, runQaEval, selectQuestions } from "./run.js";
import { readQaTruths } from "./split.js";

const dir = () => mkdtemp(join(tmpdir(), "qa-run-"));
const split = JSON.parse(
  await readFile(new URL("../golden/qa/split.json", import.meta.url), "utf8"),
) as { dev: string[]; heldout: string[] };

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
});
