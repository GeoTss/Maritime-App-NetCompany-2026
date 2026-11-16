import { describe, expect, it } from "vitest";
import { makePlan } from "./map-fixtures";
import { loadFacts, optionFact, reasonText, savingFact } from "./route-facts";

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
});
