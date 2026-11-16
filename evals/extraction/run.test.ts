/** The extraction runner: argument refusals, spend refusals and dry runs on a real database. */
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { APIConnectionError } from "@anthropic-ai/sdk";
import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { ExtractionTruth } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ExtractionError, renderEmailDocument } from "../../apps/api/src/ai/extract.js";
import { type LlmFetch, ReplayMissError } from "../../apps/api/src/ai/llm.js";
import { costUsd, promptTokensOf } from "../../apps/api/src/ai/pricing.js";
import { scriptedFetch, scriptedMessage, textReply } from "../../apps/api/src/ai/scripted-llm.js";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import { BudgetError, HAIKU, ModelNotAllowedError, readLedger } from "../lib/budget.js";
import { appendPass, HeldoutRerunError, readPasses } from "../lib/heldout-passes.js";
import {
  assertPassEstimate,
  capturing,
  classifyExtractError,
  EMPTY_EXTRACTION,
  ESTIMATE_PER_CASE_RUN_USD,
  EVAL_RUN_LOCK,
  type EvalOptions,
  type Exchange,
  INTERRUPT_EXIT,
  LEDGER_RUN,
  parseArgs,
  RUN_CAP_USD,
  runExtractionEval,
  selectCases,
} from "./run.js";
import { GOLDEN_DIR } from "./split.js";

const sql = await connectTestDb("eval_extraction_test");
/** A second pool for this file's own lock (concurrent runs of this file take turns). */
const lockPool = sql ? await connectTestDb("eval_extraction_test") : null;
const FILE_LOCK = 2026111411;

// Cases and expectations come from the golden files on disk, never from copies of their content.
const SPLIT = JSON.parse(await readFile(join(GOLDEN_DIR, "split.json"), "utf8")) as {
  dev: string[];
  heldout: string[];
};
/**
 * The held-out split's size and hard count, for the per-pass estimate of the planned final pass
 * (only the split and each truth's tags are read; no held-out case is run by this file).
 */
const HELDOUT = SPLIT.heldout;
const HELDOUT_HARD = (
  await Promise.all(
    HELDOUT.map(async (id) =>
      ExtractionTruth.parse(
        JSON.parse(await readFile(join(GOLDEN_DIR, `${id}.truth.json`), "utf8")),
      ),
    ),
  )
).filter((t) => t.tags[0] === "hard").length;
/** A passes file in a temp directory, with these rows already in it (or none: no file yet). */
const tempPasses = async (ids: string[] = []) => {
  const path = join(await mkdtemp(join(tmpdir(), "eval-extraction-passes-")), "passes.jsonl");
  for (const id of ids) {
    appendPass(
      {
        suite: "extraction",
        id,
        run: 1,
        at: "2026-11-16T10:00:00.000Z",
        label: "earlier",
        report: "20261116T100000Z-extraction-heldout-earlier",
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
const TRUTH = new Map<string, ExtractionTruth>();
for (const id of SPLIT.dev) {
  const text = await readFile(join(GOLDEN_DIR, `${id}.truth.json`), "utf8");
  TRUTH.set(id, ExtractionTruth.parse(JSON.parse(text)));
}
const truthOf = (id: string): ExtractionTruth => {
  const t = TRUTH.get(id);
  if (!t) throw new Error(`no dev truth ${id}`);
  return t;
};
/** Dev ids by stratum (tags[0]), in split order. */
const STRATA = new Map<string, string[]>();
for (const id of SPLIT.dev) {
  const stratum = truthOf(id).tags[0] ?? "";
  STRATA.set(stratum, [...(STRATA.get(stratum) ?? []), id]);
}
const firstOf = (stratum: string): string => {
  const id = STRATA.get(stratum)?.[0];
  if (!id) throw new Error(`no dev case in stratum ${stratum}`);
  return id;
};
/** A truth-needs_review dev case (a hard one if there is one). */
const REVIEW_CASE =
  SPLIT.dev.find((id) => truthOf(id).expected.status === "needs_review") ?? firstOf("hard");

/**
 * A stand-in golden directory whose "heldout" split is three dev cases (their files copied): the
 * passes-file tests run the final held-out path without running a real held-out case.
 */
const STAND_IN = await (async () => {
  const dir = await mkdtemp(join(tmpdir(), "eval-extraction-golden-"));
  const ids = [firstOf("eur"), firstOf("plain"), firstOf("not_a_quote")];
  for (const id of ids) {
    for (const ext of [".truth.json", ".eml", ".oracle.json"]) {
      await copyFile(join(GOLDEN_DIR, `${id}${ext}`), join(dir, `${id}${ext}`));
    }
  }
  await writeFile(join(dir, "split.json"), JSON.stringify({ dev: [], heldout: ids }));
  return { dir, ids };
})();
const heldoutId = (i: number): string => {
  const id = STAND_IN.ids[i];
  if (!id) throw new Error(`no stand-in held-out case at ${i}`);
  return id;
};
/** A final pass of the stand-in held-out split. */
const STAND_IN_FINAL = { split: "heldout" as const, final: true, goldenDir: STAND_IN.dir };

/** Ten dev cases round-robin across the strata, hard first, so hard cases appear twice. */
const TEN_DEV: string[] = (() => {
  const order = ["hard", ...[...STRATA.keys()].filter((k) => k !== "hard").sort()];
  const picked: string[] = [];
  for (let round = 0; picked.length < 10; round++) {
    for (const stratum of order) {
      const id = STRATA.get(stratum)?.[round];
      if (id && picked.length < 10) picked.push(id);
    }
  }
  return picked;
})();
/** Critical-field instances of a set of cases: six per truth quote plus three per line. */
const criticalInstances = (ids: string[]) =>
  ids.reduce((n, id) => {
    const q = truthOf(id).expected.quote;
    return truthOf(id).expected.kind === "quote" && q ? n + 6 + 3 * q.lines.length : n;
  }, 0);
const reviewCount = (ids: string[]) =>
  ids.filter((id) => truthOf(id).expected.status === "needs_review").length;

/** A database that fails the test if anything touches it. */
const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("the database was used");
    },
  },
) as unknown as Sql;

/** The phase-4 budget file every paid test runs under (cap $3), never the real evals/budget.json. */
const BUDGET = join(mkdtempSync(join(tmpdir(), "eval-extraction-budget-")), "budget.json");
writeFileSync(BUDGET, JSON.stringify({ phase: 4, capUsd: 3 }));
const runEval = (opts: EvalOptions) => runExtractionEval({ budgetPath: BUDGET, ...opts });

const temp = (prefix: string) => mkdtemp(join(tmpdir(), `eval-extraction-${prefix}-`));
const tempLedger = async (totalUsd: number) => {
  const path = join(await temp("ledger"), "ledger.jsonl");
  await writeFile(
    path,
    `${JSON.stringify({ at: "2026-11-14T10:00:00Z", run: "earlier", label: "x", costUsd: totalUsd, phase: 4 })}\n`,
  );
  return path;
};
const networkForbidden = () =>
  vi.fn<LlmFetch>(async () => {
    throw new Error("the network was used");
  });

describe("parseArgs", () => {
  it("defaults to the dev split, replay, label = mode", () => {
    expect(parseArgs(["--suite", "extraction", "--mode", "replay"])).toEqual({
      suite: "extraction",
      split: "dev",
      mode: "replay",
      extractor: "llm",
      repeatHard: 1,
      label: "replay",
      limit: null,
      offset: 0,
      final: false,
    });
    expect(parseArgs(["--oracle", "--limit", "10"])).toMatchObject({
      extractor: "oracle",
      label: "oracle",
      limit: 10,
    });
  });

  it("refuses the held-out split without --final", () => {
    expect(() => parseArgs(["--split", "heldout", "--mode", "replay"])).toThrow(/--final/);
    expect(parseArgs(["--split", "heldout", "--mode", "replay", "--final"]).split).toBe("heldout");
  });

  it.each([
    [["--oracle", "--empty"], /alternatives/],
    [["--oracle", "--mode", "live"], /makes no model calls/],
    [["--mode", "record", "--repeat-hard", "3"], /reuse each hard case/],
    [["--mode", "paid"], /live, record or replay/],
    [["--suite", "qa"], /only extraction/],
    [["--repeat-hard", "0"], /whole number/],
    [["--label", "a b"], /--label/],
    [["--spilt", "heldout"], /unknown argument/],
    [["--limit"], /needs a value/],
    [["--offset", "-1"], /--offset needs a whole number >= 0/],
    [["--offset", "x"], /--offset needs a whole number >= 0/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it("allows --repeat-hard in live mode", () => {
    expect(parseArgs(["--mode", "live", "--repeat-hard", "3"]).repeatHard).toBe(3);
  });

  it("parses --offset (0 allowed) beside --limit", () => {
    expect(parseArgs(["--oracle", "--offset", "40", "--limit", "20"])).toMatchObject({
      offset: 40,
      limit: 20,
    });
    expect(parseArgs(["--oracle", "--offset", "0"]).offset).toBe(0);
  });
});

describe("selectCases --offset / --limit (chunks of a split, in split.json order)", () => {
  it("skips the first n cases and takes the next --limit", async () => {
    expect(await selectCases("dev", { offset: 10, limit: 5 })).toEqual(SPLIT.dev.slice(10, 15));
    expect(await selectCases("dev", { offset: 60 })).toEqual(SPLIT.dev.slice(60));
    expect(await selectCases("dev", { offset: 0, limit: 3 })).toEqual(SPLIT.dev.slice(0, 3));
  });

  it("consecutive chunks cover the split exactly once", async () => {
    const chunks = [];
    for (let at = 0; at < SPLIT.dev.length; at += 30) {
      chunks.push(...(await selectCases("dev", { offset: at, limit: 30 })));
    }
    expect(chunks).toEqual(SPLIT.dev);
  });

  it("refuses an offset that leaves no case", async () => {
    await expect(selectCases("dev", { offset: SPLIT.dev.length })).rejects.toThrow(
      /--offset .* leaves no case/,
    );
  });

  // Regression suite (round 3, rr3/d.mts). The final pass is a live measurement: since Ruling 25
  // record mode is replay-first, so `--final --mode record` is refused (fix wave I2).
  it("parses a chunked final held-out live pass (arguments only; nothing runs)", () => {
    const argv = [
      "--split",
      "heldout",
      "--final",
      "--mode",
      "live",
      "--offset",
      "120",
      "--limit",
      "60",
      "--label",
      "ho-2",
    ];
    expect(parseArgs(argv)).toMatchObject({
      split: "heldout",
      final: true,
      mode: "live",
      offset: 120,
      limit: 60,
    });
    const record = argv.map((a) => (a === "live" ? "record" : a));
    expect(() => parseArgs(record)).toThrow(
      /--final is a live measurement: run it with --mode live/,
    );
  });

  it("refuses a fractional --offset", () => {
    expect(() => parseArgs(["--offset", "1.5"])).toThrow(/--offset needs a whole number >= 0/);
  });

  it("explicit ids win over --offset", async () => {
    const id = SPLIT.dev[3] ?? "";
    expect(await selectCases("dev", { ids: [id], offset: 50 })).toEqual([id]);
  });
});

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** A full garbage collection, then a macrotask so FinalizationRegistry callbacks can run. */
async function collectGarbage(): Promise<void> {
  gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("capturing (the transcript tap)", () => {
  // Node 22's fetch (undici 6.21) cancels a Response's body when a clone of it is collected. The
  // collection runs after the tap has read the body and before the caller reads it.
  it("a collection between the tap's read and the caller's leaves the body readable", async () => {
    const body = { model: HAIKU, content: [] };
    const into: Exchange[] = [];
    const f = capturing(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json", "request-id": "req_1" },
        }),
      into,
    );
    for (let i = 0; i < 3; i++) {
      const res = await f("https://api.example/v1/messages", { body: '{"model":"m"}' });
      await collectGarbage();
      expect(res.bodyUsed).toBe(false);
      expect(await res.json()).toEqual(body);
      expect(res.headers.get("request-id")).toBe("req_1");
    }
    expect(into[0]).toEqual({
      url: "https://api.example/v1/messages",
      request: { model: "m" },
      status: 200,
      response: body,
    });
  });

  it("returns an error response unread and records its status", async () => {
    const into: Exchange[] = [];
    const failed = new Response('{"type":"error"}', { status: 529 });
    expect(await capturing(async () => failed, into)("https://x/v1/messages", {})).toBe(failed);
    expect(failed.bodyUsed).toBe(false);
    expect(into[0]?.status).toBe(529);
  });
});

describe("classifyExtractError", () => {
  const metrics = (stopReason: string) => [
    {
      requestKey: "k",
      model: HAIKU,
      latencyMs: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
      stopReason,
      mode: "live" as const,
    },
  ];
  it("recognises replay misses, refusals, truncations and API errors by type", () => {
    expect(classifyExtractError(new ReplayMissError("k", "/x/k.json"))).toBe("replay_miss");
    expect(classifyExtractError(new ExtractionError("refused", metrics("refusal")))).toBe(
      "refusal",
    );
    expect(classifyExtractError(new ExtractionError("cut", metrics("max_tokens")))).toBe(
      "truncation",
    );
    expect(classifyExtractError(new APIConnectionError({ message: "Connection error." }))).toBe(
      "api_error",
    );
  });
  it("leaves an unusable output or any other failure to be graded", () => {
    expect(classifyExtractError(new ExtractionError("bad json", metrics("end_turn")))).toBeNull();
    expect(classifyExtractError(new Error("db down"))).toBeNull();
  });
});

describe("runExtractionEval refusals (before any database, network or spend)", () => {
  const base = async (over: Partial<EvalOptions>): Promise<EvalOptions> => ({
    sql: NO_DB,
    split: "dev",
    mode: "live",
    extractor: "llm",
    label: "refusal",
    ids: TEN_DEV,
    reportsDir: await temp("reports"),
    ...over,
  });

  it("refuses the held-out split without final", async () => {
    await expect(runEval(await base({ split: "heldout", mode: "replay" }))).rejects.toThrow(
      /--final/,
    );
  });

  it("refuses a final pass in record mode (record is replay-first, not a measurement)", async () => {
    const fetch = networkForbidden();
    await expect(
      runEval(
        await base({ split: "heldout", final: true, mode: "record", apiKey: "test-key", fetch }),
      ),
    ).rejects.toThrow(/--final is a live measurement/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a paid run when the ledger is near the $3 cap, without a call or a ledger row", async () => {
    const ledgerPath = await tempLedger(2.995);
    const fetch = networkForbidden();
    await expect(
      runEval(await base({ apiKey: "test-key", fetch, ledgerPath })),
    ).rejects.toBeInstanceOf(BudgetError);
    expect(fetch).not.toHaveBeenCalled();
    expect(readLedger(ledgerPath)).toHaveLength(1);
  });

  it("refuses a paid pass whose estimate exceeds the $0.25 per-pass cap, before any call (M5)", async () => {
    // 84 dev cases plus 26 hard cases x 29 repeats: 838 case runs x $0.001 > $0.25.
    const ledgerPath = await tempLedger(0);
    const fetch = networkForbidden();
    const run = runEval(
      await base({ ids: undefined, repeatHard: 30, apiKey: "test-key", fetch, ledgerPath }),
    );
    await expect(run).rejects.toBeInstanceOf(BudgetError);
    await expect(run).rejects.toThrow(/per-pass cap.*--offset.*--limit/);
    expect(fetch).not.toHaveBeenCalled();
    expect(readLedger(ledgerPath)).toHaveLength(1);
  });

  it("allows a paid pass whose estimate is at the cap (the refusal is the estimate, not the key)", async () => {
    // TEN_DEV is $0.02: it passes the per-pass check and stops at the missing key instead.
    await expect(runEval(await base({ ledgerPath: await tempLedger(0) }))).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("the dev variance pass: the largest --repeat-hard under the cap fits one pass, one more is refused", async () => {
    const all = { ids: undefined, apiKey: undefined, ledgerPath: await tempLedger(0) };
    const hard = STRATA.get("hard")?.length ?? 0;
    const runs = (r: number) => SPLIT.dev.length + hard * (r - 1);
    let fits = 1;
    while (runs(fits + 1) * ESTIMATE_PER_CASE_RUN_USD <= RUN_CAP_USD) fits++;
    expect(fits).toBeGreaterThan(2);
    // Under the cap, so it reaches the key check; one more repeat is over the cap, refused first.
    await expect(runEval(await base({ ...all, repeatHard: fits }))).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
    await expect(runEval(await base({ ...all, repeatHard: fits + 1 }))).rejects.toThrow(
      new RegExp(`${runs(fits + 1)} case runs .*per-pass cap`),
    );
  });

  it("184 case runs fit one pass at $0.001; 251 are refused", async () => {
    expect(ESTIMATE_PER_CASE_RUN_USD).toBe(0.001);
    expect(assertPassEstimate(184)).toBeCloseTo(0.184, 12);
    expect(assertPassEstimate(250)).toBeCloseTo(0.25, 12);
    expect(() => assertPassEstimate(251)).toThrow(BudgetError);
    expect(() => assertPassEstimate(251)).toThrow(/\$0\.251 \(251 case runs .*per-pass cap/);
    // The held-out pass as planned: every case once, each hard case 3 times (--repeat-hard 3).
    expect(HELDOUT.length + 2 * HELDOUT_HARD).toBe(184);
    const heldout = {
      split: "heldout" as const,
      final: true,
      ids: undefined,
      apiKey: undefined,
      ledgerPath: await tempLedger(0),
    };
    // 184 runs fit, so it reaches the key check; --repeat-hard 8 is over the cap, refused first.
    await expect(runEval(await base({ ...heldout, repeatHard: 3 }))).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
    await expect(runEval(await base({ ...heldout, repeatHard: 8 }))).rejects.toThrow(
      new RegExp(`${HELDOUT.length + 7 * HELDOUT_HARD} case runs .*per-pass cap`),
    );
  });

  it("a final live held-out pass refuses to start when a selected id is in the passes file, before any call or ledger row", async () => {
    const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
    const passesPath = await tempPasses([heldoutId(1)]);
    const before = fileText(passesPath);
    const ledgerPath = await tempLedger(0);
    const reportsDir = await temp("reports");
    const fetch = networkForbidden();
    const heldout = { ...STAND_IN_FINAL, passesPath };
    const run = runEval(
      await base({ ...heldout, ids, apiKey: "test-key", fetch, ledgerPath, reportsDir }),
    );
    await expect(run).rejects.toBeInstanceOf(HeldoutRerunError);
    await expect(run).rejects.toThrow(new RegExp(`: ${heldoutId(1)}\\b`));
    expect(fetch).not.toHaveBeenCalled();
    expect(readLedger(ledgerPath)).toHaveLength(1);
    expect(await readdir(reportsDir)).toEqual([]);
    expect(fileText(passesPath)).toBe(before);
    // Without the listed id the same pass gets as far as the key check.
    await expect(runEval(await base({ ...heldout, ids: [heldoutId(0)] }))).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("refuses a paid run without a key, naming the variable", async () => {
    await expect(runEval(await base({ ledgerPath: await tempLedger(0) }))).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

/** A scripted Anthropic API that answers each golden email with its oracle. */
async function oracleApi(
  ids: string[],
  reply: {
    model?: string;
    outputTokens?: number;
    /** Replaces the JSON message with this raw body. */
    rawBody?: string;
    /** Runs while the request is in flight, before the response is returned. */
    onRequest?: () => void;
  } = {},
) {
  const byPrompt = new Map<string, unknown>();
  for (const id of ids) {
    const email = await parseEmail(new Uint8Array(await readFile(join(GOLDEN_DIR, `${id}.eml`))));
    const prompt = renderEmailDocument({
      sender: email.sender,
      subject: email.subject,
      bodyText: email.bodyText,
    });
    byPrompt.set(prompt, JSON.parse(await readFile(join(GOLDEN_DIR, `${id}.oracle.json`), "utf8")));
  }
  const usage = { input_tokens: 1200, output_tokens: reply.outputTokens ?? 300 };
  const fetch = vi.fn<LlmFetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const oracle = byPrompt.get(body.messages[0]?.content ?? "");
    if (oracle === undefined) throw new Error("scripted API: unknown email");
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: reply.model ?? HAIKU,
      content: [{ type: "text", text: JSON.stringify({ extraction: oracle }), citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage,
    };
    reply.onRequest?.();
    return new Response(reply.rawBody ?? JSON.stringify(message), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, costPerCall: costUsd(HAIKU, usage, promptTokensOf(usage)) };
}

if (!sql) {
  describe("extraction runner (database)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("eval_extraction_test")}`, () => {});
  });
}

describe.skipIf(!sql)("extraction runner (database)", () => {
  if (!sql || !lockPool) return;
  const db = sql;
  const pool = lockPool;
  let held: Awaited<ReturnType<Sql["reserve"]>> | null = null;
  beforeAll(async () => {
    held = await pool.reserve();
    await held`select pg_advisory_lock(${FILE_LOCK}::bigint)`;
  }, 300_000);
  afterAll(async () => {
    if (held) {
      await held`select pg_advisory_unlock(${FILE_LOCK}::bigint)`;
      held.release();
    }
    await pool.end();
    await db.end();
  });
  const dry = async (over: Partial<EvalOptions>) =>
    runEval({
      sql: db,
      split: "dev",
      mode: "replay",
      extractor: "oracle",
      label: "dry",
      ids: TEN_DEV,
      reportsDir: await temp("reports"),
      fetch: networkForbidden(),
      log: () => {},
      ...over,
    });

  it("oracle dry run over 10 dev cases: 100 % critical-field accuracy, 0 unsafe, no key or network", async () => {
    const fetch = networkForbidden();
    const r = await dry({ fetch, label: "oracle" });
    const card = r.scorecard;
    expect(fetch).not.toHaveBeenCalled();
    expect(card.graded).toBe(10);
    expect(card.errors).toEqual([]);
    expect(card.critical.rate).toBe(1);
    expect(card.critical.n).toBe(criticalInstances(TEN_DEV));
    expect(card.unsafeAutoAccepts).toMatchObject({ k: 0, n: 10 });
    expect(card.falseReview.k).toBe(0);
    const reviews = reviewCount(TEN_DEV);
    expect(reviews).toBeGreaterThan(0);
    expect(card.needsReviewRecall).toMatchObject({ k: reviews, n: reviews });
    expect(card.reviewCheckMatched).toMatchObject({ k: reviews, n: reviews });
    expect(card.kind.quoteRecall.rate).toBe(1);
    expect(card.kind.notAQuoteRecall.rate).toBe(1);
    for (const f of Object.values(card.fields)) expect(f.rate).toBe(1);
    // Every case's status is the truth's: the oracle through the pipeline reproduces the truth.
    for (const row of r.rows) expect(row.status).toBe(row.grade.truthStatus);
    expect(r.meta).toMatchObject({ mode: "oracle", model: null, servedModels: [] });
    expect(r.meta.spend).toEqual({ guardUsd: null, dbUsd: 0, ledgerUsd: null, parseErrors: [] });

    const files = (await readdir(r.reportDir)).sort();
    expect(files).toEqual(["rows.jsonl", "scorecard.json", "scorecard.md", "transcripts.jsonl"]);
    expect(r.reportDir).toMatch(/\d{8}T\d{6}Z-extraction-dev-oracle$/);
    const rows = (await readFile(join(r.reportDir, "rows.jsonl"), "utf8")).trim().split("\n");
    expect(rows.map((l) => JSON.parse(l).id)).toEqual(TEN_DEV);
    const json = JSON.parse(await readFile(join(r.reportDir, "scorecard.json"), "utf8"));
    expect(json.scorecard.critical).toEqual(card.critical);
    const md = await readFile(join(r.reportDir, "scorecard.md"), "utf8");
    expect(md).toContain(
      `| Critical-field accuracy | ${card.critical.n}/${card.critical.n} | 100.0 % |`,
    );
  }, 120_000);

  it("--offset with --limit runs exactly that chunk of the split", async () => {
    const at = SPLIT.dev.length - 2;
    const r = await dry({ ids: undefined, offset: at, limit: 5, label: "chunk" });
    expect(r.rows.map((x) => x.id)).toEqual(SPLIT.dev.slice(at));
    expect(r.meta).toMatchObject({ selected: 2, offset: at, limit: 5 });
  }, 120_000);

  it("leaves the seed intact and nothing of the cases behind", async () => {
    await dry({ ids: [firstOf("eur"), firstOf("plain")], label: "hygiene" });
    const [c] = await db<{ documents: number; case_quotes: number; seed_quotes: number }[]>`
      select (select count(*)::int from documents) as documents,
             (select count(*)::int from quotes where extraction_id is not null) as case_quotes,
             (select count(*)::int from quotes where extraction_id is null) as seed_quotes`;
    expect(c).toMatchObject({ documents: 0, case_quotes: 0 });
    expect(c?.seed_quotes).toBeGreaterThan(0);
  }, 120_000);

  it("empty dry run: critical-field accuracy at most 2 %, nothing auto-accepted", async () => {
    const r = await dry({ extractor: "empty", label: "empty" });
    expect(r.scorecard.critical.rate).toBeLessThanOrEqual(0.02);
    expect(r.scorecard.unsafeAutoAccepts.k).toBe(0);
    expect(r.scorecard.reviewQueue).toMatchObject({ k: 10, n: 10 });
  }, 120_000);

  it("replay misses are listed as errors and excluded from accuracy", async () => {
    const r = await dry({
      extractor: "llm",
      mode: "replay",
      label: "miss",
      ids: [firstOf("eur"), firstOf("not_a_quote")],
      recordingsDir: await temp("no-recordings"),
    });
    expect(r.scorecard.errors.map((e) => [e.id, e.kind])).toEqual([
      [firstOf("eur"), "replay_miss"],
      [firstOf("not_a_quote"), "replay_miss"],
    ]);
    expect(r.scorecard.graded).toBe(0);
    expect(r.scorecard.critical.n).toBe(0);
    expect(r.rows.map((x) => x.status)).toEqual(["failed", "failed"]);
  }, 120_000);

  it("record then replay: replay reproduces the record run's scorecard; record is ledgered", async () => {
    const ids = [firstOf("eur"), REVIEW_CASE, firstOf("not_a_quote")];
    const api = await oracleApi(ids);
    const recordingsDir = await temp("recordings");
    const ledgerPath = await tempLedger(0);
    const recorded = await dry({
      extractor: "llm",
      mode: "record",
      label: "record",
      ids,
      apiKey: "test-key",
      fetch: api.fetch,
      recordingsDir,
      ledgerPath,
    });
    expect(api.fetch).toHaveBeenCalledTimes(3);
    expect(recorded.scorecard.errors).toEqual([]);
    expect(recorded.scorecard.critical.rate).toBe(1);
    expect(recorded.meta.servedModels).toEqual([HAIKU]);
    const ledger = readLedger(ledgerPath);
    expect(ledger.at(-1)).toMatchObject({ run: LEDGER_RUN, label: "record" });
    expect(ledger.at(-1)?.costUsd).toBeCloseTo(api.costPerCall * 3, 12);
    expect(recorded.meta.spend.ledgerUsd).toBeCloseTo(api.costPerCall * 3, 12);
    const transcript = JSON.parse(
      (await readFile(join(recorded.reportDir, "transcripts.jsonl"), "utf8")).split("\n")[0] ?? "",
    );
    expect(transcript.exchanges).toHaveLength(1);
    expect(transcript.exchanges[0].response.model).toBe(HAIKU);

    const network = networkForbidden();
    const replayed = await dry({
      extractor: "llm",
      mode: "replay",
      label: "replay",
      ids,
      fetch: network,
      recordingsDir,
      ledgerPath,
    });
    expect(network).not.toHaveBeenCalled();
    expect(readLedger(ledgerPath)).toHaveLength(ledger.length);
    const { latency: _a, ...recordedCard } = recorded.scorecard;
    const { latency: _b, ...replayedCard } = replayed.scorecard;
    expect(replayedCard).toEqual(recordedCard);
    expect(replayed.meta.servedModels).toEqual([HAIKU]);
  }, 120_000);

  it("a record run over existing recordings counts the reused calls and says it is not a live measurement (I2)", async () => {
    const ids = [firstOf("eur"), firstOf("not_a_quote")];
    const recordingsDir = await temp("recordings-reuse");
    const first = await oracleApi(ids);
    const fresh = await dry({
      extractor: "llm",
      mode: "record",
      label: "record-fresh",
      ids,
      apiKey: "test-key",
      fetch: first.fetch,
      recordingsDir,
      ledgerPath: await tempLedger(0),
    });
    expect(fresh.meta.calls).toEqual({ total: 2, fromRecordings: 0 });
    const freshMd = await readFile(join(fresh.reportDir, "scorecard.md"), "utf8");
    expect(freshMd).not.toContain("served from recordings");

    const second = await oracleApi(ids);
    const reused = await dry({
      extractor: "llm",
      mode: "record",
      label: "record-reused",
      ids,
      apiKey: "test-key",
      fetch: second.fetch,
      recordingsDir,
      ledgerPath: await tempLedger(0),
    });
    expect(second.fetch).not.toHaveBeenCalled();
    expect(reused.meta.calls).toEqual({ total: 2, fromRecordings: 2 });
    const md = await readFile(join(reused.reportDir, "scorecard.md"), "utf8");
    expect(md).toContain("2 of 2 calls served from recordings: not a live measurement");
  }, 120_000);

  it("a response served by another model fails the run after the report and ledger row", async () => {
    const api = await oracleApi([firstOf("plain")], { model: "claude-sonnet-5-5" });
    const reportsDir = await temp("reports");
    const ledgerPath = await tempLedger(0);
    await expect(
      dry({
        extractor: "llm",
        mode: "live",
        label: "wrong-model",
        ids: [firstOf("plain")],
        apiKey: "test-key",
        fetch: api.fetch,
        reportsDir,
        ledgerPath,
      }),
    ).rejects.toBeInstanceOf(ModelNotAllowedError);
    const [dir] = await readdir(reportsDir);
    // The paid rows were written as the case finished, before the run failed.
    const rows = await readFile(join(reportsDir, dir ?? "", "rows.jsonl"), "utf8");
    expect(rows.trim().split("\n")).toHaveLength(1);
    expect(readLedger(ledgerPath).at(-1)?.costUsd).toBeCloseTo(api.costPerCall, 12);
  }, 120_000);

  it("stops at the first response served by another model: the next case is not run (M4)", async () => {
    const ids = [firstOf("eur"), firstOf("plain")];
    const api = await oracleApi(ids, { model: "claude-sonnet-5-5" });
    const reportsDir = await temp("reports");
    await expect(
      dry({
        extractor: "llm",
        mode: "live",
        label: "wrong-model-stop",
        ids,
        apiKey: "test-key",
        fetch: api.fetch,
        reportsDir,
        ledgerPath: await tempLedger(0),
      }),
    ).rejects.toBeInstanceOf(ModelNotAllowedError);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    const [dir] = await readdir(reportsDir);
    const json = JSON.parse(await readFile(join(reportsDir, dir ?? "", "scorecard.json"), "utf8"));
    expect(json.meta.aborted).toMatch(/model guard: a response was served by claude-sonnet-5-5/);
    expect(json.meta.notRun).toEqual([ids[1]]);
  }, 120_000);

  it("every case's stored quote is the graded view; none for other statuses (M1)", async () => {
    const r = await dry({ label: "stored" });
    expect(r.meta.runnerErrors).toEqual([]);
    for (const row of r.rows) expect(row.runnerErrors, row.id).toEqual([]);
  }, 120_000);

  it("a stored quote that differs from the graded view is a runner error that fails the run (M1)", async () => {
    // A trigger corrupts every stored quote line, so what was stored is not what is graded.
    await db`create or replace function eval_test_corrupt_line() returns trigger as $$
             begin new.qty_mt := new.qty_mt + 1; return new; end $$ language plpgsql`;
    await db`create trigger eval_test_corrupt_line before insert on quote_lines
             for each row execute function eval_test_corrupt_line()`;
    const reportsDir = await temp("reports");
    const extracted = SPLIT.dev.find((id) => truthOf(id).expected.status === "extracted") ?? "";
    try {
      await expect(dry({ label: "corrupt", ids: [extracted], reportsDir })).rejects.toThrow(
        /1 stored quote\(s\) differ from the graded view/,
      );
    } finally {
      await db`drop trigger if exists eval_test_corrupt_line on quote_lines`;
      await db`drop function if exists eval_test_corrupt_line()`;
    }
    const [dir] = await readdir(reportsDir);
    const json = JSON.parse(await readFile(join(reportsDir, dir ?? "", "scorecard.json"), "utf8"));
    expect(json.meta.runnerErrors).toHaveLength(1);
    expect(json.meta.runnerErrors[0]).toMatch(new RegExp(`^${extracted}: .*lines`));
    const md = await readFile(join(reportsDir, dir ?? "", "scorecard.md"), "utf8");
    expect(md).toContain("Runner errors");
  }, 120_000);

  it("a response body the spend guard cannot read fails the run and is listed", async () => {
    const api = await oracleApi([firstOf("plain")], { rawBody: "not json" });
    const reportsDir = await temp("reports");
    await expect(
      dry({
        extractor: "llm",
        mode: "live",
        label: "unreadable",
        ids: [firstOf("plain")],
        apiKey: "test-key",
        fetch: api.fetch,
        reportsDir,
        ledgerPath: await tempLedger(0),
      }),
    ).rejects.toThrow(/spend guard could not read 1 response bodies/);
    const [dir] = await readdir(reportsDir);
    const json = JSON.parse(await readFile(join(reportsDir, dir ?? "", "scorecard.json"), "utf8"));
    expect(json.meta.spend.parseErrors).toHaveLength(1);
    const md = await readFile(join(reportsDir, dir ?? "", "scorecard.md"), "utf8");
    expect(md).toContain("Spend guard could not read 1 response bodies");
  }, 120_000);

  it("never writes over a report: an existing directory name gets a suffix", async () => {
    const reportsDir = await temp("reports");
    const at = new Date("2026-11-14T10:00:00Z");
    const name = "20261114T100000Z-extraction-dev-same";
    await mkdir(join(reportsDir, name));
    const r = await dry({ label: "same", ids: [firstOf("eur")], reportsDir, now: () => at });
    expect(r.reportDir).toBe(join(reportsDir, `${name}-2`));
    expect(await readdir(join(reportsDir, name))).toEqual([]);
  }, 120_000);

  describe("SIGINT / SIGTERM during a paid run", () => {
    const interrupted = async (
      signal: "SIGINT" | "SIGTERM",
      when: "between cases" | "in flight",
    ) => {
      const ids = [firstOf("eur"), firstOf("plain")];
      const signals = new EventEmitter();
      const ledgerPath = await tempLedger(0);
      const reportsDir = await temp("reports");
      let atExit: { ledger: number; scorecard: unknown; rows: number } | null = null;
      const exit = vi.fn((_code: number) => {
        // What a real exit would leave behind, read at the moment of the exit.
        const [dir] = readdirSync(reportsDir);
        const base = join(reportsDir, dir ?? "");
        atExit = {
          ledger: readLedger(ledgerPath).length,
          scorecard: JSON.parse(readFileSync(join(base, "scorecard.json"), "utf8")),
          rows: readFileSync(join(base, "rows.jsonl"), "utf8").split("\n").filter(Boolean).length,
        };
      });
      let sent = false;
      const fire = () => {
        if (sent) return;
        sent = true;
        signals.emit(signal);
      };
      const api = await oracleApi(ids, when === "in flight" ? { onRequest: fire } : {});
      const r = await dry({
        extractor: "llm",
        mode: "live",
        label: `signal-${signal}`,
        ids,
        apiKey: "test-key",
        fetch: api.fetch,
        reportsDir,
        ledgerPath,
        signals,
        exit,
        log: (line) => {
          if (when === "between cases" && line.includes(`${ids[0]}:`)) fire();
        },
      });
      return { r, exit, atExit, api, ledgerPath, signals, ids };
    };

    it("between cases: ledgers the spend once, writes the report so far, exits 130", async () => {
      const { r, exit, atExit, api, ledgerPath, signals, ids } = await interrupted(
        "SIGINT",
        "between cases",
      );
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(INTERRUPT_EXIT);
      const ledger = readLedger(ledgerPath);
      expect(ledger).toHaveLength(2); // the earlier row and exactly one for this run
      expect(ledger.at(-1)).toMatchObject({ run: LEDGER_RUN, label: "signal-SIGINT" });
      expect(ledger.at(-1)?.costUsd).toBeCloseTo(api.costPerCall, 12);
      expect(atExit).toMatchObject({
        ledger: 2,
        rows: 1,
        scorecard: { meta: { aborted: "interrupted by SIGINT", notRun: [ids[1]] } },
      });
      expect(api.fetch).toHaveBeenCalledTimes(1);
      expect(r.meta).toMatchObject({ aborted: "interrupted by SIGINT", notRun: [ids[1]] });
      expect(r.meta.spend.ledgerUsd).toBeCloseTo(api.costPerCall, 12);
      expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    }, 120_000);

    it("in flight: the uncosted request is ledgered at the per-case estimate, once", async () => {
      const { r, exit, atExit, api, ledgerPath, ids } = await interrupted("SIGTERM", "in flight");
      expect(exit).toHaveBeenCalledWith(INTERRUPT_EXIT);
      const ledger = readLedger(ledgerPath);
      expect(ledger).toHaveLength(2);
      expect(ledger.at(-1)?.costUsd).toBeCloseTo(ESTIMATE_PER_CASE_RUN_USD, 12);
      expect(ESTIMATE_PER_CASE_RUN_USD).toBeGreaterThan(api.costPerCall);
      // At the exit the first case had not finished: no rows, both cases not run.
      expect(atExit).toMatchObject({
        ledger: 2,
        rows: 0,
        scorecard: { meta: { aborted: "interrupted by SIGTERM", notRun: ids } },
      });
      expect(r.meta.spend.ledgerUsd).toBeCloseTo(ESTIMATE_PER_CASE_RUN_USD, 12);
      expect(r.meta.spend.guardUsd).toBeCloseTo(api.costPerCall, 12);
    }, 120_000);
  });

  it("an unpaid run registers the handlers too and removes them afterwards", async () => {
    const signals = new EventEmitter();
    await dry({ label: "handlers", ids: [firstOf("eur")], signals });
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
  }, 120_000);

  it("refuses to start while another run holds the database", async () => {
    const other = await pool.reserve();
    try {
      await other`select pg_advisory_lock(${EVAL_RUN_LOCK}::bigint)`;
      await expect(dry({ label: "locked", ids: [firstOf("eur")] })).rejects.toThrow(
        /another extraction eval is running/,
      );
    } finally {
      await other`select pg_advisory_unlock(${EVAL_RUN_LOCK}::bigint)`;
      other.release();
    }
    await expect(dry({ label: "unlocked", ids: [firstOf("eur")] })).resolves.toBeDefined();
  }, 120_000);

  it("stops at the per-request guard (cap = what the ledger has left) and ledgers the overrun", async () => {
    // $0.01 left under the cap; one response costs about $0.05.
    const ids = [firstOf("eur"), firstOf("plain")];
    const api = await oracleApi(ids, { outputTokens: 100_000 });
    const ledgerPath = await tempLedger(2.99);
    const r = await dry({
      extractor: "llm",
      mode: "live",
      label: "guard",
      ids,
      apiKey: "test-key",
      fetch: api.fetch,
      ledgerPath,
    });
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(r.meta.aborted).toMatch(/spend cap/);
    expect(r.meta.notRun).toEqual([ids[1]]);
    expect(r.scorecard.cases).toBe(1);
    expect(readLedger(ledgerPath).at(-1)?.costUsd).toBeCloseTo(api.costPerCall, 12);
  }, 120_000);

  describe("the held-out passes file", () => {
    /** Makes the third `documents` insert from now on raise: a runner fault after two rows. */
    const faultOnThirdDocument = async () => {
      await db`create sequence eval_test_fault_seq`;
      await db`create or replace function eval_test_fault() returns trigger as $$
               begin
                 if nextval('eval_test_fault_seq') >= 3 then
                   raise exception 'eval test: injected runner fault';
                 end if;
                 return new;
               end $$ language plpgsql`;
      await db`create trigger eval_test_fault before insert on documents
               for each row execute function eval_test_fault()`;
      return async () => {
        await db`drop trigger if exists eval_test_fault on documents`;
        await db`drop function if exists eval_test_fault()`;
        await db`drop sequence if exists eval_test_fault_seq`;
      };
    };

    it("appends one pass row per case row, errors included", async () => {
      const ids = [heldoutId(0), heldoutId(1), heldoutId(2)];
      const passesPath = await tempPasses();
      const reportsDir = await temp("reports");
      // Case 1 is answered (an all-null quote: graded, whatever the grade), case 2 is refused (an
      // error), and case 3 fails at its document insert, a runner fault after two rows.
      const { fetch, requests } = scriptedFetch([
        textReply(1, JSON.stringify({ extraction: EMPTY_EXTRACTION })),
        scriptedMessage(2, [{ type: "text", text: "I can't help with that." }], "refusal"),
      ]);
      const restore = await faultOnThirdDocument();
      try {
        await expect(
          dry({
            ...STAND_IN_FINAL,
            extractor: "llm",
            mode: "live",
            label: "passes",
            ids,
            apiKey: "test-key",
            fetch,
            ledgerPath: await tempLedger(0),
            passesPath,
            reportsDir,
          }),
        ).rejects.toThrow(/eval test: injected runner fault/);
      } finally {
        await restore();
      }
      expect(requests).toHaveLength(2);
      const [dir = ""] = await readdir(reportsDir);
      const rows = (await readFile(join(reportsDir, dir, "rows.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { id: string; run: number; errorKind: string | null });
      expect(rows.map((r) => [r.id, r.run, r.errorKind])).toEqual([
        [ids[0], 1, null],
        [ids[1], 1, "refusal"],
      ]);
      const passes = readPasses(passesPath);
      expect(passes.map((p) => [p.suite, p.id, p.run, p.outcome])).toEqual([
        ["extraction", ids[0], 1, "graded"],
        ["extraction", ids[1], 1, "error:refusal"],
      ]);
      for (const p of passes) expect(p).toMatchObject({ label: "passes", report: dir });
      // The report so far has its scorecard: the rest can run once, and the reports be merged.
      const json = JSON.parse(await readFile(join(reportsDir, dir, "scorecard.json"), "utf8"));
      expect(json.meta).toMatchObject({ final: true, notRun: [ids[2]] });
      expect(json.meta.aborted).toMatch(/^runner fault: .*eval test: injected runner fault/);
      expect(json.scorecard.cases).toBe(2);
      // A case with a row never runs again; the case without one still may.
      await expect(
        dry({
          ...STAND_IN_FINAL,
          extractor: "llm",
          mode: "live",
          ids: [heldoutId(1), heldoutId(2)],
          apiKey: "test-key",
          fetch: networkForbidden(),
          ledgerPath: await tempLedger(0),
          passesPath,
        }),
      ).rejects.toThrow(HeldoutRerunError);
    }, 120_000);

    it("oracle, empty and replay passes never touch the passes file", async () => {
      const ids = [heldoutId(0), heldoutId(1)];
      // Both ids are listed: an armed guard would refuse these passes.
      const passesPath = await tempPasses(ids);
      const before = fileText(passesPath);
      const passes: Partial<EvalOptions>[] = [
        { extractor: "oracle" },
        { extractor: "empty" },
        { extractor: "llm", mode: "replay", recordingsDir: await temp("no-recordings") },
        // The guard keys on a live model pass, not on the mode flag alone.
        { extractor: "oracle", mode: "live" },
      ];
      for (const over of passes) {
        const r = await dry({ ...STAND_IN_FINAL, ids, passesPath, ...over });
        expect(r.rows).toHaveLength(2);
        expect(r.meta.final).toBe(true);
      }
      expect(fileText(passesPath)).toBe(before);
      const absent = join(await temp("passes-absent"), "passes.jsonl");
      await dry({ ...STAND_IN_FINAL, ids, passesPath: absent, extractor: "empty" });
      expect(fileText(absent)).toBeNull();
    }, 120_000);

    it("meta.final is true only with --final", async () => {
      expect(parseArgs(["--oracle"]).final).toBe(false);
      expect(parseArgs(["--oracle", "--final"]).final).toBe(true);
      const plain = await dry({ ids: [firstOf("eur")], label: "not-final" });
      const final = await dry({ ids: [firstOf("eur")], label: "final", final: true });
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
    }, 120_000);
  });
});
