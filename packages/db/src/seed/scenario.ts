/**
 * Hand-chosen inputs for the synthetic demo world. Ports and sea routes are real (UN/LOCODE,
 * Eurostat network via routes.generated.json); vessels, suppliers and prices are fictional.
 * Change numbers here, never in generated rows. Every tuning against the brief is listed in
 * the Task 6 report.
 */
import { imoWithCheckDigit } from "@pharos/domain";
import type { ConsumptionCurve, Currency, FuelGrade, GradeAmounts, ShipType } from "@pharos/shared";

export const SEED_VERSION = "joint-plan-v1";

export interface ScenarioPort {
  unlocode: string;
  name: string;
  country: string;
  isEu: boolean;
  /** Inside a 0.1 % S ECA (Mediterranean or North Sea incl. Channel east of 5°W). */
  inEca: boolean;
  approachNm: number;
}

export const PORTS: readonly ScenarioPort[] = [
  { unlocode: "EGPSD", name: "Port Said", country: "EG", isEu: false, inEca: true, approachNm: 6 },
  { unlocode: "GRPIR", name: "Piraeus", country: "GR", isEu: true, inEca: true, approachNm: 8 },
  { unlocode: "MTMLA", name: "Marsaxlokk", country: "MT", isEu: true, inEca: true, approachNm: 14 },
  { unlocode: "ITGOA", name: "Genoa", country: "IT", isEu: true, inEca: true, approachNm: 6 },
  { unlocode: "ESALG", name: "Algeciras", country: "ES", isEu: true, inEca: true, approachNm: 12 },
  { unlocode: "GIGIB", name: "Gibraltar", country: "GI", isEu: false, inEca: true, approachNm: 4 },
  { unlocode: "PTSIE", name: "Sines", country: "PT", isEu: true, inEca: false, approachNm: 5 },
  // Brest lies south of 48°30'N, outside the North Sea ECA.
  { unlocode: "FRBES", name: "Brest", country: "FR", isEu: true, inEca: false, approachNm: 10 },
  { unlocode: "FRLEH", name: "Le Havre", country: "FR", isEu: true, inEca: true, approachNm: 8 },
  { unlocode: "BEANR", name: "Antwerp", country: "BE", isEu: true, inEca: true, approachNm: 40 },
  { unlocode: "NLRTM", name: "Rotterdam", country: "NL", isEu: true, inEca: true, approachNm: 10 },
  { unlocode: "DEHAM", name: "Hamburg", country: "DE", isEu: true, inEca: true, approachNm: 50 },
];

/** Directed legs built by build-routes.ts from the real sea-route network. */
export const LEGS: readonly (readonly [string, string])[] = [
  ["EGPSD", "MTMLA"],
  ["MTMLA", "GIGIB"],
  ["GIGIB", "PTSIE"],
  ["PTSIE", "FRBES"],
  ["FRBES", "NLRTM"],
  ["GIGIB", "ESALG"],
  ["ESALG", "GIGIB"],
  ["ESALG", "PTSIE"],
  ["EGPSD", "GRPIR"],
  ["GRPIR", "ITGOA"],
  ["GRPIR", "MTMLA"],
  ["MTMLA", "ITGOA"],
  ["ITGOA", "ESALG"],
  ["NLRTM", "DEHAM"],
  ["DEHAM", "BEANR"],
  ["BEANR", "FRLEH"],
  ["FRLEH", "FRBES"],
];

const AEGEAN_PIONEER_IMO_BASE = "948001";

export interface ScenarioVessel {
  name: string;
  /** First six IMO digits; the check digit is computed. */
  imoBase: string;
  shipType: ShipType;
  dwt: number;
  /** Lightship weight, mt (synthetic). Full-load displacement = lightship + dwt. */
  lightshipMt: number;
  tankCapacityMt: GradeAmounts;
  consumptionCurve: ConsumptionCurve;
  dailyCostUsd: number;
  voyage: {
    voyageNo: string;
    route: readonly string[];
    plannedSpeedKn: number;
    /** Hours before the anchor the vessel left the origin; null = still in port, sails at the anchor. */
    departedHoursAgo: number | null;
    /** Cargo and ballast water on board for the passage, mt (synthetic; cargo + ballast ≤ dwt). */
    cargoMt: number;
    ballastMt: number;
  };
  /** Current (k = 0 noon report) remaining on board. */
  currentRobMt: GradeAmounts;
}

const bulkCurve = (refMtPerDay: number): ConsumptionCurve => ({
  refSpeedKn: 13,
  refMtPerDay,
  auxMtPerDay: 2.5,
  minSpeedKn: 9,
  maxSpeedKn: 14.5,
});

export const VESSELS: readonly ScenarioVessel[] = [
  {
    name: "MV Aegean Pioneer",
    imoBase: AEGEAN_PIONEER_IMO_BASE,
    shipType: "bulk_carrier",
    dwt: 58_000,
    lightshipMt: 11_000,
    // Tuned: LSMGO tank 450 -> 600 so a 300 mt stem fits (see report).
    tankCapacityMt: { LSMGO: 600, VLSFO: 1_500, HSFO: 0 },
    consumptionCurve: bulkCurve(30),
    dailyCostUsd: 16_000,
    voyage: {
      voyageNo: "AP-2611",
      route: ["EGPSD", "MTMLA", "GIGIB", "PTSIE", "FRBES", "NLRTM"],
      plannedSpeedKn: 12.5,
      departedHoursAgo: 24,
      // Phase 6 probe: laden at 54 000 t keeps the LSMGO shortfall (17.6 mt) and the demo trap.
      cargoMt: 54_000,
      ballastMt: 0,
    },
    // Tuned for the joint route-and-bunker planner (apps/api/src/routing/demo-world.test.ts, R1-R6):
    // LSMGO 275 -> 203, the middle of the passing run 194-211 t. R1 the current plan falls below its
    // LSMGO margin; R2 no route keeps it at any speed that meets the berth window; R3 the stop at
    // Marsaxlokk with Kestrel is recommended; R4 a second quote is feasible; R5 the bunker answer is
    // unchanged; R6 Kestrel's 300 t fits the tank.
    currentRobMt: { LSMGO: 203, VLSFO: 620, HSFO: 0 },
  },
  {
    name: "MV Thessaly Star",
    imoBase: "948102",
    shipType: "bulk_carrier",
    dwt: 63_500,
    lightshipMt: 12_000,
    tankCapacityMt: { LSMGO: 500, VLSFO: 1_600, HSFO: 0 },
    consumptionCurve: bulkCurve(32),
    dailyCostUsd: 17_000,
    voyage: {
      voyageNo: "TS-2609",
      route: ["GRPIR", "ITGOA", "ESALG"],
      plannedSpeedKn: 12,
      departedHoursAgo: 40,
      cargoMt: 58_000,
      ballastMt: 0,
    },
    currentRobMt: { LSMGO: 310, VLSFO: 540, HSFO: 0 },
  },
  {
    name: "MV Nordic Lantern",
    imoBase: "948203",
    shipType: "bulk_carrier",
    dwt: 38_000,
    lightshipMt: 8_500,
    tankCapacityMt: { LSMGO: 400, VLSFO: 1_100, HSFO: 0 },
    consumptionCurve: bulkCurve(24),
    dailyCostUsd: 13_500,
    voyage: {
      voyageNo: "NL-2614",
      route: ["NLRTM", "DEHAM"],
      plannedSpeedKn: 11,
      departedHoursAgo: 10,
      cargoMt: 34_000,
      ballastMt: 0,
    },
    currentRobMt: { LSMGO: 280, VLSFO: 700, HSFO: 0 },
  },
  {
    name: "MV Iberian Dawn",
    imoBase: "948304",
    shipType: "bulk_carrier",
    dwt: 81_000,
    lightshipMt: 14_500,
    tankCapacityMt: { LSMGO: 550, VLSFO: 2_000, HSFO: 0 },
    consumptionCurve: bulkCurve(36),
    dailyCostUsd: 19_000,
    voyage: {
      voyageNo: "ID-2615",
      route: ["DEHAM", "BEANR", "FRLEH"],
      plannedSpeedKn: 11.5,
      departedHoursAgo: null,
      // In ballast to her loading port: the fleet's ballast voyage.
      cargoMt: 0,
      ballastMt: 26_000,
    },
    currentRobMt: { LSMGO: 360, VLSFO: 1_250, HSFO: 0 },
  },
  {
    name: "MT Levant Carrier",
    imoBase: "948405",
    shipType: "tanker",
    dwt: 74_000,
    lightshipMt: 14_000,
    tankCapacityMt: { LSMGO: 600, VLSFO: 2_200, HSFO: 800 },
    consumptionCurve: {
      refSpeedKn: 13.5,
      refMtPerDay: 38,
      auxMtPerDay: 4,
      minSpeedKn: 9,
      maxSpeedKn: 15,
    },
    dailyCostUsd: 24_000,
    voyage: {
      voyageNo: "LC-2610",
      route: ["EGPSD", "GRPIR", "ITGOA"],
      plannedSpeedKn: 13,
      departedHoursAgo: 30,
      cargoMt: 68_000,
      ballastMt: 0,
    },
    currentRobMt: { LSMGO: 420, VLSFO: 900, HSFO: 300 },
  },
  {
    name: "MT Atlantic Meridian",
    imoBase: "948506",
    shipType: "tanker",
    dwt: 109_000,
    lightshipMt: 18_000,
    tankCapacityMt: { LSMGO: 650, VLSFO: 2_600, HSFO: 1_000 },
    consumptionCurve: {
      refSpeedKn: 13.5,
      refMtPerDay: 44,
      auxMtPerDay: 4.5,
      minSpeedKn: 9,
      maxSpeedKn: 15,
    },
    dailyCostUsd: 27_000,
    voyage: {
      voyageNo: "AM-2612",
      route: ["ESALG", "PTSIE", "FRBES"],
      plannedSpeedKn: 12.5,
      departedHoursAgo: 20,
      cargoMt: 100_000,
      ballastMt: 0,
    },
    currentRobMt: { LSMGO: 380, VLSFO: 1_400, HSFO: 500 },
  },
  {
    name: "MV Coral Horizon",
    imoBase: "948607",
    shipType: "container",
    dwt: 52_000,
    lightshipMt: 17_000,
    tankCapacityMt: { LSMGO: 700, VLSFO: 3_000, HSFO: 0 },
    consumptionCurve: {
      refSpeedKn: 18,
      refMtPerDay: 85,
      auxMtPerDay: 6,
      minSpeedKn: 12,
      maxSpeedKn: 21,
    },
    dailyCostUsd: 32_000,
    voyage: {
      voyageNo: "CH-2613",
      route: ["MTMLA", "GIGIB", "PTSIE"],
      plannedSpeedKn: 17,
      departedHoursAgo: 36,
      cargoMt: 38_000,
      ballastMt: 4_000,
    },
    currentRobMt: { LSMGO: 520, VLSFO: 1_900, HSFO: 0 },
  },
  {
    name: "MV Scheldt Express",
    imoBase: "948708",
    shipType: "container",
    dwt: 28_000,
    lightshipMt: 9_500,
    tankCapacityMt: { LSMGO: 450, VLSFO: 1_400, HSFO: 0 },
    consumptionCurve: {
      refSpeedKn: 17,
      refMtPerDay: 48,
      auxMtPerDay: 4,
      minSpeedKn: 11,
      maxSpeedKn: 20,
    },
    dailyCostUsd: 21_000,
    voyage: {
      voyageNo: "SE-2616",
      route: ["BEANR", "FRLEH", "FRBES"],
      plannedSpeedKn: 15,
      departedHoursAgo: null,
      cargoMt: 20_000,
      ballastMt: 2_000,
    },
    currentRobMt: { LSMGO: 300, VLSFO: 880, HSFO: 0 },
  },
];

export interface ScenarioSupplier {
  key: string;
  name: string;
  emailDomain: string;
  erpCode: string;
  ports: readonly string[];
}

export const SUPPLIERS: readonly ScenarioSupplier[] = [
  {
    key: "kestrel",
    name: "Kestrel Marine Fuels",
    emailDomain: "kestrel-fuels.example",
    erpCode: "SUP-KES",
    ports: ["MTMLA", "GRPIR"],
  },
  {
    key: "nordwind",
    name: "Nordwind Bunker Services",
    emailDomain: "nordwind-bunker.example",
    erpCode: "SUP-NWB",
    ports: ["ESALG", "NLRTM", "BEANR"],
  },
  {
    key: "straitline",
    name: "Strait Line Fuels",
    emailDomain: "straitline-fuels.example",
    erpCode: "SUP-SLF",
    ports: ["GIGIB", "ESALG"],
  },
  {
    key: "harbourlight",
    name: "Harbourlight Energy",
    emailDomain: "harbourlight.example",
    erpCode: "SUP-HLE",
    ports: ["NLRTM", "DEHAM", "BEANR"],
  },
  {
    key: "meridian",
    name: "Meridian Bunkering",
    emailDomain: "meridian-bunkering.example",
    erpCode: "SUP-MRB",
    ports: ["EGPSD", "GRPIR", "ITGOA"],
  },
  {
    key: "atlanticshelf",
    name: "Atlantic Shelf Fuels",
    emailDomain: "atlantic-shelf.example",
    erpCode: "SUP-ASF",
    ports: ["PTSIE", "FRBES", "FRLEH"],
  },
];

/** Price bands (USD/mt) for seeded port fuel prices; demo-relevant ports are fixed below. */
export const PRICE_BANDS: Record<FuelGrade, readonly [number, number]> = {
  LSMGO: [720, 790],
  VLSFO: [560, 620],
  HSFO: [450, 500],
};

/** Fixed waiting times (hours) at the demo bunker ports; other ports get seeded values. */
export const FIXED_WAITING_HOURS: Readonly<Record<string, number>> = {
  MTMLA: 4,
  ESALG: 8,
  GIGIB: 30,
};

export const REFERENCE_RATES = { EURUSD: 1.08, EUA_EUR: 75 } as const;

export interface DemoBunkerOption {
  optionId: string;
  supplierKey: string;
  portLocode: string;
  currency: Currency;
  pricePerMt: number;
  bargeFee: number;
  qtyMt: number;
  bunkeringHours: number;
  deviationNm: number;
}

/**
 * The three supplier offers the demo inbox delivers (Phase 3 fixture emails are written from
 * these values). Not inserted as quotes by the seed. Waiting hours come from portCongestion.
 */
export const DEMO_SCENARIO = {
  vesselImo: imoWithCheckDigit(AEGEAN_PIONEER_IMO_BASE),
  voyageNo: "AP-2611",
  requirement: { grade: "LSMGO" as const, qtyMt: 300 },
  safetyMarginDays: 2,
  options: [
    {
      optionId: "MTMLA-kestrel",
      supplierKey: "kestrel",
      portLocode: "MTMLA",
      currency: "USD",
      pricePerMt: 738,
      bargeFee: 2_800,
      qtyMt: 300,
      bunkeringHours: 6,
      deviationNm: 14,
    },
    {
      optionId: "ESALG-nordwind",
      supplierKey: "nordwind",
      portLocode: "ESALG",
      currency: "EUR",
      pricePerMt: 690,
      bargeFee: 3_000,
      qtyMt: 300,
      bunkeringHours: 6,
      deviationNm: 12,
    },
    {
      optionId: "GIGIB-straitline",
      supplierKey: "straitline",
      portLocode: "GIGIB",
      currency: "USD",
      pricePerMt: 712,
      bargeFee: 9_000,
      qtyMt: 300,
      bunkeringHours: 6,
      deviationNm: 4,
    },
  ] satisfies DemoBunkerOption[],
  /**
   * The one demo offer whose quantity is ambiguous: the supplier writes a range, so the quote needs
   * review and shows no quantity until a human confirms one. This is the text exactly as written.
   */
  needsReview: { supplierKey: "nordwind", qtyAsWritten: "300/350 mt" },
};
