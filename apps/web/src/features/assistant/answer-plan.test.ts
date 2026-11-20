import type { AskResponse, AskSubject, Fact } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { answerMapLink, answerPlan } from "./answer-plan";

const calcFact = (calculationId: number, calculator: string): Fact => ({
  id: `f_calc_${calculationId}_${calculator}`,
  label: `Output of ${calculator} ${calculationId}`,
  value: 1,
  unit: null,
  provenance: { source: "calculation", calculationId, calculator, path: "options[0].x" },
});
const dbFact = (): Fact => ({
  id: "f_price",
  label: "Price",
  value: 612.5,
  unit: "USD/mt",
  provenance: { source: "db", table: "quotes", rowId: 7, field: "price" },
});
const resp = (facts: Fact[], subjects: AskSubject[] = []): AskResponse => ({
  conversationId: 1,
  messageId: 2,
  answer: "text",
  facts,
  recommendationIds: [],
  llmCallIds: [],
  subjects,
  gate: { passed: true, repaired: false, ungroundedCount: 0, attempts: [] },
});

describe("answerPlan (ruling U3)", () => {
  it("prefers a cited route plan over a later bunker plan (the route plan holds the stop)", () => {
    expect(answerPlan(resp([calcFact(2, "route_speed"), calcFact(3, "planBunkers")]))).toEqual({
      kind: "route",
      calculationId: 2,
    });
  });

  it("picks the highest cited plan id", () => {
    expect(answerPlan(resp([calcFact(1, "planBunkers"), calcFact(5, "route_speed")]))).toEqual({
      kind: "route",
      calculationId: 5,
    });
  });

  it("is null for an answer that cites no plan", () => {
    expect(answerPlan(resp([dbFact()]))).toBeNull();
  });

  it("ignores other calculators, even with a higher id", () => {
    expect(
      answerPlan(
        resp([
          calcFact(2, "planBunkers"),
          calcFact(9, "emissions"),
          calcFact(8, "projectFuelOnBoard"),
          calcFact(7, "constructor"),
        ]),
      ),
    ).toEqual({ kind: "bunker", calculationId: 2 });
  });

  it("ignores derived facts built on a plan's facts", () => {
    const derived: Fact = {
      id: "f_margin",
      label: "Margin",
      value: 5310.37,
      unit: "USD",
      provenance: { source: "derived", operation: "subtract", operands: ["f_a", "f_b"] },
    };
    expect(answerPlan(resp([derived]))).toBeNull();
  });
});

describe("answerMapLink", () => {
  it("links to the subject and the plan", () => {
    expect(
      answerMapLink(resp([calcFact(1, "planBunkers")], [{ kind: "vessel", vesselId: 1 }])),
    ).toBe("/?vessel=1&bunkerPlan=1");
  });

  it("links a fleet vessel's route plan", () => {
    expect(
      answerMapLink(resp([calcFact(5, "route_speed")], [{ kind: "vessel", vesselId: 1 }])),
    ).toBe("/?vessel=1&routePlan=5");
  });

  it("leaves an AIS route plan off the link (ruling U5)", () => {
    expect(
      answerMapLink(resp([calcFact(4, "route_speed")], [{ kind: "ais", mmsi: "244000000" }])),
    ).toBe("/?mmsi=244000000");
  });

  it("links the plan alone when the answer names no subject", () => {
    expect(answerMapLink(resp([calcFact(1, "planBunkers")], []))).toBe("/?bunkerPlan=1");
  });

  it("uses the first subject the tools resolved", () => {
    expect(
      answerMapLink(
        resp(
          [],
          [
            { kind: "vessel", vesselId: 3 },
            { kind: "ais", mmsi: "123456789" },
          ],
        ),
      ),
    ).toBe("/?vessel=3");
  });

  it("is null when the answer cites no plan and names no subject", () => {
    expect(answerMapLink(resp([dbFact()], []))).toBeNull();
  });
});
