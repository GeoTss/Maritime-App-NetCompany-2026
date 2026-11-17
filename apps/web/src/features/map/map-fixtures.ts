/**
 * Typed sample API payloads for the map's tests (shapes from `@pharos/shared`; values invented).
 * Not imported by the app.
 */
import type {
  AisTrafficList,
  BunkerOptionView,
  BunkerPlanView,
  Fact,
  HazardZoneList,
  PortCongestionList,
  PortList,
  RouteOptionResult,
  RoutePlanResponse,
  RoutePlanView,
  StopPlanResult,
  TrackFuel,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  WeatherView,
} from "@pharos/shared";

export const VESSELS: VesselSummary[] = [
  {
    id: 1,
    name: "MV Aegean Pioneer",
    imo: "9480019",
    mmsi: "999000001",
    shipType: "bulk_carrier",
    position: { lat: 33.1386, lon: 27.0159 },
    positionAt: "2026-11-14T08:00:00.000Z",
    voyageId: 1,
    robMt: { LSMGO: 275, VLSFO: 620, HSFO: 0 },
    alerts: ["lsmgo_runs_out"],
  },
  {
    id: 2,
    name: "MV Thessaly Star",
    imo: "9481025",
    mmsi: "999000002",
    shipType: "bulk_carrier",
    position: { lat: 38.5562, lon: 15.5988 },
    positionAt: "2026-11-14T08:00:00.000Z",
    voyageId: 2,
    robMt: { LSMGO: 310, VLSFO: 540, HSFO: 0 },
    alerts: [],
  },
];

export const VESSEL_DETAIL: VesselDetail = {
  ...(VESSELS[0] as VesselSummary),
  facts: { robMt: null, voyageNo: null, nextPort: null, nextPortEta: null },
  dwt: 58000,
  tankCapacityMt: { LSMGO: 600, VLSFO: 1500, HSFO: 0 },
  consumptionCurve: {
    refSpeedKn: 13,
    refMtPerDay: 30,
    auxMtPerDay: 2.5,
    minSpeedKn: 9,
    maxSpeedKn: 14.5,
  },
  // The current plan's fuel (the one calculation the alert reads): LSMGO is burned in the
  // emission control areas, falls below its margin at 1,562 nm and runs out at 3,111 nm.
  fuelTrack: {
    breakpoints: [
      {
        kind: "start",
        nm: 0,
        at: "2026-11-14T08:00:00.000Z",
        position: { lat: 33.1386, lon: 27.0159 },
        robMt: { LSMGO: 275, VLSFO: 620, HSFO: 0 },
      },
      {
        kind: "grade_change",
        nm: 1761.4,
        at: "2026-11-20T12:56:03.074Z",
        position: { lat: 35.8809, lon: -5.4103 },
        robMt: { LSMGO: 28.4, VLSFO: 620, HSFO: 0 },
      },
      {
        kind: "grade_change",
        nm: 2807.9,
        at: "2026-11-24T03:40:27.003Z",
        position: { lat: 48.5096, lon: -4.9077 },
        robMt: { LSMGO: 28.4, VLSFO: 518.3, HSFO: 0 },
      },
      {
        kind: "end",
        nm: 3274.3,
        at: "2026-11-25T17:00:27.093Z",
        position: { lat: 51.92, lon: 4.5 },
        robMt: { LSMGO: -15.3, VLSFO: 518.3, HSFO: 0 },
      },
    ],
    grades: {
      LSMGO: {
        neededMt: 290.3,
        marginMt: 56.26,
        minRobMt: -15.3,
        shortfallMt: 71.57,
        belowMarginAt: {
          nm: 1562.4,
          at: "2026-11-19T13:13:54.619Z",
          position: { lat: 36.4755, lon: -0.422 },
          robMt: 56.26,
        },
        runsDryAt: {
          nm: 3111.2,
          at: "2026-11-25T04:29:36.323Z",
          position: { lat: 51.1414, lon: 1.8476 },
        },
      },
      VLSFO: {
        neededMt: 101.7,
        marginMt: 56.26,
        minRobMt: 518.3,
        shortfallMt: 0,
        belowMarginAt: null,
        runsDryAt: null,
      },
      HSFO: {
        neededMt: 0,
        marginMt: 0,
        minRobMt: 0,
        shortfallMt: 0,
        belowMarginAt: null,
        runsDryAt: null,
      },
    },
    keepsMargins: false,
    probes: [],
  },
};

export const VOYAGE: VoyageDetail = {
  id: 1,
  voyageNo: "AP-2611",
  vesselId: 1,
  vesselName: "MV Aegean Pioneer",
  status: "underway",
  originPortId: 1,
  destinationPortId: 2,
  plannedSpeedKn: 12.5,
  nextEta: "2026-11-16T15:45:07.200Z",
  portCalls: [],
  plannedTrack: [
    { lat: 31.26, lon: 32.3 },
    { lat: 33.1, lon: 27 },
    { lat: 37.93, lon: 23.62 },
  ],
  legs: [],
};

export const TRAFFIC: AisTrafficList = {
  items: [
    {
      mmsi: "211121690",
      name: "FRANKA DEYMANN",
      shipType: "cargo",
      lat: 37.2,
      lon: 20.1,
      sogKn: 11.4,
      navStatus: "under way using engine",
      destination: "PIRAEUS <b>x</b>",
      draughtM: 8.2,
      cogDeg: 82,
      updatedAt: "2026-11-14T07:59:59.666Z",
    },
    {
      mmsi: "244700533",
      name: null,
      shipType: null,
      lat: 36.1,
      lon: 18.4,
      sogKn: 0,
      navStatus: "at anchor",
      destination: null,
      draughtM: null,
      cogDeg: null,
      updatedAt: "2026-11-14T07:59:59.588Z",
    },
  ],
};

export const HAZARDS: HazardZoneList = {
  items: [
    {
      id: "synthetic:1",
      kind: "synthetic",
      source: "synthetic",
      mmsi: null,
      lat: 37.5681,
      lon: 7.0841,
      label: "SYNTHETIC TEST HAZARD — drifting container reported (demo data)",
      radiusNm: 25,
      observedAt: "2026-11-14T08:00:00.000Z",
      zoneRadiusNm: 25,
    },
  ],
};

export const CONGESTION: PortCongestionList = {
  items: [
    {
      portId: 2,
      portName: "Piraeus",
      unlocode: "GRPIR",
      anchoredCount: 28,
      waitingHours: 42,
      observedAt: "2026-11-14T08:05:00.000Z",
      source: "ais",
    },
    {
      portId: 1,
      portName: "Port Said",
      unlocode: "EGPSD",
      anchoredCount: 24,
      waitingHours: 18,
      observedAt: "2026-11-14T07:00:00.000Z",
      source: "seed",
    },
  ],
};

export const PORTS: PortList = {
  items: [
    {
      id: 1,
      name: "Port Said",
      unlocode: "EGPSD",
      position: { lat: 31.2653, lon: 32.3019 },
      isEu: false,
    },
    { id: 2, name: "Piraeus", unlocode: "GRPIR", position: { lat: 37.93, lon: 23.62 }, isEu: true },
    {
      id: 11,
      name: "Rotterdam",
      unlocode: "NLRTM",
      position: { lat: 51.95, lon: 4.14 },
      isEu: true,
    },
  ],
};

export const WEATHER: WeatherView = {
  snapshotId: 1,
  source: "open-meteo-recorded",
  forecastStart: "2026-11-14T08:00:00.000Z",
  fetchedAt: "2026-11-14T08:05:00.000Z",
  startAt: "2026-11-14T08:00:00.000Z",
  stepHours: 3,
  steps: 80,
  step: 0,
  validAt: "2026-11-14T08:00:00.000Z",
  stepTimes: Array.from({ length: 80 }, (_, k) =>
    new Date(Date.parse("2026-11-14T08:00:00.000Z") + k * 3 * 3_600_000).toISOString(),
  ),
  points: [
    { lat: 34, lon: 20, waveHeightM: 1.8, waveDirDeg: 338, windSpeedKn: 15.5, windDirDeg: 20 },
    { lat: 36, lon: 20, waveHeightM: null, waveDirDeg: null, windSpeedKn: null, windDirDeg: null },
  ],
};

type Metric =
  | "distanceNm"
  | "speedKn"
  | "eta"
  | "totalFuelMt"
  | "co2T"
  | "etsCostUsd"
  | "fuelEuCostUsd"
  | "totalCostUsd";

const UNITS: Record<Metric, string | null> = {
  distanceNm: "nm",
  speedKn: "kn",
  eta: null,
  totalFuelMt: "mt",
  co2T: "t CO₂",
  etsCostUsd: "USD",
  fuelEuCostUsd: "USD",
  totalCostUsd: "USD",
};

const option = (candidateId: string, over: Partial<RouteOptionResult>): RouteOptionResult => ({
  candidateId,
  speedKn: 11,
  distanceNm: 3128.8,
  hours: 295,
  calmHours: 284,
  weatherDelayHours: 10.6,
  eta: "2026-11-26T15:01:46.466Z",
  fuelMt: { LSMGO: 171, VLSFO: 74, HSFO: 0 },
  totalFuelMt: 245.4,
  co2T: 780,
  fuelCostUsd: 170683,
  etsCostUsd: 31591,
  fuelEuCostUsd: 6141,
  timeCostUsd: 196686,
  totalCostUsd: 405103,
  maxWaveHeightM: 3.4,
  weatherCoveragePct: 80.7,
  feasible: true,
  meetsArriveBy: true,
  crossesHazard: false,
  hazardIds: [],
  reasons: [],
  fuel: null,
  ...over,
});

/** A plan for MV Aegean Pioneer: A planned (crosses the hazard, infeasible), B recommended, C alternative. */
export function makePlan(opts: { omitFact?: (fact: Fact) => boolean } = {}): RoutePlanResponse {
  const options = [
    option("A", {
      distanceNm: 3274.3,
      totalCostUsd: 423699,
      feasible: false,
      crossesHazard: true,
      hazardIds: ["synthetic:1"],
      reasons: ["crosses_hazard"],
    }),
    option("B", {}),
    option("C", { distanceNm: 3334.3, speedKn: 11.5, totalCostUsd: 439075 }),
  ];
  const facts: Fact[] = [];
  options.forEach((o, i) => {
    for (const metric of Object.keys(UNITS) as Metric[]) {
      facts.push({
        id: `f_plan_options.${i}.${metric}`,
        label: `MV Aegean Pioneer, route ${o.candidateId}: ${metric}`,
        value: o[metric],
        unit: UNITS[metric],
        provenance: {
          source: "calculation",
          calculationId: 1,
          calculator: "optimiseRouteAndSpeed",
          path: `options[${i}].${metric}`,
        },
      });
    }
  });
  facts.push({
    id: "f_plan_savingVsBaselineUsd",
    label: "MV Aegean Pioneer: saving against the current plan",
    value: 48024.5,
    unit: "USD",
    provenance: {
      source: "calculation",
      calculationId: 1,
      calculator: "optimiseRouteAndSpeed",
      path: "savingVsBaselineUsd",
    },
  });
  facts.push({
    id: "f_plan_baseline_speedKn",
    label: "MV Aegean Pioneer, current plan: speed",
    value: 12.5,
    unit: "kn",
    provenance: {
      source: "calculation",
      calculationId: 1,
      calculator: "optimiseRouteAndSpeed",
      path: "baseline.speedKn",
    },
  });
  facts.push({
    id: "f_plan_displacement",
    label: "MV Aegean Pioneer: displacement",
    value: 65000,
    unit: "mt",
    provenance: {
      source: "db",
      table: "calculations",
      rowId: 1,
      field: "inputs.optimiser.curve.load.displacementMt",
    },
  });
  facts.push({
    id: "f_plan_loadFactor",
    label: "MV Aegean Pioneer: load factor",
    value: 0.96,
    unit: null,
    provenance: { source: "db", table: "calculations", rowId: 1, field: "inputs.loadFactor" },
  });
  facts.push({
    id: "f_plan_loadCondition",
    label: "MV Aegean Pioneer: load condition",
    value: "partial",
    unit: null,
    provenance: { source: "db", table: "calculations", rowId: 1, field: "inputs.loadCondition" },
  });
  facts.push({
    id: "f_plan_aisDraught",
    label: "MMSI 211121690: AIS draught",
    value: 8.2,
    unit: "m",
    provenance: { source: "ais", mmsi: "211121690", ts: "2026-11-14T07:59:59.666Z" },
  });
  const kept = opts.omitFact ? facts.filter((f) => !opts.omitFact?.(f)) : facts;
  return {
    calculationId: 1,
    weatherSnapshotId: 1,
    subject: "MV Aegean Pioneer",
    destination: "Rotterdam",
    candidates: [
      {
        id: "A",
        label: "Planned route",
        points: [
          { lat: 33, lon: 27 },
          { lat: 37, lon: 10 },
          { lat: 51.9, lon: 4.1 },
        ],
      },
      {
        id: "B",
        label: "Shortest sea route",
        points: [
          { lat: 33, lon: 27 },
          { lat: 36, lon: 12 },
          { lat: 51.9, lon: 4.1 },
        ],
      },
      {
        id: "C",
        label: "Alternative sea route",
        points: [
          { lat: 33, lon: 27 },
          { lat: 35, lon: 14 },
          { lat: 51.9, lon: 4.1 },
        ],
      },
    ],
    result: {
      options,
      baseline: options[0] as RouteOptionResult,
      bestCandidateId: "B",
      savingVsBaselineUsd: 48024.5,
      fuelSavingVsBaselineMt: 74.5,
      stopPlans: [],
      plan: null,
    },
    facts: kept,
    computeMs: 80,
  };
}

/** A stored route plan as `GET /api/route-plans/:id` serves it: the plan above, compute time unknown. */
export function makeStoredRoutePlan(calculationId: number): RoutePlanView {
  return { ...makePlan(), calculationId, computeMs: null };
}

/** A route-plan fact at an output path, with the id `plan_route_speed` would give it. */
const routeCalcFact = (
  path: string,
  label: string,
  value: number | string | boolean,
  unit: string | null,
): Fact => ({
  id: `f_plan_${path.replace(/\[(\d+)\]/g, ".$1")}`,
  label: `MV Aegean Pioneer: ${label}`,
  value,
  unit,
  provenance: { source: "calculation", calculationId: 1, calculator: "route_speed", path },
});

type Rob = { LSMGO: number; VLSFO: number; HSFO: number };
const bp = (
  kind: TrackFuel["breakpoints"][number]["kind"],
  nm: number,
  at: string,
  rob: Rob,
): TrackFuel["breakpoints"][number] => ({
  kind,
  nm,
  at,
  position: { lat: 33 + nm / 1000, lon: 27 - nm / 200 },
  robMt: rob,
});

const noCheck = {
  neededMt: 0,
  marginMt: 0,
  minRobMt: 0,
  shortfallMt: 0,
  belowMarginAt: null,
  runsDryAt: null,
};

/** Route B or C ignoring fuel on board: LSMGO falls below its 30 mt margin and runs dry. */
const shortFuel = (endNm: number): TrackFuel => ({
  breakpoints: [
    bp("start", 0, "2026-11-14T08:00:00.000Z", { LSMGO: 140, VLSFO: 620, HSFO: 0 }),
    bp("grade_change", 150, "2026-11-14T21:30:00.000Z", { LSMGO: 140, VLSFO: 610, HSFO: 0 }),
    bp("end", endNm, "2026-11-26T15:01:46.466Z", { LSMGO: -38.5, VLSFO: 610, HSFO: 0 }),
  ],
  grades: {
    LSMGO: {
      neededMt: 178.5,
      marginMt: 30,
      minRobMt: -38.5,
      shortfallMt: 68.5,
      belowMarginAt: {
        nm: 2511,
        at: "2026-11-23T10:00:00.000Z",
        position: { lat: 46.2, lon: -8.1 },
        robMt: 30,
      },
      runsDryAt: { nm: 2890, at: "2026-11-24T22:00:00.000Z", position: { lat: 48.9, lon: -5.6 } },
    },
    VLSFO: { ...noCheck, neededMt: 10, marginMt: 28, minRobMt: 610 },
    HSFO: noCheck,
  },
  keepsMargins: false,
  probes: [],
});

/** A stop at Marsaxlokk (or another port): LSMGO jumps by the 300 mt bought. */
const stopFuel = (stopNm: number, endNm: number): TrackFuel => ({
  breakpoints: [
    bp("start", 0, "2026-11-14T08:00:00.000Z", { LSMGO: 140, VLSFO: 620, HSFO: 0 }),
    bp("grade_change", 150, "2026-11-14T21:30:00.000Z", { LSMGO: 140, VLSFO: 610, HSFO: 0 }),
    bp("stop_arrival", stopNm, "2026-11-17T20:00:00.000Z", { LSMGO: 82, VLSFO: 610, HSFO: 0 }),
    bp("stop_departure", stopNm, "2026-11-18T08:30:00.000Z", { LSMGO: 381, VLSFO: 610, HSFO: 0 }),
    bp("end", endNm, "2026-11-26T09:30:00.000Z", { LSMGO: 172.4, VLSFO: 610, HSFO: 0 }),
  ],
  grades: {
    LSMGO: { ...noCheck, neededMt: 267.6, marginMt: 31, minRobMt: 82 },
    VLSFO: { ...noCheck, neededMt: 10, marginMt: 28, minRobMt: 610 },
    HSFO: noCheck,
  },
  keepsMargins: true,
  probes: [],
});

const stopPlan = (
  optionId: string,
  quoteId: number,
  unlocode: string,
  over: Partial<StopPlanResult> = {},
): StopPlanResult => ({
  optionId,
  quoteId,
  unlocode,
  speedKn: 11.5,
  distanceNm: 3210,
  steamingHours: 278,
  hours: 290.5,
  seaWeatherDelayHours: 8.2,
  eta: "2026-11-26T09:30:00.000Z",
  stop: {
    arriveAt: "2026-11-17T20:00:00.000Z",
    waitingHours: 4,
    weatherDelayHours: 2.5,
    bunkeringHours: 6,
    departAt: "2026-11-18T08:30:00.000Z",
    beyondForecast: false,
  },
  fuel: stopFuel(1020, 3210),
  fuelMt: { LSMGO: 267.6, VLSFO: 10, HSFO: 0 },
  co2T: 890,
  fuelCostUsd: 190000,
  timeCostUsd: 200000,
  etsCostUsd: 26000,
  fuelEuCostUsd: 5400,
  voyageCostUsd: 421400,
  bunkerFuelCostUsd: 221400,
  bargeFeeUsd: 3000,
  totalCostUsd: 645800,
  qtyMt: 300,
  hazardIds: [],
  feasible: true,
  reasons: [],
  ...over,
});

/** Quote ids of the stop plans, for `GET /api/quotes` names. */
export const STOP_NAMES = new Map([
  [11, { supplier: "Kestrel Marine Fuels", port: "Marsaxlokk" }],
  [12, { supplier: "Nordwind Bunker Services", port: "Algeciras" }],
  [13, { supplier: "Strait Line Fuels", port: "Gibraltar" }],
]);

/**
 * Aegean Pioneer with its fuel on board: the best route ignoring fuel (B) runs short of LSMGO, and
 * the recommended plan calls at Marsaxlokk for Kestrel's quote; Nordwind at Algeciras is the next
 * feasible quote. `infeasible`: every quote's stop plan fails, so there is no recommended plan.
 */
export function makeFuelPlan(
  opts: { infeasible?: boolean; beyondForecast?: boolean; omitFact?: (fact: Fact) => boolean } = {},
): RoutePlanView {
  const base = makePlan();
  const [a, b, c] = base.result.options as [
    RouteOptionResult,
    RouteOptionResult,
    RouteOptionResult,
  ];
  const short = { feasible: false, reasons: ["insufficient_fuel" as const] };
  const options = [
    a,
    { ...b, ...short, fuel: shortFuel(3128.8) },
    { ...c, ...short, fuel: shortFuel(3334.3) },
  ];
  const kestrel = stopPlan("MTMLA-kestrel", 11, "MTMLA", {
    stop: {
      arriveAt: "2026-11-17T20:00:00.000Z",
      waitingHours: 4,
      weatherDelayHours: 2.5,
      bunkeringHours: 6,
      departAt: "2026-11-18T08:30:00.000Z",
      beyondForecast: opts.beyondForecast ?? false,
    },
  });
  const nordwind = stopPlan("ESALG-nordwind", 12, "ESALG", {
    distanceNm: 3260,
    totalCostUsd: 652100,
    fuel: stopFuel(1890, 3260),
  });
  const straitline = stopPlan("GIGIB-straitline", 13, "GIGIB", {
    totalCostUsd: 661000,
    feasible: false,
    reasons: ["outside_delivery_window"],
  });
  const stopPlans = opts.infeasible
    ? [
        { ...kestrel, feasible: false, reasons: ["misses_arrive_by" as const] },
        {
          ...nordwind,
          feasible: false,
          reasons: ["insufficient_fuel" as const, "outside_delivery_window" as const],
        },
        { ...straitline, feasible: false, reasons: ["no_sea_route" as const] },
      ]
    : [kestrel, nordwind, straitline];

  const facts: Fact[] = [...base.facts];
  for (const i of [1, 2]) {
    const X = i === 1 ? "B" : "C";
    const g = `options[${i}].fuel.grades.LSMGO`;
    facts.push(
      routeCalcFact(`${g}.belowMarginAt.nm`, `route ${X}, LSMGO below its margin from`, 2511, "nm"),
      routeCalcFact(
        `${g}.belowMarginAt.at`,
        `route ${X}, LSMGO below its margin at (UTC)`,
        "2026-11-23T10:00:00.000Z",
        null,
      ),
      routeCalcFact(`${g}.runsDryAt.nm`, `route ${X}, LSMGO runs dry at`, 2890, "nm"),
      routeCalcFact(`${g}.marginMt`, `route ${X}, LSMGO safety margin`, 30, "mt"),
      routeCalcFact(
        `options[${i}].fuel.breakpoints[2].robMt.LSMGO`,
        `route ${X}, LSMGO on board at Rotterdam`,
        -38.5,
        "mt",
      ),
    );
  }
  stopPlans.forEach((s, i) => {
    const P = `${s.optionId}`;
    const p = (field: string) => `stopPlans[${i}].${field}`;
    const units: [string, number | string, string | null][] = [
      ["eta", s.eta, null],
      ["hours", s.hours, "h"],
      ["totalCostUsd", s.totalCostUsd, "USD"],
      ["voyageCostUsd", s.voyageCostUsd, "USD"],
      ["bunkerFuelCostUsd", s.bunkerFuelCostUsd, "USD"],
      ["bargeFeeUsd", s.bargeFeeUsd, "USD"],
      ["speedKn", s.speedKn, "kn"],
      ["qtyMt", s.qtyMt, "mt"],
    ];
    for (const [field, value, unit] of units)
      facts.push(routeCalcFact(p(field), `${P}: ${field}`, value, unit));
    if (s.stop) {
      const st = s.stop;
      facts.push(
        routeCalcFact(p("stop.arriveAt"), `${P}: arrives at the stop (UTC)`, st.arriveAt, null),
        routeCalcFact(p("stop.waitingHours"), `${P}: waiting`, st.waitingHours, "h"),
        routeCalcFact(
          p("stop.weatherDelayHours"),
          `${P}: weather delay`,
          st.weatherDelayHours,
          "h",
        ),
        routeCalcFact(p("stop.bunkeringHours"), `${P}: bunkering`, st.bunkeringHours, "h"),
        routeCalcFact(p("stop.departAt"), `${P}: departs the stop (UTC)`, st.departAt, null),
      );
    }
    if (s.fuel) {
      s.fuel.breakpoints.forEach((b, k) => {
        if (b.kind === "stop_arrival" || b.kind === "stop_departure" || b.kind === "end") {
          facts.push(
            routeCalcFact(
              p(`fuel.breakpoints[${k}].robMt.LSMGO`),
              `${P}: LSMGO on board, ${b.kind}`,
              b.robMt.LSMGO,
              "mt",
            ),
          );
        }
      });
      facts.push(
        routeCalcFact(p("fuel.grades.LSMGO.marginMt"), `${P}: LSMGO safety margin`, 31, "mt"),
      );
    }
  });
  facts.push({
    id: "f_plan_arriveBy",
    label: "MV Aegean Pioneer: berth window closes at Rotterdam (UTC)",
    value: "2026-11-27T00:00:00.000Z",
    unit: null,
    provenance: {
      source: "db",
      table: "calculations",
      rowId: 1,
      field: "inputs.optimiser.arriveBy",
    },
  });
  const plan = opts.infeasible
    ? null
    : {
        kind: "stop" as const,
        optionId: "MTMLA-kestrel",
        addedHours: 21.3,
        addedUsd: 19850.4,
        next: { optionId: "ESALG-nordwind", totalCostUsd: 652100, marginUsd: 6300 },
      };
  if (plan) {
    facts.push(
      routeCalcFact("plan.optionId", "recommended plan", plan.optionId, null),
      routeCalcFact("plan.addedHours", "recommended plan adds (hours)", plan.addedHours, "h"),
      routeCalcFact(
        "plan.addedUsd",
        "recommended plan adds (USD, excluding the fuel bought)",
        plan.addedUsd,
        "USD",
      ),
      routeCalcFact("plan.next.optionId", "next feasible plan", plan.next.optionId, null),
      routeCalcFact(
        "plan.next.marginUsd",
        "margin over the next feasible plan",
        plan.next.marginUsd,
        "USD",
      ),
    );
  }
  const kept = opts.omitFact ? facts.filter((f) => !opts.omitFact?.(f)) : facts;
  return {
    ...base,
    computeMs: null,
    result: { ...base.result, options, baseline: a, stopPlans, plan },
    facts: kept,
  };
}

const bunkerFact = (
  index: number,
  option: { optionId: string; supplier: string; port: { name: string } },
  field: string,
  name: string,
  value: number,
  unit: string,
): Fact => ({
  id: `f_plan_bunkering_1_options.${index}.${field}`,
  label: `${option.optionId} (${option.supplier}, ${option.port.name}): ${name}`,
  value,
  unit,
  provenance: {
    source: "calculation",
    calculationId: 1,
    calculator: "planBunkers",
    path: `options[${index}].${field}`,
  },
});

const bunkerOption = (
  index: number,
  o: Pick<BunkerOptionView, "optionId" | "supplier" | "port" | "rank" | "feasible" | "best"> & {
    price: number;
    total: number;
    delay: number;
  },
): BunkerOptionView => {
  const headlinePrice = bunkerFact(
    index,
    o,
    "headlinePriceUsdPerMt",
    "headline price",
    o.price,
    "USD/mt",
  );
  const totalCost = bunkerFact(index, o, "totalCostUsd", "total delivered cost", o.total, "USD");
  const delay = bunkerFact(index, o, "delayHours", "delay", o.delay, "h");
  return {
    optionId: o.optionId,
    supplier: o.supplier,
    port: o.port,
    rank: o.rank,
    feasible: o.feasible,
    best: o.best,
    headlinePrice,
    totalCost,
    delay,
    rows: [
      { name: "headline price", fact: headlinePrice },
      { name: "total delivered cost", fact: totalCost },
      { name: "delay", fact: delay },
    ],
  };
};

/**
 * Bunker plan 1 for MV Aegean Pioneer, in rank order: Kestrel at Marsaxlokk (best), Nordwind at
 * Algeciras and Strait Line at Gibraltar (two ports a few kilometres apart).
 */
export function makeBunkerPlan(): BunkerPlanView {
  return {
    calculationId: 1,
    grade: "LSMGO",
    vesselId: 1,
    voyageNo: "AP-2611",
    options: [
      bunkerOption(0, {
        optionId: "MTMLA-kestrel",
        supplier: "Kestrel Marine Fuels",
        port: { id: 3, name: "Marsaxlokk", unlocode: "MTMLA", position: { lat: 35.88, lon: 14.5 } },
        rank: 1,
        feasible: true,
        best: true,
        price: 738,
        total: 233942.91,
        delay: 11.12,
      }),
      bunkerOption(1, {
        optionId: "ESALG-nordwind",
        supplier: "Nordwind Bunker Services",
        port: {
          id: 5,
          name: "Algeciras",
          unlocode: "ESALG",
          position: { lat: 36.1408, lon: -5.4562 },
        },
        rank: 2,
        feasible: true,
        best: false,
        price: 745.2,
        total: 239253.28,
        delay: 14.96,
      }),
      bunkerOption(2, {
        optionId: "GIGIB-straitline",
        supplier: "Strait Line Fuels",
        port: {
          id: 6,
          name: "Gibraltar",
          unlocode: "GIGIB",
          position: { lat: 36.1408, lon: -5.3536 },
        },
        rank: 3,
        feasible: true,
        best: false,
        price: 712,
        total: 250081.36,
        delay: 36.32,
      }),
    ],
    marginVsRunnerUp: {
      id: "f_plan_bunkering_1_marginVsRunnerUpUsd",
      label:
        "LSMGO, best option MTMLA-kestrel: Margin of the best option over the runner-up, in total cost",
      value: 5310.37,
      unit: "USD",
      provenance: {
        source: "derived",
        operation: "subtract",
        operands: [
          "f_plan_bunkering_1_options.1.totalCostUsd",
          "f_plan_bunkering_1_options.0.totalCostUsd",
        ],
      },
    },
  };
}
