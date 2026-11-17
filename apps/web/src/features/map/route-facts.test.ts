import { describe, expect, it } from "vitest";
import { makeFuelPlan, makePlan } from "./map-fixtures";
import {
  breakpointRobFact,
  factAtPath,
  gradeCheckFact,
  loadFacts,
  optionFact,
  planFact,
  reasonText,
  recommendedTrack,
  savingFact,
  stopFact,
  stopGrade,
  stopReasonText,
} from "./route-facts";

describe("route facts", () => {
  it("finds an option's fact by its calculation path, not its label", () => {
    const plan = makePlan();
    const fact = optionFact(plan.facts, 1, "totalCostUsd");
    expect(fact?.id).toBe("f_plan_options.1.totalCostUsd");
    expect(fact?.provenance).toMatchObject({ path: "options[1].totalCostUsd" });
  });

  it("returns undefined when the fact is absent", () => {
    const plan = makePlan({ omitFact: (f) => f.id === "f_plan_options.2.co2T" });
    expect(optionFact(plan.facts, 2, "co2T")).toBeUndefined();
    expect(optionFact(plan.facts, 1, "co2T")).toBeDefined();
  });

  it("reads load facts by what they cite", () => {
    const loads = loadFacts(makePlan().facts);
    expect(loads.displacement?.value).toBe(65000);
    expect(loads.loadFactor?.value).toBe(0.96);
    expect(loads.loadCondition?.value).toBe("partial");
    expect(loads.aisDraught?.value).toBe(8.2);
  });

  it("matches load facts by provenance, so a relabel changes nothing", () => {
    const facts = makePlan().facts.map((f) => ({ ...f, label: "renamed" }));
    const loads = loadFacts(facts);
    expect(loads.loadCondition?.id).toBe("f_plan_loadCondition");
    expect(loads.aisDraught?.id).toBe("f_plan_aisDraught");
    expect(loads.displacement?.id).toBe("f_plan_displacement");
  });

  it("does not take a similarly named field for a load fact", () => {
    const facts = makePlan({ omitFact: (f) => f.id === "f_plan_loadFactor" }).facts.map((f) =>
      f.id === "f_plan_displacement"
        ? { ...f, provenance: { ...f.provenance, field: "x.loadFactor" } as typeof f.provenance }
        : f,
    );
    expect(loadFacts(facts).loadFactor).toBeUndefined();
    expect(loadFacts(facts).displacement).toBeUndefined();
  });

  it("reads the saving fact", () => {
    expect(savingFact(makePlan().facts)?.value).toBe(48024.5);
  });

  it("explains every infeasible reason in words", () => {
    expect(reasonText("crosses_hazard")).toMatch(/hazard/i);
    expect(reasonText("misses_arrive_by")).toMatch(/berth window/i);
  });

  it("reads a path written with brackets or dots alike", () => {
    const facts = makePlan().facts;
    expect(factAtPath(facts, "options.1.totalCostUsd")?.id).toBe("f_plan_options.1.totalCostUsd");
  });

  it("reads the recommended plan, its stop and the fuel check by output path", () => {
    const plan = makeFuelPlan();
    const { facts } = plan;
    expect(recommendedTrack(plan)).toEqual({ kind: "stop", index: 0 });
    expect(planFact(facts, "addedHours")?.value).toBe(21.3);
    expect(planFact(facts, "next.marginUsd")?.value).toBe(6300);
    expect(stopFact(facts, 0, "arriveAt")?.value).toBe("2026-11-17T20:00:00.000Z");
    const stop = plan.result.stopPlans[0]?.fuel ?? null;
    expect(stopGrade(facts, 0, stop)).toBe("LSMGO");
    expect(
      breakpointRobFact(facts, { kind: "stop", index: 0 }, stop, "stop_departure", "LSMGO")?.value,
    ).toBe(381);
    expect(
      gradeCheckFact(facts, { kind: "option", index: 1 }, "LSMGO", "belowMarginAt.nm")?.value,
    ).toBe(2511);
    expect(recommendedTrack(makeFuelPlan({ infeasible: true }))).toBeNull();
  });

  it("explains every stop plan reason in words", () => {
    expect(stopReasonText("outside_delivery_window")).toMatch(/delivery window/);
    expect(stopReasonText("no_sea_route")).toMatch(/no sea route/);
    expect(reasonText("insufficient_fuel")).toMatch(/fuel margin/);
  });
});
