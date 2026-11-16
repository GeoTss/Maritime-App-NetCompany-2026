/** The eval publisher: live dev reports become the published summary; everything else is refused. */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

  it("a heldout report is refused", async () => {
    const qa = await report("qa", { split: "heldout" }, qaCard);
    await expect(buildSummary({ qa }, new Date())).rejects.toBeInstanceOf(PublishRefusal);
  });

  it("a report of the wrong suite is refused", async () => {
    const ex = await report("extraction", {}, exCard);
    await expect(buildSummary({ qa: ex }, new Date())).rejects.toBeInstanceOf(PublishRefusal);
  });
});
