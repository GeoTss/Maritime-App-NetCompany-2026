import type { ConsumptionCurve, FuelGrade, ShipType } from "@pharos/shared";

/** Mean Earth radius in nautical miles (6371.0088 km / 1.852 km per nm). Haversine great-circle distance. */
export const EARTH_RADIUS_NM = 3440.065;

/**
 * CO2 emission factor Cf, tonnes CO2 per tonne fuel.
 * Source: IMO MEPC.364(79) (2022 Guidelines on operational carbon intensity indicators), Table 1.
 * LSMGO = marine gas oil (3.206); VLSFO and HSFO = fuel oil (3.114).
 */
export const CO2_FACTOR_T_PER_T: Record<FuelGrade, number> = {
  LSMGO: 3.206,
  VLSFO: 3.114,
  HSFO: 3.114,
};

/**
 * EU ETS maritime phase-in: share of verified emissions to be surrendered, by reporting year.
 * Source: Directive (EU) 2023/959 amending Directive 2003/87/EC (40% of 2024, 70% of 2025, 100% from 2026).
 * Look years up through `etsPhaseIn(year)` (emissions.ts): ≤ 2023 → 0, 2024–2026 from this table,
 * after 2026 → 1. Do not index this table directly.
 */
export const ETS_PHASE_IN: Record<number, number> = {
  2024: 0.4,
  2025: 0.7,
  2026: 1,
};

/** CII reference line parameters: reference = a × capacity^(−c). Source: IMO MEPC.353(78) (G2), Table 1. */
export const CII_REFERENCE_PARAMS: Record<ShipType, { readonly a: number; readonly c: number }> = {
  bulk_carrier: { a: 4745, c: 0.622 },
  tanker: { a: 5247, c: 0.61 },
  container: { a: 1984, c: 0.489 },
};

/** Bulk carrier reference-line capacity is capped at 279 000 DWT. Source: IMO MEPC.353(78) (G2), Table 1. */
export const CII_BULK_CARRIER_REFERENCE_DWT_CAP = 279000;

/**
 * CII annual reduction factor Z, percent below the 2019 reference line.
 * Source: IMO MEPC.338(76) (G3): 5 % in 2023, rising 2 points a year. 2026 = 11 % per the Phase 1 brief.
 * Years after 2026 keep the 2026 value until amended; years before 2023 are treated as 2023.
 */
export const CII_REDUCTION_Z_PERCENT: Record<number, number> = {
  2023: 5,
  2024: 7,
  2025: 9,
  2026: 11,
};

/**
 * CII rating boundaries d1..d4 (multipliers of the required CII).
 * ratio < d1 → A, < d2 → B, < d3 → C, < d4 → D, else E.
 * Source: IMO MEPC.354(78) (G4), Table 1.
 */
export const CII_RATING_BOUNDARIES: Record<ShipType, readonly [number, number, number, number]> = {
  bulk_carrier: [0.86, 0.94, 1.06, 1.18],
  tanker: [0.82, 0.93, 1.08, 1.28],
  container: [0.83, 0.94, 1.07, 1.19],
};

/** Weather effect on speed. Illustrative planning parameters, not a vessel-specific seakeeping model. */
export const WAVE_LOSS_PCT_PER_M2 = 1.0;
export const WIND_LOSS_PCT_PER_KN = 0.1;
/** Headwind component below this (kn) costs no speed. */
export const WIND_LOSS_THRESHOLD_KN = 10;
export const MAX_SPEED_LOSS = 0.4;
/** Floor for speed over ground (kn) so a transit time is always finite. */
export const MIN_SOG_KN = 1;
/** A weather grid point farther than this (nm) from the position is treated as no data. */
export const WEATHER_MAX_NM = 120;

/** Port congestion from AIS. Illustrative parameters, not measured queue times. */
export const ANCHORAGE_RADIUS_NM = 20;
export const WAIT_HOURS_PER_ANCHORED_VESSEL = 1.5;
export const MAX_WAITING_HOURS = 72;

/**
 * Reference profiles for ships outside the fleet (route optimiser for an arbitrary vessel type).
 * Assumptions for planning, not data from any vessel.
 */
export const REFERENCE_VESSEL_PROFILES: Record<
  ShipType,
  { curve: ConsumptionCurve; dailyCostUsd: number }
> = {
  bulk_carrier: {
    curve: { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 9, maxSpeedKn: 14.5 },
    dailyCostUsd: 16000,
  },
  tanker: {
    curve: { refSpeedKn: 13, refMtPerDay: 34, auxMtPerDay: 3, minSpeedKn: 9, maxSpeedKn: 14.5 },
    dailyCostUsd: 19000,
  },
  container: {
    curve: { refSpeedKn: 18, refMtPerDay: 70, auxMtPerDay: 4, minSpeedKn: 12, maxSpeedKn: 21 },
    dailyCostUsd: 24000,
  },
};

/**
 * Exclusion radius (nm) of a reported navigational hazard by kind, when the report gives none.
 * Illustrative planning parameters, not a regulation: a distress beacon or an aid to navigation
 * adrift marks a small area; a search-and-rescue aircraft or a safety broadcast a wide one.
 * A synthetic demo hazard carries its own radius.
 */
export const HAZARD_DEFAULT_RADIUS_NM: Record<
  "distress_beacon" | "sar_aircraft" | "aton" | "safety_message",
  number
> = {
  distress_beacon: 5,
  sar_aircraft: 10,
  aton: 2,
  safety_message: 10,
};

/** Radius (nm) used for a synthetic hazard that has none of its own. Illustrative. */
export const HAZARD_SYNTHETIC_RADIUS_NM = 10;

/**
 * Hours a reported hazard stays active after it was last observed, by kind. Illustrative
 * planning parameters. A synthetic demo hazard never expires.
 */
export const HAZARD_LIFETIME_HOURS: Record<
  "distress_beacon" | "sar_aircraft" | "aton" | "safety_message",
  number
> = {
  distress_beacon: 24,
  sar_aircraft: 6,
  aton: 72,
  safety_message: 24,
};

/**
 * Route search: an edge whose endpoint or midpoint lies inside a hazard zone weighs this many times
 * its length, so the shortest path goes round the hazard whenever the network allows. Illustrative.
 */
export const HAZARD_EDGE_PENALTY = 1000;
