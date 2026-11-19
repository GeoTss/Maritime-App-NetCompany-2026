import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { LlmFetch } from "../../apps/api/src/ai/llm.js";
import {
  appendSpend,
  assertBudget,
  assertHaikuOnly,
  BudgetError,
  budgetRemaining,
  createSpendGuard,
  currentPhase,
  DEFAULT_BUDGET_PATH,
  DEFAULT_LEDGER_PATH,
  HAIKU,
  ledgerTotal,
  ModelNotAllowedError,
  readBudgetConfig,
  readLedger,
} from "./budget.js";
import { runLedgerCli } from "./ledger-cli.js";

const tempLedger = (content?: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.jsonl");
  if (content !== undefined) writeFileSync(path, content);
  return path;
};
const row = (costUsd: number, phase?: number) => ({
  at: "2026-11-14T10:00:00Z",
  run: "r",
  label: "l",
  costUsd,
  ...(phase === undefined ? {} : { phase }),
});
const tempBudget = (phase: number, capUsd: number) => {
  const path = join(mkdtempSync(join(tmpdir(), "budget-")), "budget.json");
  writeFileSync(path, JSON.stringify({ phase, capUsd }));
  return path;
};

describe("ledger", () => {
  it("totals an empty or missing ledger as 0", () => {
    expect(ledgerTotal(tempLedger(""))).toBe(0);
    expect(ledgerTotal(tempLedger())).toBe(0);
  });
  it("the real ledger and the real budget file parse; Phase 3 stays within its $3 cap", () => {
    expect(() => readLedger(DEFAULT_LEDGER_PATH)).not.toThrow();
    expect(() => readBudgetConfig(DEFAULT_BUDGET_PATH)).not.toThrow();
    expect(ledgerTotal(DEFAULT_LEDGER_PATH, 3)).toBeLessThanOrEqual(3);
  });
  it("appends rows and sums them", () => {
    const p = tempLedger("");
    appendSpend(row(1.25), p);
    appendSpend(row(0.5), p);
    expect(readLedger(p)).toHaveLength(2);
    expect(ledgerTotal(p)).toBeCloseTo(1.75, 9);
  });
  it("refuses to append an invalid row", () => {
    const p = tempLedger("");
    expect(() => appendSpend(row(-1), p)).toThrow();
    expect(() => appendSpend(row(Number.NaN), p)).toThrow();
    expect(readFileSync(p, "utf8")).toBe("");
  });
  it("throws on a malformed line, naming its line number", () => {
    const p = tempLedger(`${JSON.stringify(row(1))}\n{not json\n`);
    expect(() => readLedger(p)).toThrow(/line 2/);
    const q = tempLedger(
      `${JSON.stringify(row(1))}\n${JSON.stringify({ ...row(1), costUsd: "x" })}\n`,
    );
    expect(() => readLedger(q)).toThrow(/line 2/);
  });
});

describe("assertBudget", () => {
  it("blocks an estimate that would pass the cap, naming total, estimate and cap", () => {
    const p = tempLedger(`${JSON.stringify(row(2.5, 4))}\n`);
    const cfg = tempBudget(4, 3);
    expect(() => assertBudget(0.6, p, undefined, cfg)).toThrow(BudgetError);
    expect(() => assertBudget(0.6, p, undefined, cfg)).toThrow(/2\.5000.*0\.6000.*3\.00/);
    expect(() => assertBudget(0.5, p, undefined, cfg)).not.toThrow();
  });
  it("rejects a NaN or negative estimate", () => {
    const p = tempLedger("");
    const cfg = tempBudget(4, 3);
    expect(() => assertBudget(Number.NaN, p, undefined, cfg)).toThrow(BudgetError);
    expect(() => assertBudget(-1, p, undefined, cfg)).toThrow(BudgetError);
  });
});

describe("per-phase budget", () => {
  it("Phase 3 rows ($2.99, one unstamped) do not block a Phase 4 estimate under a Phase 4 cap", () => {
    const p = tempLedger(`${JSON.stringify(row(1.5))}\n${JSON.stringify(row(1.49, 3))}\n`);
    const cfg = tempBudget(4, 1);
    expect(ledgerTotal(p, 3)).toBeCloseTo(2.99, 9);
    expect(ledgerTotal(p, 4)).toBe(0);
    expect(ledgerTotal(p)).toBeCloseTo(2.99, 9);
    expect(() => assertBudget(0.9, p, undefined, cfg)).not.toThrow();
    expect(() => assertBudget(1.1, p, undefined, cfg)).toThrow(BudgetError);
  });
  it("Phase 4 rows over the Phase 4 cap block", () => {
    const p = tempLedger(`${JSON.stringify(row(0.9, 4))}\n${JSON.stringify(row(2.9, 3))}\n`);
    const cfg = tempBudget(4, 1);
    expect(() => assertBudget(0.2, p, undefined, cfg)).toThrow(/Phase 4.*0\.9000.*0\.2000.*1\.00/);
    expect(() => assertBudget(0.1, p, undefined, cfg)).not.toThrow();
    const left = budgetRemaining(p, undefined, cfg);
    expect(left.phase).toBe(4);
    expect(left.remainingUsd).toBeCloseTo(0.1, 9);
  });
  it("a cap of 0 refuses any positive estimate and says the user must set the budget", () => {
    const p = tempLedger("");
    const cfg = tempBudget(4, 0);
    expect(() => assertBudget(0.001, p, undefined, cfg)).toThrow(/Phase 4 budget is not set/);
    expect(() => assertBudget(0.001, p, undefined, cfg)).toThrow(/user must set/);
    expect(() => assertBudget(0, p, undefined, cfg)).not.toThrow();
  });
  it("checks only the phase the budget file covers", () => {
    const cfg = tempBudget(4, 1);
    expect(() => assertBudget(0.1, tempLedger(""), 3, cfg)).toThrow(/covers Phase 4, not Phase 3/);
  });
  it("the real budget file covers Phase 10 (track 3, security), the current phase", () => {
    expect(readBudgetConfig(DEFAULT_BUDGET_PATH).phase).toBe(10);
    expect(currentPhase()).toBe(10);
  });
  it("rejects a malformed budget file naming it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "budget-")), "budget.json");
    writeFileSync(path, JSON.stringify({ phase: 4, capUsd: -1 }));
    expect(() => readBudgetConfig(path)).toThrow(path);
    expect(() => readBudgetConfig(`${path}.missing`)).toThrow(/cannot read/);
  });
  it("appendSpend stamps the current phase, and keeps a phase the row names", () => {
    const p = tempLedger("");
    const cfg = tempBudget(4, 1);
    appendSpend(row(0.1), p, cfg);
    appendSpend(row(0.2, 3), p, cfg);
    expect(readLedger(p).map((r) => r.phase)).toEqual([4, 3]);
    expect(ledgerTotal(p, 4)).toBeCloseTo(0.1, 9);
  });
});

describe("assertHaikuOnly", () => {
  it("allows only claude-haiku-5-5", () => {
    expect(() => assertHaikuOnly([HAIKU, HAIKU])).not.toThrow();
    expect(() => assertHaikuOnly(["claude-sonnet-5-5"])).toThrow(ModelNotAllowedError);
    expect(() => assertHaikuOnly(["claude-sonnet-5-5-20261001"])).toThrow(ModelNotAllowedError);
    expect(() => assertHaikuOnly([HAIKU, "claude-opus-5-5"])).toThrow(/claude-opus-5-5/);
  });
});

describe("createSpendGuard", () => {
  const okBody = JSON.stringify({
    model: HAIKU,
    usage: { input_tokens: 10_000, output_tokens: 2000 },
  });
  it("blocks the second request after the first crosses the cap, without calling the inner fetch", async () => {
    const inner = vi.fn<LlmFetch>(
      async () => new Response(okBody, { headers: { "content-type": "application/json" } }),
    );
    const guard = createSpendGuard({ capUsd: 0.001 });
    const f = guard.wrap(inner, HAIKU);
    const first = await f("http://x", {});
    expect(first.status).toBe(200);
    expect(guard.spentUsd()).toBeGreaterThan(0.001);
    const second = await f("http://x", {});
    expect(second.status).toBe(400);
    expect(await second.text()).toMatch(/spend cap reached/);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(guard.served).toEqual([HAIKU]);
    expect(guard.blocked).toHaveLength(1);
    expect(guard.trip()?.source).toBe("own");
  });
  it("blocks on an outer cap reported by onRequest and reports costs through onCost", async () => {
    const inner = vi.fn<LlmFetch>(async () => new Response(okBody));
    let outer: string | null = null;
    const seen: number[] = [];
    const guard = createSpendGuard({
      capUsd: 100,
      onRequest: () => outer,
      onCost: (c) => seen.push(c),
    });
    const f = guard.wrap(inner, HAIKU);
    await f("http://x", {});
    expect(seen).toHaveLength(1);
    outer = "outer cap";
    expect((await f("http://x", {})).status).toBe(400);
    expect(guard.trip()).toEqual({ source: "outer", reason: "outer cap" });
    expect(inner).toHaveBeenCalledTimes(1);
  });
  it("with allowedModel, refuses the request after a response served by another model", async () => {
    const sonnet = JSON.stringify({
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const inner = vi.fn<LlmFetch>(async () => new Response(sonnet));
    const guard = createSpendGuard({ capUsd: 100, allowedModel: HAIKU });
    const f = guard.wrap(inner, HAIKU);
    // The response that names another model is handed back (its cost is counted) ...
    expect((await f("http://x", {})).status).toBe(200);
    expect(guard.spentUsd()).toBeGreaterThan(0);
    expect(guard.trip()).toEqual({
      source: "model",
      reason: `model guard: a response was served by claude-sonnet-5-5, not ${HAIKU}`,
    });
    // ... and the next request is refused without reaching the network.
    const next = await f("http://x", {});
    expect(next.status).toBe(400);
    expect(await next.text()).toMatch(/refused: model guard/);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(guard.served).toEqual(["claude-sonnet-5-5"]);
  });
  it("with allowedModel, Haiku responses pass; without it, any model passes", async () => {
    const haiku = createSpendGuard({ capUsd: 100, allowedModel: HAIKU });
    await haiku.wrap(async () => new Response(okBody), HAIKU)("http://x", {});
    expect(haiku.trip()).toBeNull();
    const open = createSpendGuard({ capUsd: 100 });
    const sonnet = JSON.stringify({ model: "claude-sonnet-5-5", usage: { input_tokens: 10 } });
    await open.wrap(async () => new Response(sonnet), HAIKU)("http://x", {});
    expect(open.trip()).toBeNull();
  });
  it("records an unreadable body instead of swallowing it", async () => {
    const guard = createSpendGuard({ capUsd: 1 });
    await guard.wrap(async () => new Response("not json"), HAIKU)("http://x", {});
    expect(guard.parseErrors).toHaveLength(1);
  });
  it("passes a non-OK response through unread, and gives a 204 a null body", async () => {
    const guard = createSpendGuard({ capUsd: 1 });
    const failed = new Response('{"type":"error"}', { status: 529 });
    expect(await guard.wrap(async () => failed, HAIKU)("http://x", {})).toBe(failed);
    expect(failed.bodyUsed).toBe(false);
    const empty = await guard.wrap(async () => new Response(null, { status: 204 }), HAIKU)(
      "http://x",
      {},
    );
    expect([empty.status, empty.body]).toEqual([204, null]);
    expect(guard.spentUsd()).toBe(0);
    expect(guard.parseErrors).toEqual([]);
  });
});

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** A full garbage collection, then a macrotask so FinalizationRegistry callbacks can run. */
async function collectGarbage(): Promise<void> {
  gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createSpendGuard under garbage collection", () => {
  // Node 22's fetch (undici 6.21) cancels a Response's body when a clone of that Response is
  // garbage collected. The guard reads every response for its usage, so the response it returns
  // must have a body no collection can cancel. The collection runs after the guard has read the
  // body and before the caller reads it.
  const okBody = JSON.stringify({ model: HAIKU, usage: { input_tokens: 100, output_tokens: 20 } });
  it("a collection between the guard's read and the caller's leaves the body readable", async () => {
    const guard = createSpendGuard({ capUsd: 1 });
    const f = guard.wrap(
      async () =>
        new Response(okBody, {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json", "request-id": "req_1" },
        }),
      HAIKU,
    );
    for (let i = 0; i < 3; i++) {
      const res = await f("http://x", {});
      await collectGarbage();
      expect(res.bodyUsed).toBe(false);
      expect(await res.json()).toEqual(JSON.parse(okBody));
      expect([res.status, res.statusText, res.headers.get("request-id")]).toEqual([
        200,
        "OK",
        "req_1",
      ]);
    }
    expect(guard.served).toEqual([HAIKU, HAIKU, HAIKU]);
    expect(guard.spentUsd()).toBeGreaterThan(0);
  });
});

describe("eval:ledger CLI", () => {
  it("add rejects a negative, NaN or missing cost and writes nothing", () => {
    const p = tempLedger("");
    for (const bad of ["-0.5", "NaN", "abc", ""]) {
      expect(() => runLedgerCli(["add", "--run", "r", "--label", "l", "--cost", bad], p)).toThrow();
    }
    expect(() => runLedgerCli(["add", "--run", "r", "--label", "l"], p)).toThrow();
    expect(readFileSync(p, "utf8")).toBe("");
  });
  it("add appends, total reports the sum and what remains", () => {
    const p = tempLedger("");
    const cfg = tempBudget(4, 3);
    const out = runLedgerCli(
      ["add", "--run", "t1", "--label", "manual", "--cost", "0.0042"],
      p,
      () => new Date("2026-11-14T10:00:00Z"),
      cfg,
    );
    expect(out).toContain("Phase 4 total $0.0042");
    expect(runLedgerCli(["total"], p, undefined, cfg)).toBe(
      "Phase 4 total $0.0042; remaining $2.9958 of $3.00",
    );
    expect(readLedger(p)[0]?.phase).toBe(4);
    expect(() => runLedgerCli(["bogus"], p)).toThrow(/usage/);
  });
});
