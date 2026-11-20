import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalSummary } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createClock } from "../clock.js";
import { DEFAULT_EVAL_SUMMARY_PATH } from "../config.js";
import { createFixtureSource, FIXTURE_ANCHOR } from "../read/fixtures.js";

/** A published summary as `npm run eval:publish` writes it (made-up scores, for the route only). */
const SUMMARY: EvalSummary = {
  generatedAt: "2026-11-16T09:00:00.000Z",
  suites: [
    {
      suite: "qa",
      split: "dev",
      label: "Q&A (dev)",
      model: "claude-haiku-5-5",
      promptVersion: "agent-system/v5",
      runAt: "2026-11-15T21:33:42.000Z",
      mode: "live",
      metrics: [
        {
          key: "grounded",
          label: "Grounded",
          k: 3,
          n: 4,
          rate: 0.75,
          ci95: [0.3, 0.95],
          expectedZero: false,
        },
      ],
      latency: [{ key: "answer_mean", label: "Answer (mean)", seconds: 4.6 }],
      costUsdPerItem: 0.001,
    },
  ],
};

describe("GET /api/eval/summary", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pharos-eval-summary-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const appAt = (summaryPath: string) =>
    createApp({
      llmMode: "replay",
      clock: createClock(FIXTURE_ANCHOR),
      pingDb: async () => true,
      read: createFixtureSource(),
      evalSummary: { path: summaryPath },
    });

  it("reads evals/published/summary.json under the repo root by default", () => {
    expect(DEFAULT_EVAL_SUMMARY_PATH.endsWith(join("evals", "published", "summary.json"))).toBe(
      true,
    );
  });

  it("serves the published summary, validated as an EvalSummary", async () => {
    const path = join(dir, "summary.json");
    await writeFile(path, JSON.stringify(SUMMARY));
    const res = await appAt(path).request("/api/eval/summary");
    expect(res.status).toBe(200);
    expect(EvalSummary.parse(await res.json())).toEqual(SUMMARY);
  });

  it("serves a summary with a held-out entry next to the dev one", async () => {
    const path = join(dir, "both.json");
    const both: EvalSummary = {
      ...SUMMARY,
      suites: [
        { ...SUMMARY.suites[0], split: "heldout", label: "Q&A (held-out)" },
        ...SUMMARY.suites,
      ].filter((x): x is EvalSummary["suites"][number] => x !== undefined),
    };
    await writeFile(path, JSON.stringify(both));
    const res = await appAt(path).request("/api/eval/summary");
    expect(res.status).toBe(200);
    expect(EvalSummary.parse(await res.json()).suites.map((x) => x.split)).toEqual([
      "heldout",
      "dev",
    ]);
  });

  it("404s with no_published_summary when nothing is published", async () => {
    const res = await appAt(join(dir, "absent.json")).request("/api/eval/summary");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_published_summary" });
  });

  it("500s with invalid_published_summary when the path cannot be read (a directory)", async () => {
    const path = join(dir, "a-directory");
    await mkdir(path);
    const res = await appAt(path).request("/api/eval/summary");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_published_summary");
    expect(body.message).toMatch(/EISDIR/);
  });

  it.each([
    ["not JSON", "{ nope"],
    ["the wrong shape", JSON.stringify({ ...SUMMARY, suites: [{ suite: "qa" }] })],
    [
      "a k above n",
      JSON.stringify({
        ...SUMMARY,
        suites: [
          {
            ...SUMMARY.suites[0],
            metrics: [{ key: "a", label: "A", k: 5, n: 4, rate: 1, ci95: null }],
          },
        ],
      }),
    ],
  ])("500s with invalid_published_summary when the file is %s", async (_what, text) => {
    const path = join(dir, `bad-${Math.random().toString(36).slice(2)}.json`);
    await writeFile(path, text);
    const res = await appAt(path).request("/api/eval/summary");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "invalid_published_summary" });
  });
});
