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
import { prepareAskFixture } from "../../apps/api/src/ask/demo-fixture.js";
import { readLedger } from "../lib/budget.js";
import {
  changedTables,
  ESTIMATE_PER_QUESTION_USD,
  guardedFingerprints,
  LEDGER_RUN,
  parseArgs,
  RUN_CAP_USD,
  runQaEval,
  selectQuestions,
} from "./run.js";
import { readQaTruths } from "./split.js";

const dir = () => mkdtemp(join(tmpdir(), "qa-run-"));
const split = JSON.parse(
  await readFile(new URL("../golden/qa/split.json", import.meta.url), "utf8"),
) as { dev: string[]; heldout: string[] };

describe("the per-question estimate", () => {
  it("is $0.004: the 31 dev questions estimate $0.124, under the $0.25 pass cap", () => {
    expect(ESTIMATE_PER_QUESTION_USD).toBe(0.004);
    expect(split.dev).toHaveLength(31);
    expect(split.dev.length * ESTIMATE_PER_QUESTION_USD).toBeCloseTo(0.124, 9);
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
});
