/**
 * Where a route plan's option keeps its security plan (Track 3): a route option, found by its
 * candidate id under `options[i]`, or a bunker stop plan, found by its option id under
 * `stopPlans[i]`. Proposing, executing and showing a security order all look it up here, so they
 * agree on which team an option needs.
 */
import type { RouteSpeedResult, SecurityPlanResult } from "@pharos/shared";

export interface OptionSecurity {
  kind: "route" | "stop";
  index: number;
  /** The fact path the security plan's facts sit under, e.g. `stopPlans[0].security`. */
  path: string;
  security: SecurityPlanResult | null;
  feasible: boolean;
  reasons: readonly string[];
}

export function optionSecurityOf(
  result: Pick<RouteSpeedResult, "options" | "stopPlans">,
  optionId: string,
): OptionSecurity | null {
  const i = result.options.findIndex((o) => o.candidateId === optionId);
  const o = result.options[i];
  if (o) {
    return {
      kind: "route",
      index: i,
      path: `options[${i}].security`,
      security: o.security ?? null,
      feasible: o.feasible,
      reasons: o.reasons,
    };
  }
  const k = result.stopPlans.findIndex((s) => s.optionId === optionId);
  const s = result.stopPlans[k];
  if (!s) return null;
  return {
    kind: "stop",
    index: k,
    path: `stopPlans[${k}].security`,
    security: s.security ?? null,
    feasible: s.feasible,
    reasons: s.reasons,
  };
}
