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
  createSpendGuard,
  DEFAULT_LEDGER_PATH,
  HAIKU,
  ledgerTotal,
  ModelNotAllowedError,
  readLedger,
  SPEND_CAP_USD,
} from "./budget.js";
import { runLedgerCli } from "./ledger-cli.js";

const tempLedger = (content?: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.jsonl");
  if (content !== undefined) writeFileSync(path, content);
  return path;
};
const row = (costUsd: number) => ({
  at: "2026-11-14T10:00:00Z",
  run: "r",
  label: "l",
  costUsd,
});

describe("ledger", () => {
  it("totals an empty or missing ledger as 0", () => {
    expect(ledgerTotal(tempLedger(""))).toBe(0);
    expect(ledgerTotal(tempLedger())).toBe(0);
  });
  it("the real ledger parses and stays within the cap", () => {
    expect(() => readLedger(DEFAULT_LEDGER_PATH)).not.toThrow();
    expect(ledgerTotal(DEFAULT_LEDGER_PATH)).toBeLessThanOrEqual(SPEND_CAP_USD);
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
    const p = tempLedger(`${JSON.stringify(row(2.5))}\n`);
    expect(() => assertBudget(0.6, p)).toThrow(BudgetError);
    expect(() => assertBudget(0.6, p)).toThrow(/2\.5000.*0\.6000.*3\.00/);
    expect(() => assertBudget(0.5, p)).not.toThrow();
  });
  it("rejects a NaN or negative estimate", () => {
    const p = tempLedger("");
    expect(() => assertBudget(Number.NaN, p)).toThrow(BudgetError);
    expect(() => assertBudget(-1, p)).toThrow(BudgetError);
  });
  it("cap is $3", () => expect(SPEND_CAP_USD).toBe(3));
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
    const out = runLedgerCli(
      ["add", "--run", "t1", "--label", "manual", "--cost", "0.0042"],
      p,
      () => new Date("2026-11-14T10:00:00Z"),
    );
    expect(out).toContain("total $0.0042");
    expect(runLedgerCli(["total"], p)).toBe("total $0.0042; remaining $2.9958 of $3.00");
    expect(() => runLedgerCli(["bogus"], p)).toThrow(/usage/);
  });
});
