/**
 * The facts a route plan yields, as pure rows: a JSON path, a label, a value and a unit. The tool
 * turns the rows into `Fact`s (calculation provenance for a path into the stored calculation;
 * `weather.modelRun` carries weather provenance; `calculation.id` is the calculation's own row).
 * Paths starting `inputs.` point into the stored calculation's inputs; every other path points
 * into its outputs (the `RouteSpeedResult`). The Q&A reference reuses these rows.
 */
import type { RoutePlan } from "@pharos/db";
import type { Id, RouteSpeedResult } from "@pharos/shared";

export interface RouteFactRow {
  path: string;
  label: string;
  value: number | string | boolean;
  unit: string | null;
}

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
  plan: RoutePlan,
  result: RouteSpeedResult,
  snapshot: { id: Id; modelRun: Date } | null,
  extra: { mmsi?: string | null; calculationId?: Id } = {},
): RouteFactRow[] {
  const S = plan.subject;
  const D = plan.destination.name;
  const rows: RouteFactRow[] = [];
  const labelOf = (id: string) => plan.input.candidates.find((c) => c.id === id)?.label ?? id;

  result.options.forEach((o, i) => {
    const X = o.candidateId;
    const p = (field: string) => `options[${i}].${field}`;
    rows.push({
      path: p("label"),
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
        path: p("feasible"),
        label: `${S}, route ${X}: arrives within the berth window`,
        value: !o.reasons.includes("misses_arrive_by"),
        unit: null,
      });
    }
    rows.push({
      path: p("hazardIds"),
      label: `${S}, route ${X}: passes through a reported hazard`,
      value: o.hazardIds.length > 0,
      unit: null,
    });
  });

  const b = result.baseline;
  for (const f of OPTION_FIELDS) {
    if (!["speedKn", "eta", "totalFuelMt", "co2T", "totalCostUsd"].includes(f.key)) continue;
    rows.push({
      path: `baseline.${f.key}`,
      label: `${S}, current plan: ${f.text(D)}`,
      value: b[f.key],
      unit: f.unit,
    });
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
      label: "Weather forecast model run (UTC)",
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
