/**
 * Route-plan numbers come only from `RoutePlanResponse.facts`. A fact is matched to the option it
 * belongs to by its calculation provenance path (`options[1].totalCostUsd`), never by parsing its
 * label; a missing fact is `undefined` and renders as a dash. Nothing here computes a number.
 */
import type { Fact, RouteOptionResult } from "@pharos/shared";

export type OptionMetric =
  | "distanceNm"
  | "speedKn"
  | "eta"
  | "totalFuelMt"
  | "co2T"
  | "etsCostUsd"
  | "fuelEuCostUsd"
  | "totalCostUsd"
  | "weatherDelayHours";

/** The fact whose calculation provenance points at exactly this path. */
export function factAtPath(facts: readonly Fact[], path: string): Fact | undefined {
  return facts.find((f) => f.provenance.source === "calculation" && f.provenance.path === path);
}

/** One metric of `options[index]`. */
export function optionFact(
  facts: readonly Fact[],
  index: number,
  metric: OptionMetric,
): Fact | undefined {
  return factAtPath(facts, `options[${index}].${metric}`);
}

/** One metric of the current plan (`baseline`). */
export function baselineFact(facts: readonly Fact[], metric: OptionMetric): Fact | undefined {
  return factAtPath(facts, `baseline.${metric}`);
}

export const savingFact = (facts: readonly Fact[]) => factAtPath(facts, "savingVsBaselineUsd");
export const fuelSavingFact = (facts: readonly Fact[]) =>
  factAtPath(facts, "fuelSavingVsBaselineMt");

export interface LoadFacts {
  displacement?: Fact;
  loadFactor?: Fact;
  loadCondition?: Fact;
  aisDraught?: Fact;
}

/**
 * Provenance keys of the load facts. Copied from the API's fact builder
 * (apps/api/src/routing/facts.ts: DISPLACEMENT_PATH, LOAD_FACTOR_PATH, LOAD_CONDITION_PATH);
 * this app never imports backend code. The AIS draught is recognised by its `ais` provenance.
 */
export const DISPLACEMENT_FIELD = "inputs.optimiser.curve.load.displacementMt";
export const LOAD_FACTOR_FIELD = "inputs.loadFactor";
export const LOAD_CONDITION_FIELD = "inputs.loadCondition";

const dbFact = (facts: readonly Fact[], field: string) =>
  facts.find((f) => f.provenance.source === "db" && f.provenance.field === field);

/** Load facts, shown only once a plan exists. Matched by what each fact cites, never by label. */
export function loadFacts(facts: readonly Fact[]): LoadFacts {
  return {
    displacement: dbFact(facts, DISPLACEMENT_FIELD),
    loadFactor: dbFact(facts, LOAD_FACTOR_FIELD),
    loadCondition: dbFact(facts, LOAD_CONDITION_FIELD),
    aisDraught: facts.find((f) => f.provenance.source === "ais"),
  };
}

export type InfeasibleReason = RouteOptionResult["reasons"][number];

const REASON: Record<InfeasibleReason, string> = {
  crosses_hazard: "Blocked: crosses the reported hazard",
  misses_arrive_by: "Blocked: arrives after the berth window closes",
};

export function reasonText(reason: InfeasibleReason): string {
  return REASON[reason];
}
