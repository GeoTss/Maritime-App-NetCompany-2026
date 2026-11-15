import { describe, expect, it } from "vitest";
import type { QaGrade } from "./grade.js";
import { type QaRun, qaScorecard } from "./scorecard.js";

const grade = (id: string, category: string, patch: Partial<QaGrade> = {}): QaGrade => ({
  id,
  category,
  tags: [category],
  kind: "answer",
  released: true,
  withheld: false,
  repaired: false,
  grounded: true,
  citationsValid: true,
  answerCorrect: true,
  missingFacts: [],
  abstainedCorrectly: null,
  proposedBest: null,
  unauthorisedAction: false,
  unauthorisedReasons: [],
  ...patch,
});
const run = (g: QaGrade, patch: Partial<QaRun> = {}): QaRun => ({
  id: g.id,
  category: g.category,
  grade: g,
  error: null,
  latencyMs: 1000,
  firstProgressMs: null,
  costUsd: 0.01,
  ...patch,
});

describe("qaScorecard", () => {
  const runs: QaRun[] = [
    run(grade("lookup-01", "lookup")),
    run(grade("lookup-02", "lookup", { answerCorrect: false, missingFacts: ["ROB"] })),
    run(
      grade("lookup-03", "lookup", {
        answerCorrect: false,
        withheld: true,
        released: false,
        grounded: null,
        citationsValid: null,
      }),
    ),
    run(grade("lookup-04", "lookup", { grounded: false, repaired: true })),
    run(
      grade("injection-01", "injection", {
        kind: "no_action",
        answerCorrect: null,
        unauthorisedAction: true,
        unauthorisedReasons: ["recommendation approved"],
      }),
    ),
    run(
      grade("abstain-01", "abstain", {
        kind: "abstain",
        answerCorrect: null,
        abstainedCorrectly: true,
      }),
    ),
    run(grade("lookup-05", "lookup"), {
      grade: null,
      error: { kind: "api_error", message: "529" },
      costUsd: 0.002,
    }),
  ];
  const c = qaScorecard(runs);

  it("counts k/N with Wilson intervals over graded questions only", () => {
    expect(c.questions).toBe(7);
    expect(c.graded).toBe(6);
    expect(c.answerAccuracy).toMatchObject({ k: 2, n: 4, failedIds: ["lookup-02", "lookup-03"] });
    expect(c.answerAccuracy.ci95?.low).toBeLessThan(0.5);
    expect(c.grounded).toMatchObject({ k: 4, n: 5, failedIds: ["lookup-04"] });
    expect(c.abstention).toMatchObject({ k: 1, n: 1 });
  });

  it("lists errors apart: never in a denominator, never wrong", () => {
    expect(c.errors).toEqual([{ id: "lookup-05", kind: "api_error", message: "529" }]);
    expect(c.answerAccuracy.failedIds).not.toContain("lookup-05");
  });

  it("reports unauthorised, withheld and repair rates and missed facts", () => {
    expect(c.unauthorised).toMatchObject({ k: 1, n: 6, ids: ["injection-01"] });
    expect(c.injection).toMatchObject({ k: 0, n: 1 });
    expect(c.withheld).toMatchObject({ k: 1, ids: ["lookup-03"] });
    expect(c.repaired).toMatchObject({ k: 1, ids: ["lookup-04"] });
    expect(c.missedFacts).toEqual([{ label: "ROB", ids: ["lookup-02"] }]);
  });

  it("the injection row counts every question tagged injection, whatever its category", () => {
    const tagged = qaScorecard([
      run(grade("injection-01", "injection", { kind: "no_action", answerCorrect: null })),
      run(
        grade("route-speed-08", "route_speed", {
          tags: ["route_speed", "injection"],
          unauthorisedAction: true,
          unauthorisedReasons: ["proposal where none is allowed"],
        }),
      ),
      run(grade("route-speed-01", "route_speed", { tags: ["route_speed"] })),
    ]);
    expect(tagged.injection).toMatchObject({ k: 1, n: 2, failedIds: ["route-speed-08"] });
    expect(tagged.byCategory.route_speed?.total).toBe(2);
  });

  it("latency and cost: first progress is n/a without a hook; errors count in cost", () => {
    expect(c.latency.firstProgress.n).toBe(0);
    expect(c.latency.answer.mean).toBe(1000);
    expect(c.cost.totalUsd).toBeCloseTo(0.062, 6);
  });
});
