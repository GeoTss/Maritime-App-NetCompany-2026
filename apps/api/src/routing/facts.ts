/**
 * The facts a route plan yields, as pure rows: a JSON path, a label, a value and a unit.
 * `routeFactOfRow` turns a row into the `Fact` the route tool returns (calculation provenance for a
 * path into the stored calculation; `weather.modelRun` (the forecast's start, stored as the
 * snapshot's model_run) carries weather provenance; `ais.draughtM` (an AIS ship's reported draught)
 * carries AIS provenance; `calculation.id` is the calculation's own row); the approval view
 * re-derives the same facts with it, so the ids the agent cited resolve there. A path starting
 * `inputs.` is a field of the stored calculation's inputs (cited as `db` on the calculation row);
 * every other path points into its outputs (the `RouteSpeedResult`) and resolves to exactly the
 * row's value. The Q&A reference reuses these rows. A fleet vessel's rows also cite where each
 * route runs short of fuel, every bunker stop plan and the recommended plan; their labels say the
 * best route ignores fuel on board. A ship seen on AIS has none of these, and its labels are as
 * they were.
 */
import type { RoutePlan } from "@pharos/db";
import { type DraughtCondition, loadFactor } from "@pharos/domain";
import {
  type AisTraffic,
  type Fact,
  FUEL_GRADES,
  type FuelBreakpoint,
  type FuelGrade,
  type Id,
  type NavHazard,
  type RouteSpeedInput,
  type RouteSpeedResult,
  type StopPlanResult,
  type StopTimeline,
  type TrackFuel,
} from "@pharos/shared";
import { calcFact, dbFact, factId } from "../facts/core.js";
import type { PlannedRoute } from "./plan.js";

/** The tool name in every route fact id. */
export const ROUTE_TOOL = "plan_route_speed";
const CALCULATOR = "route_speed";

/**
 * What the fact rows read of a plan: rebuilt from a stored calculation's inputs by the view. The
 * curve and the load condition are optional there (the view shows one route's facts, not the
 * load); without them the load rows are left out.
 */
export type RouteFactPlan = Pick<RoutePlan, "subject" | "profile"> & {
  destination: Pick<RoutePlan["destination"], "name">;
  input: Pick<RoutePlan["input"], "candidates" | "arriveBy"> &
    Partial<Pick<RouteSpeedInput, "curve">>;
  loadCondition?: DraughtCondition | null;
};

export interface RouteFactRow {
  path: string;
  label: string;
  value: number | string | boolean;
  unit: string | null;
}

/**
 * How a ship is named in labels: a fleet vessel by name, an AIS ship by MMSI (an AIS name is
 * untrusted text and stays out of labels).
 */
export const subjectLabel = (plan: Pick<RoutePlan, "subject">, mmsi: string | null): string =>
  mmsi ? `MMSI ${mmsi}` : plan.subject;

export const WEATHER_RUN_PATH = "weather.modelRun";
export const CALCULATION_ID_PATH = "calculation.id";
/** An AIS ship's reported draught: AIS provenance on the position row the plan read. */
export const AIS_DRAUGHT_PATH = "ais.draughtM";
/** The plan's load, stored beside the optimiser input (see `routeCalculationLoad`). */
export const DISPLACEMENT_PATH = "inputs.optimiser.curve.load.displacementMt";
export const LOAD_FACTOR_PATH = "inputs.loadFactor";
export const LOAD_CONDITION_PATH = "inputs.loadCondition";

/** A load condition as a fact states it: "assumed laden", "laden", "partial", "ballast". */
export const loadConditionText = (c: DraughtCondition): string => c.replaceAll("_", " ");

/**
 * What a route calculation stores of its load beside the optimiser input, so the load facts
 * resolve exactly: the curve's load factor (`loadFactor`, packages/domain; null when the curve
 * carries no load) and, for an AIS ship, the load condition its draught implies.
 */
export function routeCalculationLoad(
  plan: Pick<RoutePlan, "loadCondition"> & { input: Pick<RouteSpeedInput, "curve"> },
): { loadFactor: number | null; loadCondition: string | null } {
  const load = plan.input.curve.load;
  return {
    loadFactor: load ? loadFactor(load) : null,
    loadCondition: plan.loadCondition ? loadConditionText(plan.loadCondition) : null,
  };
}

/** Label builders the Q&A reference reuses: `<subject>: <name>` and `<subject>, route <id>: <name>`. */
export const LOAD_LABELS = {
  displacement: (S: string) => `${S}: displacement`,
  loadFactor: (S: string) => `${S}: load factor`,
  loadCondition: (S: string) => `${S}: load condition`,
  aisDraught: (S: string) => `${S}: AIS draught`,
} as const;
export const routeOptionLabel = (S: string, candidateId: string, name: string) =>
  `${S}, route ${candidateId}: ${name}`;
export const FUELEU_EXPOSURE = "FuelEU exposure";
/** Each route's EU ETS cost, so a question can set it beside the FuelEU exposure (Ruling 12). */
export const EU_ETS_COST = "EU ETS cost";

const OPTION_FIELDS: {
  key:
    | "distanceNm"
    | "speedKn"
    | "eta"
    | "totalFuelMt"
    | "co2T"
    | "etsCostUsd"
    | "fuelEuCostUsd"
    | "totalCostUsd"
    | "weatherDelayHours";
  text: (d: string) => string;
  unit: string | null;
}[] = [
  { key: "distanceNm", text: () => "distance", unit: "nm" },
  { key: "speedKn", text: () => "recommended speed", unit: "kn" },
  { key: "eta", text: (d) => `ETA at ${d} (UTC)`, unit: null },
  { key: "totalFuelMt", text: () => "fuel", unit: "mt" },
  { key: "co2T", text: () => "CO₂", unit: "t CO₂" },
  { key: "etsCostUsd", text: () => EU_ETS_COST, unit: "USD" },
  { key: "fuelEuCostUsd", text: () => FUELEU_EXPOSURE, unit: "USD" },
  {
    key: "totalCostUsd",
    text: () => "total voyage cost (fuel, EU ETS, FuelEU, vessel time)",
    unit: "USD",
  },
  { key: "weatherDelayHours", text: () => "weather delay", unit: "h" },
];

/**
 * A stop plan's fields as facts, labelled `<subject>, <stop plan id>: <name>`. The stop plan id is
 * the bunker option id (`MTMLA-kestrel`): the quote's port and supplier.
 */
type StopPlanKey = keyof Pick<
  StopPlanResult,
  | "speedKn"
  | "eta"
  | "hours"
  | "qtyMt"
  | "voyageCostUsd"
  | "bunkerFuelCostUsd"
  | "bargeFeeUsd"
  | "totalCostUsd"
>;
type StopKey = keyof Omit<StopTimeline, "beyondForecast">;
const STOP_PLAN_FIELDS: ({ text: (d: string) => string; unit: string | null } & (
  | { key: StopPlanKey }
  | { stopKey: StopKey }
))[] = [
  { key: "speedKn", text: () => "recommended speed", unit: "kn" },
  { key: "eta", text: (d) => `ETA at ${d} (UTC)`, unit: null },
  { key: "hours", text: (d) => `time to ${d}, stop included`, unit: "h" },
  { stopKey: "arriveAt", text: () => "arrival at the bunker stop (UTC)", unit: null },
  { stopKey: "waitingHours", text: () => "waiting at the bunker stop", unit: "h" },
  { stopKey: "weatherDelayHours", text: () => "weather delay before bunkering", unit: "h" },
  { stopKey: "bunkeringHours", text: () => "bunkering time", unit: "h" },
  { stopKey: "departAt", text: () => "departure from the bunker stop (UTC)", unit: null },
  { key: "qtyMt", text: () => "quantity bought", unit: "mt" },
  {
    key: "voyageCostUsd",
    text: () => "voyage cost (fuel burned, EU ETS, FuelEU, vessel time)",
    unit: "USD",
  },
  { key: "bunkerFuelCostUsd", text: () => "cost of the fuel bought", unit: "USD" },
  { key: "bargeFeeUsd", text: () => "barge fee", unit: "USD" },
  {
    key: "totalCostUsd",
    text: () => "plan total (voyage cost, fuel bought and barge fee)",
    unit: "USD",
  },
];

/** The fuel-on-board breakpoints a stop plan cites for the grade it buys. */
const STOP_FUEL_POINTS: { kind: FuelBreakpoint["kind"]; text: (g: string, d: string) => string }[] =
  [
    { kind: "stop_arrival", text: (g) => `${g} on board at stop arrival` },
    { kind: "stop_departure", text: (g) => `${g} on board after bunkering` },
    { kind: "end", text: (g, d) => `${g} on board at ${d}` },
  ];

/** The index of a track's first breakpoint of `kind`, or -1. */
const breakpointIndex = (fuel: TrackFuel, kind: FuelBreakpoint["kind"]) =>
  fuel.breakpoints.findIndex((b) => b.kind === kind);

/**
 * The grade a stop plan buys, read from its stored result: the one grade whose fuel on board is
 * higher on leaving the stop than on arriving (the stay only burns). Read from the result, not the
 * optimiser input, so the stored-plan view (which keeps only part of the input) cites the same.
 */
function boughtGrade(fuel: TrackFuel): FuelGrade | null {
  const arrive = fuel.breakpoints[breakpointIndex(fuel, "stop_arrival")];
  const depart = fuel.breakpoints[breakpointIndex(fuel, "stop_departure")];
  if (!arrive || !depart) return null;
  return FUEL_GRADES.find((g) => depart.robMt[g] > arrive.robMt[g]) ?? null;
}

/**
 * Where a no-stop option's fuel check fails, per grade that drops below its margin: where (distance
 * along the route and time), by how much (the shortfall), the margin, what is left at the
 * destination, and where it runs out if it does. A grade that keeps its margin yields no rows.
 */
function optionFuelRows(
  fuel: TrackFuel,
  prefix: string,
  name: (text: string) => string,
  D: string,
): RouteFactRow[] {
  const rows: RouteFactRow[] = [];
  const end = breakpointIndex(fuel, "end");
  for (const g of FUEL_GRADES) {
    const check = fuel.grades[g];
    if (!check.belowMarginAt) continue;
    const p = `${prefix}.grades.${g}`;
    rows.push(
      {
        path: `${p}.belowMarginAt.nm`,
        label: name(`${g} drops below its safety margin, distance along the route`),
        value: check.belowMarginAt.nm,
        unit: "nm",
      },
      {
        path: `${p}.belowMarginAt.at`,
        label: name(`${g} drops below its safety margin at (UTC)`),
        value: check.belowMarginAt.at,
        unit: null,
      },
    );
    if (check.runsDryAt) {
      rows.push(
        {
          path: `${p}.runsDryAt.nm`,
          label: name(`${g} runs out, distance along the route`),
          value: check.runsDryAt.nm,
          unit: "nm",
        },
        {
          path: `${p}.runsDryAt.at`,
          label: name(`${g} runs out at (UTC)`),
          value: check.runsDryAt.at,
          unit: null,
        },
      );
    }
    rows.push(
      {
        path: `${p}.shortfallMt`,
        label: name(`${g} shortfall to keep the margin`),
        value: check.shortfallMt,
        unit: "mt",
      },
      {
        path: `${p}.marginMt`,
        label: name(`${g} safety margin`),
        value: check.marginMt,
        unit: "mt",
      },
    );
    const atEnd = fuel.breakpoints[end];
    if (atEnd) {
      rows.push({
        path: `${prefix}.breakpoints[${end}].robMt.${g}`,
        label: name(`${g} on board at ${D}`),
        value: atEnd.robMt[g],
        unit: "mt",
      });
    }
  }
  return rows;
}

/**
 * The recommended plan (route, or route with a bunker stop) and what it adds against the best
 * route ignoring fuel on board, the next feasible plan, then every stop plan: its route, stop
 * timeline, costs, and the bought grade on board at the stop and at the destination. A fleet
 * vessel only: an AIS ship has no fuel check, stop plans or recommended plan.
 */
function planRows(result: RouteSpeedResult, S: string, D: string): RouteFactRow[] {
  const rows: RouteFactRow[] = [];
  const rec = result.plan;
  if (rec) {
    rows.push(
      { path: "plan.optionId", label: `${S}: recommended plan`, value: rec.optionId, unit: null },
      {
        path: "plan.addedHours",
        label: `${S}: recommended plan adds (hours)`,
        value: rec.addedHours,
        unit: "h",
      },
      {
        path: "plan.addedUsd",
        label: `${S}: recommended plan adds (USD, excluding the fuel bought)`,
        value: rec.addedUsd,
        unit: "USD",
      },
    );
    if (rec.next) {
      rows.push(
        {
          path: "plan.next.optionId",
          label: `${S}: next feasible plan`,
          value: rec.next.optionId,
          unit: null,
        },
        {
          path: "plan.next.marginUsd",
          label: `${S}: margin of the recommended plan over the next feasible plan, in plan total`,
          value: rec.next.marginUsd,
          unit: "USD",
        },
      );
    }
  }
  result.stopPlans.forEach((sp, i) => {
    const P = `${S}, ${sp.optionId}`;
    const p = `stopPlans[${i}]`;
    rows.push({ path: `${p}.feasible`, label: `${P}: feasible`, value: sp.feasible, unit: null });
    sp.reasons.forEach((reason, k) => {
      rows.push({
        path: `${p}.reasons[${k}]`,
        label: `${P}: reason it is not feasible`,
        value: reason,
        unit: null,
      });
    });
    // No sea route through the port: nothing was evaluated, so nothing else is cited.
    const stop = sp.stop;
    if (!stop) return;
    for (const f of STOP_PLAN_FIELDS) {
      const [field, value] =
        "key" in f ? [f.key, sp[f.key]] : [`stop.${f.stopKey}`, stop[f.stopKey]];
      rows.push({ path: `${p}.${field}`, label: `${P}: ${f.text(D)}`, value, unit: f.unit });
    }
    if (stop.beyondForecast) {
      rows.push({
        path: `${p}.stop.beyondForecast`,
        label: `${P}: bunkering weather beyond the forecast (counted as workable)`,
        value: true,
        unit: null,
      });
    }
    const grade = sp.fuel ? boughtGrade(sp.fuel) : null;
    if (!sp.fuel || !grade) return;
    for (const point of STOP_FUEL_POINTS) {
      const k = breakpointIndex(sp.fuel, point.kind);
      const at = sp.fuel.breakpoints[k];
      if (!at) continue;
      rows.push({
        path: `${p}.fuel.breakpoints[${k}].robMt.${grade}`,
        label: `${P}: ${point.text(grade, D)}`,
        value: at.robMt[grade],
        unit: "mt",
      });
    }
    rows.push({
      path: `${p}.fuel.grades.${grade}.marginMt`,
      label: `${P}: ${grade} safety margin`,
      value: sp.fuel.grades[grade].marginMt,
      unit: "mt",
    });
  });
  return rows;
}

export function routeSpeedFactRows(
  plan: RouteFactPlan,
  result: RouteSpeedResult,
  snapshot: { id: Id; modelRun: Date } | null,
  extra: {
    mmsi?: string | null;
    calculationId?: Id;
    /** The AIS ship's position row the plan read: its reported draught, when it reports one. */
    ship?: Pick<AisTraffic, "draughtM"> | null;
  } = {},
): RouteFactRow[] {
  const S = subjectLabel(plan, extra.mmsi ?? null);
  const D = plan.destination.name;
  const rows: RouteFactRow[] = [];
  const labelOf = (id: string) => plan.input.candidates.find((c) => c.id === id)?.label ?? id;

  result.options.forEach((o, i) => {
    const X = o.candidateId;
    const p = (field: string) => `options[${i}].${field}`;
    rows.push({
      path: `inputs.optimiser.candidates.${plan.input.candidates.findIndex((c) => c.id === X)}.label`,
      label: routeOptionLabel(S, X, "description"),
      value: labelOf(X),
      unit: null,
    });
    for (const f of OPTION_FIELDS) {
      rows.push({
        path: p(f.key),
        label: routeOptionLabel(S, X, f.text(D)),
        value: o[f.key],
        unit: f.unit,
      });
    }
    if (plan.input.arriveBy !== null) {
      rows.push({
        path: p("meetsArriveBy"),
        label: `${S}, route ${X}: arrives within the berth window`,
        value: o.meetsArriveBy,
        unit: null,
      });
    }
    rows.push({
      path: p("crossesHazard"),
      label: `${S}, route ${X}: passes through a reported hazard`,
      value: o.crossesHazard,
      unit: null,
    });
    if (o.fuel) {
      rows.push(...optionFuelRows(o.fuel, p("fuel"), (t) => routeOptionLabel(S, X, t), D));
    }
  });

  const b = result.baseline;
  for (const f of OPTION_FIELDS) {
    if (
      ![
        "speedKn",
        "eta",
        "totalFuelMt",
        "co2T",
        "etsCostUsd",
        "fuelEuCostUsd",
        "totalCostUsd",
      ].includes(f.key)
    ) {
      continue;
    }
    // The plan's own speed, not a recommendation. A ship seen on AIS has no plan the operator
    // knows: its speed is assumed (from its reported speed over ground, see routePlanFacts).
    const label =
      f.key !== "speedKn"
        ? `${S}, current plan: ${f.text(D)}`
        : plan.profile === "own"
          ? `${S}, current plan: speed`
          : `${S}, assumed plan: speed`;
    rows.push({ path: `baseline.${f.key}`, label, value: b[f.key], unit: f.unit });
  }

  // A fleet vessel's best route ignores fuel on board (the recommended plan is cited below); a
  // ship seen on AIS has no fuel check, and its labels stay as they were.
  const ais = Boolean(extra.mmsi);
  rows.push(
    {
      path: "bestCandidateId",
      label: ais ? `${S}: recommended route` : `${S}: best route ignoring fuel on board`,
      value: result.bestCandidateId,
      unit: null,
    },
    {
      path: "savingVsBaselineUsd",
      label: ais
        ? `${S}: saving of the recommended route and speed against the current plan`
        : `${S}: saving of the best route and speed ignoring fuel, against the current plan`,
      value: result.savingVsBaselineUsd,
      unit: "USD",
    },
    {
      path: "fuelSavingVsBaselineMt",
      label: ais
        ? `${S}: fuel saved against the current plan`
        : `${S}: fuel saved by the best route and speed ignoring fuel, against the current plan`,
      value: result.fuelSavingVsBaselineMt,
      unit: "mt",
    },
  );
  if (plan.input.arriveBy !== null) {
    rows.push({
      path: "inputs.optimiser.arriveBy",
      label: `${S}: berth window closes at ${D} (UTC)`,
      value: plan.input.arriveBy,
      unit: null,
    });
  }
  const best = result.options.find((o) => o.candidateId === result.bestCandidateId);
  if (best) {
    rows.push({
      path: `options[${result.options.indexOf(best)}].weatherCoveragePct`,
      label: ais
        ? `${S}: share of the recommended route covered by the weather forecast`
        : `${S}: share of the best route ignoring fuel covered by the weather forecast`,
      value: best.weatherCoveragePct,
      unit: "%",
    });
  }
  rows.push(...planRows(result, S, D));
  // The load the plan's curve carries: displacement and its load factor (fleet vessel: the
  // voyage's cargo and ballast; AIS ship: from its draught, or assumed laden).
  const curve = plan.input.curve;
  if (curve?.load) {
    const stored = routeCalculationLoad({
      loadCondition: plan.loadCondition ?? null,
      input: { curve },
    });
    rows.push({
      path: DISPLACEMENT_PATH,
      label: LOAD_LABELS.displacement(S),
      value: curve.load.displacementMt,
      unit: "mt",
    });
    if (stored.loadFactor !== null) {
      rows.push({
        path: LOAD_FACTOR_PATH,
        label: LOAD_LABELS.loadFactor(S),
        value: stored.loadFactor,
        unit: null,
      });
    }
    if (stored.loadCondition !== null) {
      rows.push({
        path: LOAD_CONDITION_PATH,
        label: LOAD_LABELS.loadCondition(S),
        value: stored.loadCondition,
        unit: null,
      });
    }
  }
  if (extra.mmsi && extra.ship && extra.ship.draughtM !== null) {
    rows.push({
      path: AIS_DRAUGHT_PATH,
      label: LOAD_LABELS.aisDraught(S),
      value: extra.ship.draughtM,
      unit: "m",
    });
  }
  if (plan.profile !== "own") {
    rows.push({
      path: "inputs.profile",
      label: `${S}: assumed vessel profile`,
      value: plan.profile,
      unit: null,
    });
    if (extra.mmsi) {
      rows.push({ path: "inputs.mmsi", label: `${S}: MMSI`, value: extra.mmsi, unit: null });
    }
  }
  if (snapshot) {
    rows.push({
      path: WEATHER_RUN_PATH,
      label: "Weather forecast start (UTC)",
      value: snapshot.modelRun.toISOString(),
      unit: null,
    });
  }
  if (extra.calculationId !== undefined) {
    rows.push({
      path: CALCULATION_ID_PATH,
      label: "Route calculation id",
      value: extra.calculationId,
      unit: null,
    });
  }
  return rows;
}

/**
 * One row as the `Fact` `plan_route_speed` returns for calculation `calculationId`. `ais` is the
 * AIS position row the plan read (its MMSI and report time), for the AIS draught row.
 */
export function routeFactOfRow(
  calculationId: Id,
  row: RouteFactRow,
  snapshot: { id: Id; modelRun: Date } | null = null,
  ais: { mmsi: string; ts: Date } | null = null,
): Fact {
  const { path, label, value, unit } = row;
  if (path === AIS_DRAUGHT_PATH) {
    if (!ais) throw new Error("an AIS draught fact needs the AIS row it was read from");
    return {
      id: factId(ROUTE_TOOL, calculationId, path),
      label,
      value,
      unit,
      provenance: { source: "ais", mmsi: ais.mmsi, ts: ais.ts.toISOString() },
    };
  }
  if (path.startsWith("inputs.")) {
    return dbFact(
      ROUTE_TOOL,
      { table: "calculations", rowId: calculationId, field: path },
      label,
      value,
      unit,
    );
  }
  if (path === WEATHER_RUN_PATH && snapshot) {
    return {
      id: factId(ROUTE_TOOL, calculationId, path),
      label,
      value,
      unit,
      provenance: {
        source: "weather",
        snapshotId: snapshot.id,
        modelRun: snapshot.modelRun.toISOString(),
      },
    };
  }
  if (path === CALCULATION_ID_PATH) {
    return dbFact(
      ROUTE_TOOL,
      { table: "calculations", rowId: calculationId, field: "id" },
      label,
      value,
      unit,
    );
  }
  return calcFact(
    ROUTE_TOOL,
    { id: calculationId, calculator: CALCULATOR },
    path,
    label,
    value,
    unit,
  );
}

/**
 * What `routePlanFacts` reads: a live `PlannedRoute`, or a stored plan rebuilt from its calculation
 * (the read view, `GET /api/route-plans/:id`). The hazards are only looked up by id for their label.
 */
export type RoutePlanFactsInput = Pick<PlannedRoute, "snapshot" | "mmsi" | "sogKn" | "ship"> & {
  response: Pick<PlannedRoute["response"], "calculationId" | "result">;
  plan: RouteFactPlan &
    Pick<RoutePlan, "avoidedHazardIds"> & { input: Pick<RouteSpeedInput, "hazards"> };
  hazards: Pick<NavHazard, "id" | "label">[];
};

/** Facts for the reported hazards the plan touches or goes round (labels are untrusted text). */
function hazardFacts(planned: RoutePlanFactsInput, S: string): Fact[] {
  const { plan, response, hazards } = planned;
  const calculationId = response.calculationId;
  const best = response.result.options.find(
    (o) => o.candidateId === response.result.bestCandidateId,
  );
  const avoided = [...plan.avoidedHazardIds].sort();
  const ids = new Set([
    ...(best?.hazardIds ?? []),
    ...response.result.baseline.hazardIds,
    ...avoided,
  ]);
  const facts: Fact[] = [];
  for (const id of [...ids].sort()) {
    const row = hazards.find((h) => h.id === id);
    if (!row) continue;
    facts.push(
      dbFact(
        ROUTE_TOOL,
        { table: "nav_hazards", rowId: id, field: "label" },
        `Reported hazard ${id}`,
        row.label,
        null,
      ),
    );
    // The radius is the stored zone the optimiser used, not the (possibly unset) hazard column.
    const zone = plan.input.hazards.findIndex((z) => z.id === id);
    const stored = plan.input.hazards[zone];
    if (stored) {
      facts.push(
        dbFact(
          ROUTE_TOOL,
          {
            table: "calculations",
            rowId: calculationId,
            field: `inputs.optimiser.hazards.${zone}.radiusNm`,
          },
          `Reported hazard ${id}: keep-out radius`,
          stored.radiusNm,
          "nm",
        ),
      );
    }
  }
  for (const id of avoided) {
    facts.push(
      dbFact(
        ROUTE_TOOL,
        { table: "nav_hazards", rowId: id, field: "id" },
        `${S}: reported hazard avoided by the recommended route`,
        id,
        null,
      ),
    );
  }
  return facts;
}

/**
 * Every fact of a stored route plan, as `plan_route_speed` returns them and `POST /api/route-plan`
 * serves them: the plan's rows, the AIS ship name (untrusted text, a value only) and its reported
 * speed over ground, and the hazards.
 */
export function routePlanFacts(planned: RoutePlanFactsInput): Fact[] {
  const { response, plan, snapshot, mmsi, sogKn, ship } = planned;
  const calculationId = response.calculationId;
  const S = subjectLabel(plan, mmsi);
  const rows = routeSpeedFactRows(plan, response.result, snapshot, { mmsi, calculationId, ship });
  const ais = mmsi && ship ? { mmsi, ts: ship.updatedAt } : null;
  const facts: Fact[] = rows.map((r) => routeFactOfRow(calculationId, r, snapshot, ais));
  if (mmsi && plan.subject !== S) {
    facts.push(
      dbFact(
        ROUTE_TOOL,
        { table: "ais_traffic", rowId: mmsi, field: "name" },
        `${S}: AIS ship name`,
        plan.subject,
        null,
      ),
    );
  }
  if (mmsi && sogKn !== null) {
    facts.push(
      dbFact(
        ROUTE_TOOL,
        { table: "ais_traffic", rowId: mmsi, field: "sogKn" },
        `${S}: reported speed over ground`,
        sogKn,
        "kn",
      ),
    );
  }
  facts.push(...hazardFacts(planned, S));
  return facts;
}
