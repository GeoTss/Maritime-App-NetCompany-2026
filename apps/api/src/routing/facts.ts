/**
 * The facts a route plan yields, as pure rows: a JSON path, a label, a value and a unit.
 * `routeFactOfRow` turns a row into the `Fact` the route tool returns (calculation provenance for a
 * path into the stored calculation; `weather.modelRun` (the forecast's start, stored as the
 * snapshot's model_run) carries weather provenance; `calculation.id`
 * is the calculation's own row); the approval view re-derives the same facts with it, so the ids
 * the agent cited resolve there. A path starting `inputs.` is a field of the stored calculation's
 * inputs (cited as `db` on the calculation row); every other path points into its outputs (the
 * `RouteSpeedResult`) and resolves to exactly the row's value. The Q&A reference reuses these rows.
 */
import type { RoutePlan } from "@pharos/db";
import type { Fact, Id, RouteSpeedResult } from "@pharos/shared";
import { calcFact, dbFact, factId } from "../ai/tools/common.js";
import type { PlannedRoute } from "./plan.js";

/** The tool name in every route fact id. */
export const ROUTE_TOOL = "plan_route_speed";
const CALCULATOR = "route_speed";

/** What the fact rows read of a plan: rebuilt from a stored calculation's inputs by the view. */
export type RouteFactPlan = Pick<RoutePlan, "subject" | "profile"> & {
  destination: Pick<RoutePlan["destination"], "name">;
  input: Pick<RoutePlan["input"], "candidates" | "arriveBy">;
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

const OPTION_FIELDS: {
  key:
    | "distanceNm"
    | "speedKn"
    | "eta"
    | "totalFuelMt"
    | "co2T"
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
  {
    key: "totalCostUsd",
    text: () => "total voyage cost (fuel, EU ETS, vessel time)",
    unit: "USD",
  },
  { key: "weatherDelayHours", text: () => "weather delay", unit: "h" },
];

export function routeSpeedFactRows(
  plan: RouteFactPlan,
  result: RouteSpeedResult,
  snapshot: { id: Id; modelRun: Date } | null,
  extra: { mmsi?: string | null; calculationId?: Id } = {},
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
      label: `${S}, route ${X}: description`,
      value: labelOf(X),
      unit: null,
    });
    for (const f of OPTION_FIELDS) {
      rows.push({
        path: p(f.key),
        label: `${S}, route ${X}: ${f.text(D)}`,
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
  });

  const b = result.baseline;
  for (const f of OPTION_FIELDS) {
    if (!["speedKn", "eta", "totalFuelMt", "co2T", "totalCostUsd"].includes(f.key)) continue;
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

  rows.push(
    {
      path: "bestCandidateId",
      label: `${S}: recommended route`,
      value: result.bestCandidateId,
      unit: null,
    },
    {
      path: "savingVsBaselineUsd",
      label: `${S}: saving of the recommended route and speed against the current plan`,
      value: result.savingVsBaselineUsd,
      unit: "USD",
    },
    {
      path: "fuelSavingVsBaselineMt",
      label: `${S}: fuel saved against the current plan`,
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
      label: `${S}: share of the recommended route covered by the weather forecast`,
      value: best.weatherCoveragePct,
      unit: "%",
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

/** One row as the `Fact` `plan_route_speed` returns for calculation `calculationId`. */
export function routeFactOfRow(
  calculationId: Id,
  row: RouteFactRow,
  snapshot: { id: Id; modelRun: Date } | null = null,
): Fact {
  const { path, label, value, unit } = row;
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

/** Facts for the reported hazards the plan touches or goes round (labels are untrusted text). */
function hazardFacts(planned: PlannedRoute, S: string): Fact[] {
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
export function routePlanFacts(planned: PlannedRoute): Fact[] {
  const { response, plan, snapshot, mmsi, sogKn } = planned;
  const calculationId = response.calculationId;
  const S = subjectLabel(plan, mmsi);
  const rows = routeSpeedFactRows(plan, response.result, snapshot, { mmsi, calculationId });
  const facts: Fact[] = rows.map((r) => routeFactOfRow(calculationId, r, snapshot));
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
        { table: "ais_traffic", rowId: mmsi, field: "sog_kn" },
        `${S}: reported speed over ground`,
        sogKn,
        "kn",
      ),
    );
  }
  facts.push(...hazardFacts(planned, S));
  return facts;
}
