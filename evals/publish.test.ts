/** The eval publisher: live dev reports become the published summary; everything else is refused. */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalSummary } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { buildSummary, PublishRefusal } from "./publish.js";

const m = (k: number, n: number) => ({
  k,
  n,
  rate: n === 0 ? null : k / n,
  ci95: { low: 0.5, high: 1 },
  failedIds: [],
});
const dist = { n: 3, mean: 2000, p90: 3000 };

const qaCard = {
  grounded: m(31, 31),
  answerAccuracy: m(23, 23),
  abstention: m(4, 4),
  injection: m(3, 3),
  noAction: m(2, 2),
  proposedBest: m(5, 5),
  unauthorised: m(0, 31),
  repaired: m(3, 31),
  questions: 33,
  errors: [] as unknown[],
  latency: { firstProgress: dist, answer: dist },
  cost: { perQuestion: { n: 3, mean: 0.001, p90: 0.002 } },
};
const exCard = {
  critical: m(646, 651),
  kind: {
    quotePrecision: m(70, 70),
    quoteRecall: m(70, 71),
    notAQuotePrecision: m(13, 14),
    notAQuoteRecall: m(13, 13),
  },
  unsafeAutoAccepts: m(0, 84),
  reviewQueue: m(21, 84),
  cases: 84,
  errors: [] as unknown[],
  latency: { endToEnd: dist },
  cost: { perEmail: { n: 3, mean: 0.0007, p90: 0.001 } },
};

async function report(
  suite: "qa" | "extraction",
  meta: Record<string, unknown>,
  card: unknown,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pub-"));
  await mkdir(dir, { recursive: true });
  const full = {
    suite,
    split: "dev",
    label: "dev-x",
    mode: "record",
    model: "claude-haiku-5-5",
    promptVersion: "p/v1",
    finishedAt: "2026-11-15T21:36:11.186Z",
    spend: { guardUsd: 0.01, dbUsd: 0.01 },
    ...meta,
  };
  await writeFile(join(dir, "scorecard.json"), JSON.stringify({ meta: full, scorecard: card }));
  return dir;
}

/** A held-out report plus a split.json holding `ids` as its held-out half. */
async function heldReport(
  suite: "qa" | "extraction",
  ids: string[],
  o: {
    meta?: Record<string, unknown>;
    rows?: Record<string, unknown>[];
  },
): Promise<{ dir: string; splitDir: string }> {
  const dir = await report(
    suite,
    {
      split: "heldout",
      mode: "live",
      final: true,
      label: `${suite === "qa" ? "qa" : "ex"}-held`,
      aborted: null,
      notRun: [],
      runnerErrors: [],
      ...o.meta,
    },
    suite === "qa" ? qaCard : exCard,
  );
  const rows = o.rows ?? ids.map((id) => ({ id, run: 1 }));
  await writeFile(join(dir, "rows.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
  const splitDir = await mkdtemp(join(tmpdir(), "split-"));
  await mkdir(join(splitDir, suite), { recursive: true });
  await writeFile(
    join(splitDir, suite, "split.json"),
    JSON.stringify({ dev: ["d-1"], heldout: ids }),
  );
  return { dir, splitDir };
}

describe("held-out reports", () => {
  const ids = ["h-1", "h-2", "h-3"];
  const build = (h: { dir: string; splitDir: string }) =>
    buildSummary({ extraction: h.dir }, new Date(), undefined, h.splitDir);

  it("a complete final live pass is published with split heldout", async () => {
    const s = await build(await heldReport("extraction", ids, {}));
    expect(s.suites[0]).toMatchObject({ suite: "extraction", split: "heldout", mode: "live" });
  });

  it("an abort during repeats does not decide publication, and repeat rows are fine", async () => {
    const rows = [...ids.map((id) => ({ id, run: 1 })), { id: "h-1", run: 2 }];
    const h = await heldReport("extraction", ids, {
      rows,
      meta: { aborted: { reason: "cap" }, notRun: ["h-1#3"] },
    });
    await expect(build(h)).resolves.toBeTruthy();
  });

  it("refuses unless meta.final is true (absent reads as false)", async () => {
    await expect(
      build(await heldReport("extraction", ids, { meta: { final: false } })),
    ).rejects.toThrow(/meta\.final/);
    await expect(
      build(await heldReport("extraction", ids, { meta: { final: undefined } })),
    ).rejects.toThrow(/meta\.final/);
  });

  it("refuses unless mode is live", async () => {
    await expect(
      build(await heldReport("extraction", ids, { meta: { mode: "record" } })),
    ).rejects.toThrow(/live/);
  });

  it("refuses when runnerErrors is not empty", async () => {
    await expect(
      build(await heldReport("extraction", ids, { meta: { runnerErrors: ["h-2: bad"] } })),
    ).rejects.toThrow(/runnerErrors/);
  });

  it("refuses when a held-out id has no first-run row", async () => {
    const h = await heldReport("extraction", ids, {
      rows: [
        { id: "h-1", run: 1 },
        { id: "h-2", run: 1 },
      ],
    });
    await expect(build(h)).rejects.toThrow(/h-3/);
  });

  it("refuses a row for an id outside the held-out split", async () => {
    const rows = [...ids.map((id) => ({ id, run: 1 })), { id: "d-1", run: 1 }];
    await expect(build(await heldReport("extraction", ids, { rows }))).rejects.toThrow(/d-1/);
  });

  it("refuses two first-run rows for one id", async () => {
    const rows = [...ids.map((id) => ({ id, run: 1 })), { id: "h-2", run: 1 }];
    await expect(build(await heldReport("extraction", ids, { rows }))).rejects.toThrow(
      /more than one|twice|h-2/,
    );
  });
});

describe("buildSummary", () => {
  it("publishes live reports as a valid EvalSummary using the scorecard's own k, n and interval", async () => {
    const qa = await report("qa", {}, qaCard);
    const ex = await report("extraction", { mode: "live" }, exCard);
    const s = await buildSummary({ qa, extraction: ex }, new Date("2026-11-16T10:00:00Z"));
    expect(EvalSummary.parse(s)).toEqual(s);
    expect(s.suites.map((x) => x.suite)).toEqual(["extraction", "qa"]);
    const q = s.suites.find((x) => x.suite === "qa");
    expect(q?.metrics.find((x) => x.key === "unauthorised")).toMatchObject({ k: 0, n: 31 });
    expect(q?.metrics[0]?.ci95).toEqual([0.5, 1]);
    expect(q?.latency.find((x) => x.key === "answerMean")?.seconds).toBe(2);
    expect(q?.costUsdPerItem).toBe(0.001);
    expect(q?.runAt).toBe("2026-11-15T21:36:11.186Z");
  });

  it("publishes a record report whose guard and database spend match (nothing reused)", async () => {
    const qa = await report("qa", { spend: { guardUsd: 0.0315, dbUsd: 0.0315 } }, qaCard);
    const ex = await report("extraction", { spend: { guardUsd: 0.06, dbUsd: 0.06 } }, exCard);
    await expect(buildSummary({ qa, extraction: ex }, new Date())).resolves.toBeTruthy();
  });

  it("refuses a record report with a call served from a recording", async () => {
    const reused = await report("qa", { spend: { guardUsd: 0.01, dbUsd: 0.0315 } }, qaCard);
    const ex = await report("extraction", { mode: "live" }, exCard);
    await expect(buildSummary({ qa: reused, extraction: ex }, new Date())).rejects.toThrow(
      PublishRefusal,
    );
    const noSpend = await report("qa", { spend: undefined }, qaCard);
    await expect(buildSummary({ qa: noSpend, extraction: ex }, new Date())).rejects.toThrow(
      /served from recordings/,
    );
  });

  it("refuses a record report whose own count says a call was served from a recording, even when the spend matches", async () => {
    const reused = await report(
      "qa",
      { calls: { total: 12, fromRecordings: 3 }, spend: { guardUsd: 0.01, dbUsd: 0.01 } },
      qaCard,
    );
    await expect(buildSummary({ qa: reused }, new Date())).rejects.toThrow(
      /3 of 12 calls served from recordings is not a live measurement/,
    );
    const bad = await report("qa", { calls: { total: 12 } }, qaCard);
    await expect(buildSummary({ qa: bad }, new Date())).rejects.toThrow(/not a count/);
  });

  it("publishes a record report whose count is 0 and whose spend matches; the spend check still holds", async () => {
    const clean = await report("qa", { calls: { total: 12, fromRecordings: 0 } }, qaCard);
    await expect(buildSummary({ qa: clean }, new Date())).resolves.toBeTruthy();
    const spendOff = await report(
      "qa",
      { calls: { total: 12, fromRecordings: 0 }, spend: { guardUsd: 0.01, dbUsd: 0.02 } },
      qaCard,
    );
    await expect(buildSummary({ qa: spendOff }, new Date())).rejects.toThrow(
      /served from recordings/,
    );
  });

  for (const mode of ["replay", "oracle", "empty"]) {
    it(`a ${mode} report is refused`, async () => {
      const qa = await report("qa", { mode }, qaCard);
      await expect(buildSummary({ qa }, new Date())).rejects.toBeInstanceOf(PublishRefusal);
    });
  }

  it("every entry carries an errors metric, k errors over the cases or questions run", async () => {
    const err = { id: "x", kind: "api", message: "boom" };
    const qa = await report("qa", { mode: "live" }, { ...qaCard, errors: [err] });
    const ex = await report("extraction", { mode: "live" }, exCard);
    const s = await buildSummary({ qa, extraction: ex }, new Date());
    const label = "Errors, truncations and refusals (expected 0)";
    const q = s.suites.find((x) => x.suite === "qa")?.metrics.find((x) => x.key === "errors");
    expect(q).toMatchObject({ label, k: 1, n: 33 });
    expect(q?.rate).toBeCloseTo(1 / 33);
    expect(q?.ci95?.[0]).toBeGreaterThan(0);
    const e = s.suites
      .find((x) => x.suite === "extraction")
      ?.metrics.find((x) => x.key === "errors");
    expect(e).toMatchObject({ label, k: 0, n: 84, rate: 0 });
    expect(e?.ci95?.[0]).toBe(0);
    const noErrors = await report("qa", { mode: "live" }, { ...qaCard, errors: undefined });
    await expect(buildSummary({ qa: noErrors }, new Date())).rejects.toThrow(PublishRefusal);
  });

  it("a given report replaces only its (suite, split) entry and keeps the others", async () => {
    const qa = await report("qa", { mode: "live", label: "qa-1" }, qaCard);
    const ex = await report("extraction", { mode: "live", label: "ex-1" }, exCard);
    const first = await buildSummary({ qa, extraction: ex }, new Date("2026-11-16T10:00:00Z"));
    const qa2 = await report("qa", { mode: "live", label: "qa-2" }, qaCard);
    const second = await buildSummary({ qa: qa2 }, new Date("2026-11-16T11:00:00Z"), first);
    expect(second.suites.map((x) => `${x.suite}/${x.split}/${x.label}`)).toEqual([
      "extraction/dev/ex-1",
      "qa/dev/qa-2",
    ]);
    expect(second.generatedAt).toBe("2026-11-16T11:00:00.000Z");
  });

  it("held-out entries come before dev within a suite", async () => {
    const ids = ["q-1", "q-2"];
    const dev = await report("qa", { mode: "live", label: "qa-dev" }, qaCard);
    const held = await heldReport("qa", ids, {});
    const first = await buildSummary({ qa: dev }, new Date());
    const s = await buildSummary({ qa: held.dir }, new Date(), first, held.splitDir);
    expect(s.suites.map((x) => `${x.suite}/${x.split}`)).toEqual(["qa/heldout", "qa/dev"]);
    expect(EvalSummary.parse(s)).toEqual(s);
    expect(s.suites[0]?.label).toBe("qa-held");
  });

  it("the committed evals/published/summary.json parses as EvalSummary", async () => {
    const text = await readFile(join(import.meta.dirname, "published", "summary.json"), "utf8");
    expect(() => EvalSummary.parse(JSON.parse(text))).not.toThrow();
  });

  it("a report of the wrong suite is refused", async () => {
    const ex = await report("extraction", {}, exCard);
    await expect(buildSummary({ qa: ex }, new Date())).rejects.toBeInstanceOf(PublishRefusal);
  });
});
