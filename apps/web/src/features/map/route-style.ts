import type { RoutePlanView } from "@pharos/shared";

/** How a candidate is drawn and keyed in the tray. Infeasible wins over every other role. */
export type RouteRole = "recommended" | "planned" | "infeasible" | "other";

export function routeRole(plan: RoutePlanView, optionIndex: number): RouteRole {
  const option = plan.result.options[optionIndex];
  if (!option) return "other";
  if (!option.feasible) return "infeasible";
  if (option.candidateId === plan.result.bestCandidateId) return "recommended";
  if (option.candidateId === plan.result.baseline.candidateId) return "planned";
  return "other";
}

export const ROLE_TEXT: Record<RouteRole, string> = {
  recommended: "Recommended",
  planned: "Current plan",
  infeasible: "Infeasible",
  other: "Alternative",
};

/** Swatch classes for the tray legend, matching what the map draws (colour, dash). */
export const ROLE_SWATCH: Record<RouteRole, string> = {
  recommended: "border-t-2 border-beacon",
  planned: "border-t-2 border-dashed border-plan",
  infeasible: "border-t-2 border-dotted border-alarm",
  other: "border-t border-plan",
};
