import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDatabase } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureLlmCall } from "../../apps/api/src/ai/call-capture.js";
import { createLlmExtractor } from "../../apps/api/src/ai/extract.js";
import { createLlm } from "../../apps/api/src/ai/llm.js";
import { createApp } from "../../apps/api/src/app.js";
import { ASK_RECORDING_CONFIG } from "../../apps/api/src/ask/record-demo-ask.js";
import { DEFAULT_RECORDINGS_DIR } from "../../apps/api/src/config.js";
import { createErpClient } from "../../apps/api/src/executor/erp-client.js";
import { DEMO_INBOX_DIR } from "../../apps/api/src/inbox/routes.js";
import { DEMO_RECORDING_CONFIG } from "../../apps/api/src/ingest/record-demo-extractions.js";
import { createDbSource } from "../../apps/api/src/read/db-source.js";
import { FIXTURE_ANCHOR, FIXTURE_SEED } from "../../apps/api/src/read/fixtures.js";
import { createErpApp } from "../../services/erp-sim/src/app.js";
import { runSmoke, type SmokeResult, SPEND_CAP_USD } from "./run.js";

const sql = await connectTestDb("smoke");

if (!sql) {
  describe("live smoke runner (in-process, replay)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("smoke")}`, () => {});
  });
}

describe.skipIf(!sql)("live smoke runner (in-process, replay)", () => {
  if (!sql) return;
  const db = sql;
  const tmp: string[] = [];

  beforeEach(async () => {
    await seedDatabase(db, { seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
  });
  afterAll(async () => {
    await db.end();
    await Promise.all(tmp.map((d) => rm(d, { recursive: true, force: true })));
  });

  async function build() {
    const llm = createLlm({
      mode: "replay",
      recordingsDir: DEFAULT_RECORDINGS_DIR,
      onCall: captureLlmCall,
    });
    const erp = createErpApp();
    const app = createApp({
      llmMode: "replay",
      pingDb: async () => true,
      read: createDbSource(db),
      inbox: {
        sql: db,
        extractor: createLlmExtractor(llm, DEMO_RECORDING_CONFIG),
        inboxDir: DEMO_INBOX_DIR,
      },
      ask: {
        sql: db,
        llm,
        config: ASK_RECORDING_CONFIG,
        now: () => new Date(FIXTURE_ANCHOR.getTime() + 5 * 60_000),
      },
      approvals: {
        sql: db,
        erp: createErpClient("http://erp.test", (url, init) => erp.request(url, init)),
      },
      llmCalls: { sql: db },
    });
    const dir = await mkdtemp(join(tmpdir(), "pharos-smoke-"));
    tmp.push(dir);
    return {
      dir,
      options: {
        baseUrl: "http://api.test",
        fetch: ((url: string, init?: RequestInit) =>
          app.request(url.replace("http://api.test", ""), init)) as typeof fetch,
        expectedLlmMode: "replay" as const,
        label: "dryrun",
        reportsDir: join(dir, "reports"),
        markersDir: join(dir, "markers"),
        sleep: async () => {},
        pollIntervalMs: 1,
        log: () => {},
      },
    };
  }

  it("passes end to end, writes the report and the marker", async () => {
    const { dir, options } = await build();
    const result: SmokeResult = await runSmoke(options);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);

    const r = result.report;
    expect(r.label).toBe("dryrun");
    expect(r.steps.map((s) => s.name)).toEqual(["email-1", "email-2", "ask", "approve"]);
    for (const s of r.steps) expect(s.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.calls.filter((c) => c.purpose === "extract")).toHaveLength(2);
    expect(r.calls.some((c) => c.purpose === "agent")).toBe(true);
    expect(r.byPurpose.map((p) => p.purpose).sort()).toEqual(["agent", "extract"]);
    const sum = r.calls.reduce((a, c) => a + c.costUsd, 0);
    expect(r.totals.costUsd).toBeCloseTo(sum, 9);
    expect(r.totals.calls).toBe(r.calls.length);

    const files = await readFile(join(result.reportDir, "report.json"), "utf8");
    expect(JSON.parse(files).label).toBe("dryrun");
    expect(await readFile(join(result.reportDir, "report.md"), "utf8")).toContain("extract");
    expect(result.reportDir.startsWith(join(dir, "reports"))).toBe(true);
    expect(result.reportDir).toMatch(/\d{8}T\d{6}Z-smoke-dryrun$/);
    await access(join(dir, "markers", "live-smoke"));
  });

  it("exits 2 when the API is not in the expected mode, without touching the inbox", async () => {
    const { dir, options } = await build();
    const result = await runSmoke({ ...options, expectedLlmMode: "live" });
    expect(result.exitCode).toBe(2);
    expect(result.failures.join("\n")).toContain("start the API with LLM_MODE=live");
    await expect(access(join(dir, "markers", "live-smoke"))).rejects.toThrow();
  });

  it("tells the operator to restart the API when the inbox was already delivered", async () => {
    const first = await build();
    await runSmoke(first.options);
    const second = await runSmoke({ ...first.options, markersDir: join(first.dir, "m2") });
    expect(second.ok).toBe(false);
    expect(second.exitCode).toBe(1);
    expect(second.failures.join("\n")).toContain(
      "inbox already delivered — restart the API and ERP (docker compose up -d --force-recreate api erp) to reset the demo world",
    );
    await expect(access(join(first.dir, "m2", "live-smoke"))).rejects.toThrow();
  });

  it("lists a failed assertion and writes no marker", async () => {
    const { dir, options } = await build();
    const realFetch = options.fetch;
    // Tamper with the quotes the runner reads: a wrong price must fail the check.
    const tampered = (async (url: string, init?: RequestInit) => {
      const res = await realFetch(url, init);
      if (new URL(url).pathname === "/api/quotes") {
        const body = (await res.json()) as { items: { lines: { pricePerMt: number }[] }[] };
        for (const q of body.items) for (const l of q.lines) l.pricePerMt += 1;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return res;
    }) as typeof fetch;
    const result = await runSmoke({ ...options, fetch: tampered });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/price/);
    await expect(access(join(dir, "markers", "live-smoke"))).rejects.toThrow();
  });

  /** Wraps the in-process fetch: `rewrite` may replace a response's JSON body per path. */
  const rewriting = (
    realFetch: typeof fetch,
    rewrite: (path: string, body: unknown) => unknown,
    seen: string[] = [],
  ) =>
    (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      seen.push(path);
      const res = await realFetch(url, init);
      const body = rewrite(
        path,
        await res
          .clone()
          .json()
          .catch(() => undefined),
      );
      return body === undefined ? res : new Response(JSON.stringify(body), { status: res.status });
    }) as typeof fetch;

  it("fails a run whose cost passes the spend cap and writes no marker", async () => {
    const { dir, options } = await build();
    const inflated = rewriting(options.fetch, (path, body) => {
      if (path !== "/api/llm-calls") return undefined;
      const b = body as { items: { costUsd: number }[] };
      for (const c of b.items) c.costUsd = 0.2;
      return b;
    });
    const result = await runSmoke({ ...options, fetch: inflated });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/run cost \$.* exceeds the \$0\.25 cap/);
    expect(SPEND_CAP_USD).toBe(0.25);
    expect(await readFile(join(result.reportDir, "report.md"), "utf8")).toContain("(cap 0.25)");
    await expect(access(join(dir, "markers", "live-smoke"))).rejects.toThrow();
  });

  it("reports why an extraction ended needs_review and stops before the paid ask", async () => {
    const { dir, options } = await build();
    const seen: string[] = [];
    const reviewing = rewriting(
      options.fetch,
      (path, body) => {
        if (!/^\/api\/inbox\/\d+$/.test(path)) return undefined;
        return {
          ...(body as object),
          extractionStatus: "needs_review",
          checkResults: [
            { check: "quantity", passed: false, detail: "range written as 300/350 mt" },
            { check: "currency", passed: true, detail: null },
          ],
        };
      },
      seen,
    );
    const result = await runSmoke({ ...options, fetch: reviewing });
    expect(result.exitCode).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("extraction ended needs_review");
    expect(result.failures[0]).toContain("quantity: range written as 300/350 mt");
    expect(result.failures[0]).not.toContain("currency");
    expect(seen).not.toContain("/api/ask");
    expect(result.report.steps.map((s) => s.name)).toEqual(["email-1"]);
    expect(JSON.parse(await readFile(join(result.reportDir, "report.json"), "utf8")).ok).toBe(
      false,
    );
    await expect(access(join(dir, "markers", "live-smoke"))).rejects.toThrow();
  });

  it("times out a stuck extraction, records the step, writes the report and skips the ask", async () => {
    const { dir, options } = await build();
    const seen: string[] = [];
    const stuck = rewriting(
      options.fetch,
      (path, body) =>
        /^\/api\/inbox\/\d+$/.test(path)
          ? { ...(body as object), extractionStatus: "pending", checkResults: [] }
          : undefined,
      seen,
    );
    const result = await runSmoke({ ...options, fetch: stuck, extractionTimeoutMs: 20 });
    expect(result.exitCode).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("extraction still pending");
    expect(seen).not.toContain("/api/ask");
    expect(result.report.steps.map((s) => s.name)).toEqual(["email-1"]);
    await access(join(result.reportDir, "report.json"));
    await expect(access(join(dir, "markers", "live-smoke"))).rejects.toThrow();
  });
});
