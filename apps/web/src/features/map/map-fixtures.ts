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
    alerts: ["lsmgo_below_margin_for_eca"],
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
  fobProjection: {
    legs: [
      {
        index: 0,
        grade: "VLSFO",
        hours: 40,
        fuelMt: 50,
        robAfterMt: { LSMGO: 275, VLSFO: 570, HSFO: 0 },
      },
      {
        index: 1,
        grade: "LSMGO",
        hours: 60,
        fuelMt: 90,
        robAfterMt: { LSMGO: 185, VLSFO: 570, HSFO: 0 },
      },
    ],
    requiredMt: { LSMGO: 90, VLSFO: 50, HSFO: 0 },
    safetyMarginMt: { LSMGO: 20, VLSFO: 20, HSFO: 0 },
    minRobMt: { LSMGO: 185, VLSFO: 570, HSFO: 0 },
    shortfallMt: { LSMGO: 0, VLSFO: 0, HSFO: 0 },
    belowMarginAtLeg: { LSMGO: 1, VLSFO: null, HSFO: null },
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
    },
    facts: kept,
    computeMs: 80,
  };
}

/** A stored route plan as `GET /api/route-plans/:id` serves it: the plan above, compute time unknown. */
export function makeStoredRoutePlan(calculationId: number): RoutePlanView {
  return { ...makePlan(), calculationId, computeMs: null };
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
