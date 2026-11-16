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

const dbField = (f: Fact) => (f.provenance.source === "db" ? f.provenance.field : "");

/**
 * Load facts, shown only once a plan exists. Displacement and load factor are calculation inputs
 * (matched by the field they cite); an AIS ship's draught and load condition carry no path, so
 * those two are matched by the end of their label ("MMSI <n>: AIS draught").
 */
export function loadFacts(facts: readonly Fact[]): LoadFacts {
  const out: LoadFacts = {};
  for (const f of facts) {
    const field = dbField(f);
    if (field.endsWith("load.displacementMt") || field.endsWith("displacementMt")) {
      out.displacement ??= f;
    } else if (field.endsWith("loadFactor")) {
      out.loadFactor ??= f;
    } else if (/: AIS draught$/.test(f.label)) {
      out.aisDraught ??= f;
    } else if (/: load condition$/.test(f.label)) {
      out.loadCondition ??= f;
    }
  }
  return out;
}

export type InfeasibleReason = RouteOptionResult["reasons"][number];

const REASON: Record<InfeasibleReason, string> = {
  crosses_hazard: "Passes through a reported hazard zone",
  misses_arrive_by: "Arrives after the berth window closes",
};

export function reasonText(reason: InfeasibleReason): string {
  return REASON[reason];
}
