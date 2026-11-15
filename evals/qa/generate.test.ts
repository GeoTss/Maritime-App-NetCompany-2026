import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { QA_CATEGORIES, QaTruth } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { diffQaGolden, renderQaGolden } from "./generate.js";
import { QUESTIONS } from "./questions.js";
import { buildTruth, qaPlan, qaWorld, resolveFact, toleranceFor } from "./reference.js";
import { QA_GOLDEN_DIR } from "./split.js";

const COUNTS = {
  lookup: 10,
  comparison: 8,
  bunker_decision: 8,
  calculate: 6,
  abstain: 6,
  no_action: 4,
  injection: 4,
};

describe("question specs", () => {
  it("are 46 with unique ids and the required count per category", () => {
    expect(QUESTIONS).toHaveLength(46);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(46);
    for (const c of QA_CATEGORIES) {
      expect(QUESTIONS.filter((q) => q.category === c)).toHaveLength(COUNTS[c]);
    }
  });
});

describe("reference answers", () => {
  const world = qaWorld();

  it("are reproducible: two builds give identical truths", () => {
    const a = QUESTIONS.map((q) => buildTruth(world, q));
    const b = QUESTIONS.map((q) => buildTruth(qaWorld(), q));
    expect(b).toEqual(a);
  });

  it("make the demo question's expected option MTMLA-kestrel", () => {
    expect(qaPlan(world).result.bestOptionId).toBe("MTMLA-kestrel");
    const demo = buildTruth(world, QUESTIONS.find((q) => q.id === "decision-01") as never);
    expect(demo.expect.proposedOptionId).toBe("MTMLA-kestrel");
  });

  it("compute the derived fact of a calculate question from its operands", () => {
    const k = buildTruth(world, QUESTIONS.find((q) => q.id === "calculate-01") as never);
    const [fact] = k.expect.requiredFacts;
    expect(fact?.label).toMatch(
      /^subtract of Kestrel .* price per mt and Strait Line .* price per mt$/,
    );
    expect(fact?.value).toBe(26);
    expect(fact?.unit).toBe("USD/mt");
  });

  it("rejects a non-numeric calculate operand", () => {
    expect(() =>
      resolveFact(world, {
        src: "calc",
        op: "add",
        operands: [{ src: "quote", supplier: "kestrel", port: "MTMLA", field: "supplier" }],
      }),
    ).toThrow(/not a number/);
  });

  it("uses an exact tolerance for integers and a rounding step otherwise", () => {
    expect(toleranceFor(738)).toBe(0);
    expect(toleranceFor(233914.449)).toBe(0.5);
    expect(toleranceFor(3.65)).toBe(0.06);
    expect(toleranceFor(0.5)).toBe(0.005);
  });
});

describe("golden files", () => {
  it("every truth on disk parses QaTruth, with tags[0] the question's category", async () => {
    const { truths } = renderQaGolden();
    for (const t of truths) {
      const onDisk = QaTruth.parse(
        JSON.parse(await readFile(join(QA_GOLDEN_DIR, `${t.id}.truth.json`), "utf8")),
      );
      expect(onDisk).toEqual(t);
      expect(QA_CATEGORIES).toContain(onDisk.tags[0]);
    }
  });

  it("are byte-stable: a regeneration equals the files on disk (--check)", async () => {
    const { files } = renderQaGolden();
    expect(await diffQaGolden(files, QA_GOLDEN_DIR)).toEqual([]);
  });

  it("detect drift, a missing file and a stale file", async () => {
    const { files } = renderQaGolden();
    const changed = new Map(files).set("lookup-01.truth.json", "{}\n");
    changed.delete("lookup-02.truth.json");
    expect(await diffQaGolden(changed, QA_GOLDEN_DIR)).toEqual([
      "differs: lookup-01.truth.json",
      "stale: lookup-02.truth.json",
    ]);
  });

  it("REVIEW-QA.md lists all 46 questions", async () => {
    const review = await readFile(join(QA_GOLDEN_DIR, "REVIEW-QA.md"), "utf8");
    for (const q of QUESTIONS) expect(review).toContain(`### ${q.id} [`);
  });
});
