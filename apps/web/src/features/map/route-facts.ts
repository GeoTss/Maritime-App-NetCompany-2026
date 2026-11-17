/**
 * Route-plan numbers come only from `RoutePlanResponse.facts`. A fact is matched to the option it
 * belongs to by its calculation provenance path (`options[1].totalCostUsd`), never by parsing its
 * label; a missing fact is `undefined` and renders as a dash. Nothing here computes a number.
 *
 * Paths name an output of the stored `RouteSpeedResult`. An array index may be written `[1]` or
 * `.1` (the fact id writes `.1`): both name the same output, so paths are compared with `.n`.
 */
import type {
  Fact,
  FuelGrade,
  RouteOptionResult,
  RoutePlanView,
  StopPlanReason,
  StopPlanResult,
  TrackFuel,
} from "@pharos/shared";

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

/** `options[1].eta` and `options.1.eta` are the same output. */
const samePath = (path: string) => path.replace(/\[(\d+)\]/g, ".$1");

/** The fact whose calculation provenance points at exactly this path. */
export function factAtPath(facts: readonly Fact[], path: string): Fact | undefined {
  const want = samePath(path);
  return facts.find(
    (f) => f.provenance.source === "calculation" && samePath(f.provenance.path) === want,
  );
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
/** The berth window's close, a field of the stored calculation's inputs. */
export const ARRIVE_BY_FIELD = "inputs.optimiser.arriveBy";

/** A fact read from a field of the stored calculation (`db` provenance on its row). */
export const dbFact = (facts: readonly Fact[], field: string) =>
  facts.find(
    (f) => f.provenance.source === "db" && samePath(f.provenance.field) === samePath(field),
  );

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
  insufficient_fuel: "Blocked: runs below the fuel margin",
};

export function reasonText(reason: InfeasibleReason): string {
  return REASON[reason];
}

const STOP_REASON: Record<StopPlanReason, string> = {
  misses_arrive_by: "arrives after the berth window closes",
  crosses_hazard: "crosses a reported hazard",
  insufficient_fuel: "runs below a fuel margin, before or after the stop",
  exceeds_tank_capacity: "the quantity does not fit the tank",
  insufficient_quantity: "the quote offers less than the quantity needed",
  outside_delivery_window: "arrives outside the quote's delivery window",
  no_sea_route: "no sea route through the port",
};

/** Why a stop plan cannot be proposed, in words (lower case: it follows the quote's name). */
export function stopReasonText(reason: StopPlanReason): string {
  return STOP_REASON[reason];
}

// ---- The fuel check, stop plans and the recommended plan (route-plan facts, Task 8 paths) ------

export const GRADES = ["LSMGO", "VLSFO", "HSFO"] as const satisfies readonly FuelGrade[];

/** A track in the outputs: a route option (`options[i]`) or a stop plan (`stopPlans[i]`). */
export type TrackRef = { kind: "option" | "stop"; index: number };

const trackPath = (t: TrackRef) => `${t.kind === "option" ? "options" : "stopPlans"}[${t.index}]`;

/** A field of a track: `options[i].eta`, `stopPlans[i].totalCostUsd`. */
export const trackFact = (facts: readonly Fact[], t: TrackRef, field: string) =>
  factAtPath(facts, `${trackPath(t)}.${field}`);

export type GradeCheckField =
  | "belowMarginAt.nm"
  | "belowMarginAt.at"
  | "runsDryAt.nm"
  | "runsDryAt.at"
  | "marginMt"
  | "shortfallMt";

/** One grade's fuel check on a track: `options[i].fuel.grades.LSMGO.belowMarginAt.nm`. */
export const gradeCheckFact = (
  facts: readonly Fact[],
  t: TrackRef,
  grade: FuelGrade,
  field: GradeCheckField,
) => factAtPath(facts, `${trackPath(t)}.fuel.grades.${grade}.${field}`);

type BreakpointKind = TrackFuel["breakpoints"][number]["kind"];

/** The index of a track's first breakpoint of this kind (a position in the list, not a value). */
export const breakpointIndex = (fuel: TrackFuel | null, kind: BreakpointKind): number =>
  fuel ? fuel.breakpoints.findIndex((b) => b.kind === kind) : -1;

/** Fuel on board of a grade at a breakpoint: `stopPlans[i].fuel.breakpoints[k].robMt.LSMGO`. */
export function breakpointRobFact(
  facts: readonly Fact[],
  t: TrackRef,
  fuel: TrackFuel | null,
  kind: BreakpointKind,
  grade: FuelGrade,
): Fact | undefined {
  const k = breakpointIndex(fuel, kind);
  return k < 0
    ? undefined
    : factAtPath(facts, `${trackPath(t)}.fuel.breakpoints[${k}].robMt.${grade}`);
}

/**
 * The grade a stop buys: the one whose fuel on board after bunkering the plan cites. The API cites
 * the bought grade only, so the facts name it; nothing is compared here.
 */
export function stopGrade(
  facts: readonly Fact[],
  index: number,
  fuel: TrackFuel | null,
): FuelGrade | null {
  const t: TrackRef = { kind: "stop", index };
  return GRADES.find((g) => breakpointRobFact(facts, t, fuel, "stop_departure", g)) ?? null;
}

export type StopField =
  | "arriveAt"
  | "waitingHours"
  | "weatherDelayHours"
  | "bunkeringHours"
  | "departAt";

/** A field of a stop plan's timeline: `stopPlans[i].stop.arriveAt`. */
export const stopFact = (facts: readonly Fact[], index: number, field: StopField) =>
  factAtPath(facts, `stopPlans[${index}].stop.${field}`);

export type PlanField =
  | "optionId"
  | "addedHours"
  | "addedUsd"
  | "next.optionId"
  | "next.totalCostUsd"
  | "next.marginUsd";

/** A field of the recommended plan: `plan.addedHours`, `plan.next.marginUsd`. */
export const planFact = (facts: readonly Fact[], field: PlanField) =>
  factAtPath(facts, `plan.${field}`);

/** A stop plan's quote price, when the plan cites it (a field of the stored inputs). */
export const stopPriceFact = (facts: readonly Fact[], index: number) =>
  dbFact(facts, `inputs.optimiser.stops.${index}.pricePerMt`);

/** Supplier and port of a quote, by quote id, from `GET /api/quotes` (text, never numbers). */
export type StopNames = ReadonlyMap<number, { supplier: string; port: string }>;

/** "Kestrel Marine Fuels at Marsaxlokk", or the port's UN/LOCODE when the quote is not known. */
export function stopPlanName(
  stop: Pick<StopPlanResult, "quoteId" | "unlocode">,
  names?: StopNames,
) {
  const named = stop.quoteId === null ? undefined : names?.get(stop.quoteId);
  return named
    ? { supplier: named.supplier, port: named.port }
    : { supplier: null, port: stop.unlocode };
}

/**
 * Whether the plan knows the fuel on board (a fleet vessel): an AIS ship's options carry no fuel
 * check, and the tray then shows the routes alone.
 */
export const knowsFuel = (plan: RoutePlanView) =>
  plan.result.options.some((o) => o.fuel !== null) || plan.result.plan !== null;

/** Where the recommended plan is in the outputs, or null when there is none. */
export function recommendedTrack(plan: RoutePlanView): TrackRef | null {
  const rec = plan.result.plan;
  if (!rec) return null;
  if (rec.kind === "stop") {
    const index = plan.result.stopPlans.findIndex((s) => s.optionId === rec.optionId);
    return index < 0 ? null : { kind: "stop", index };
  }
  const index = plan.result.options.findIndex((o) => o.candidateId === rec.optionId);
  return index < 0 ? null : { kind: "option", index };
}

/** The fuel check of a track, as returned. */
export function trackFuel(plan: RoutePlanView, t: TrackRef): TrackFuel | null {
  return t.kind === "stop"
    ? (plan.result.stopPlans[t.index]?.fuel ?? null)
    : (plan.result.options[t.index]?.fuel ?? null);
}

/** The best route ignoring fuel on board: `bestCandidateId`'s option. */
export function fuelBlindBest(plan: RoutePlanView): TrackRef | null {
  const index = plan.result.options.findIndex((o) => o.candidateId === plan.result.bestCandidateId);
  return index < 0 ? null : { kind: "option", index };
}

/** The grades a track falls below its margin on, in grade order (as the check returned them). */
export const gradesShort = (fuel: TrackFuel | null): FuelGrade[] =>
  fuel ? GRADES.filter((g) => fuel.grades[g].belowMarginAt !== null) : [];
