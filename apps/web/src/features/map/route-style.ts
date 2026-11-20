import type { RoutePlanView } from "@pharos/shared";

/** How a candidate is drawn and keyed in the tray. Infeasible wins over every other role. */
export type RouteRole = "recommended" | "planned" | "infeasible" | "other";

/**
 * The recommended route is the plan's own when the plan knows the fuel on board (a fleet vessel):
 * `result.plan` when it is a route, and none when it calls at a bunker port or nothing is
 * feasible. A ship seen on AIS has no fuel check, so its best route is the recommended one.
 */
function isRecommended(plan: RoutePlanView, candidateId: string): boolean {
  const { result } = plan;
  const knowsFuel = result.options.some((o) => o.fuel !== null) || result.plan !== null;
  if (!knowsFuel) return candidateId === result.bestCandidateId;
  return result.plan?.kind === "route" && result.plan.optionId === candidateId;
}

export function routeRole(plan: RoutePlanView, optionIndex: number): RouteRole {
  const option = plan.result.options[optionIndex];
  if (!option) return "other";
  if (!option.feasible) return "infeasible";
  if (isRecommended(plan, option.candidateId)) return "recommended";
  if (option.candidateId === plan.result.baseline.candidateId) return "planned";
  return "other";
}

export const ROLE_TEXT: Record<RouteRole, string> = {
  recommended: "Recommended",
  planned: "Current plan",
  infeasible: "Ruled out",
  other: "Alternative",
};

/** Swatch classes for the tray legend, matching what the map draws (colour, dash). */
export const ROLE_SWATCH: Record<RouteRole, string> = {
  recommended: "border-t-2 border-beacon",
  planned: "border-t-2 border-dashed border-plan",
  infeasible: "border-t-2 border-dotted border-alarm",
  other: "border-t border-plan",
};
