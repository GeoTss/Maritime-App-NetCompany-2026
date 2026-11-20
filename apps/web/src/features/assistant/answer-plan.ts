/**
 * Which stored plan an answer cited, and the map address that shows it. Read from the answer's
 * own facts and subjects, never from its text: the map then draws the exact calculation the
 * answer cited, through a GET (ruling U1).
 */
import type { AskResponse } from "@pharos/shared";

export type AnswerPlan = { kind: "bunker" | "route"; calculationId: number };

/** The calculators whose stored calculations the map can draw by id. */
const PLAN_KIND = new Map<string, AnswerPlan["kind"]>([
  ["planBunkers", "bunker"],
  ["route_speed", "route"],
]);

/**
 * Ruling U3, amended for the joint route-and-bunker plan: a cited route plan wins over a cited
 * bunker plan (the route plan holds the bunker stop and its quote); within a kind, the cited
 * calculation with the highest id.
 */
export function answerPlan(response: AskResponse): AnswerPlan | null {
  let plan: AnswerPlan | null = null;
  for (const fact of response.facts) {
    const p = fact.provenance;
    if (p.source !== "calculation") continue;
    const kind = PLAN_KIND.get(p.calculator);
    if (kind === undefined) continue;
    const better =
      plan === null ||
      (kind === "route" && plan.kind === "bunker") ||
      (kind === plan.kind && p.calculationId > plan.calculationId);
    if (better) plan = { kind, calculationId: p.calculationId };
  }
  return plan;
}

/** "/?vessel=1&bunkerPlan=1" (or mmsi=…); null when the answer cites no plan and names no subject. */
export function answerMapLink(response: AskResponse): string | null {
  const params = new URLSearchParams();
  // The ship the answer is about: the first subject the tools resolved.
  const subject = response.subjects[0];
  if (subject?.kind === "vessel") params.set("vessel", String(subject.vesselId));
  else if (subject?.kind === "ais") params.set("mmsi", subject.mmsi);

  const plan = answerPlan(response);
  if (plan?.kind === "bunker") params.set("bunkerPlan", String(plan.calculationId));
  // Ruling U5: a public AIS ship's route plan is not served by id, so the link selects the ship.
  else if (plan?.kind === "route" && subject?.kind !== "ais") {
    params.set("routePlan", String(plan.calculationId));
  }

  const query = params.toString();
  return query === "" ? null : `/?${query}`;
}
