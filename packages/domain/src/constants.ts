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

/** A reference profile for a ship outside the fleet: its curve, day cost and load geometry. */
export interface ReferenceVesselProfile {
  curve: ConsumptionCurve;
  dailyCostUsd: number;
  /** Lightship weight, mt. Reference displacement = lightshipMt + dwtMt (full load). */
  lightshipMt: number;
  dwtMt: number;
  /** Ballast water in the ballast condition, mt: ballast displacement = lightshipMt + ballastMt. */
  ballastMt: number;
  /** Mean draught (m) fully laden and in ballast; `draughtLoad` interpolates between them. */
  ladenDraughtM: number;
  ballastDraughtM: number;
}

/**
 * Reference profiles for ships outside the fleet (route optimiser for an arbitrary vessel type).
 * Assumptions for planning, not data from any vessel: a Supramax-size bulk carrier, an
 * Aframax-size tanker and a 4 000 TEU-class container ship, with typical lightship, deadweight,
 * ballast water and draughts for those sizes (Phase 6 synthetic values).
 */
export const REFERENCE_VESSEL_PROFILES: Record<ShipType, ReferenceVesselProfile> = {
  bulk_carrier: {
    curve: { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 9, maxSpeedKn: 14.5 },
    dailyCostUsd: 16000,
    lightshipMt: 12_000,
    dwtMt: 60_000,
    ballastMt: 20_000,
    ladenDraughtM: 12.8,
    ballastDraughtM: 6.8,
  },
  tanker: {
    curve: { refSpeedKn: 13, refMtPerDay: 34, auxMtPerDay: 3, minSpeedKn: 9, maxSpeedKn: 14.5 },
    dailyCostUsd: 19000,
    lightshipMt: 17_000,
    dwtMt: 105_000,
    ballastMt: 35_000,
    ladenDraughtM: 14.8,
    ballastDraughtM: 7.6,
  },
  container: {
    curve: { refSpeedKn: 18, refMtPerDay: 70, auxMtPerDay: 4, minSpeedKn: 12, maxSpeedKn: 21 },
    dailyCostUsd: 24000,
    lightshipMt: 18_000,
    dwtMt: 52_000,
    ballastMt: 12_000,
    ladenDraughtM: 12.5,
    ballastDraughtM: 8.5,
  },
};

/**
 * `draughtLoad` thresholds: the share of the way from the ballast to the laden draught at or
 * above which a ship counts as laden, and at or below which it counts as in ballast. A
 * planning-grade reading of an AIS draught (Phase 6 Ruling R3), not a stability calculation.
 */
export const DRAUGHT_LADEN_SHARE = 0.85;
export const DRAUGHT_BALLAST_SHARE = 0.15;

/** Route plans: the speed grid step (kn) the baseline speed is rounded to. */
export const ROUTE_SPEED_STEP_KN = 0.5;

/** ETS (and FuelEU) coverage of a passage from an unknown last port: half when the destination is in the EU. */
export const SHIP_EU_COVERAGE = 0.5;

/** A baseline speed rounded to the speed grid (`stepKn`) and held within the curve's range. */
export function clampSpeed(
  curve: { minSpeedKn: number; maxSpeedKn: number },
  speedKn: number,
  stepKn: number = ROUTE_SPEED_STEP_KN,
): number {
  return Math.min(
    curve.maxSpeedKn,
    Math.max(curve.minSpeedKn, Math.round(speedKn / stepKn) * stepKn),
  );
}

/**
 * FuelEU Maritime, Regulation (EU) 2023/1805, Art. 4(2): the reference GHG intensity
 * (g CO₂eq/MJ) the yearly limits are set against.
 */
export const FUELEU_REFERENCE_G_PER_MJ = 91.16;

/**
 * Reduction below the reference, from the given year until the next key. Regulation (EU)
 * 2023/1805 Art. 4(2): 2 % from 2025, 6 % from 2030, 14.5 % from 2035, 31 % from 2040, 62 % from
 * 2045, 80 % from 2050. Look years up through `fuelEuTargetGPerMj` (fueleu.ts).
 */
export const FUELEU_REDUCTION: Record<number, number> = {
  2025: 0.02,
  2030: 0.06,
  2035: 0.145,
  2040: 0.31,
  2045: 0.62,
  2050: 0.8,
};

/**
 * Default factors per fuel class, Regulation (EU) 2023/1805 Annex II (verbatim): lower calorific
 * value (MJ/g), well-to-tank intensity (g CO₂eq/MJ) and tank-to-wake emission factors (g gas per g
 * fuel). No methane slip for these fuels.
 */
export const FUELEU_FUEL = {
  HFO: { lcvMjPerG: 0.0405, wttGPerMj: 13.5, cfCo2: 3.114, cfCh4: 0.00005, cfN2o: 0.00018 },
  MDO_MGO: { lcvMjPerG: 0.0427, wttGPerMj: 14.4, cfCo2: 3.206, cfCh4: 0.00005, cfN2o: 0.00018 },
} as const;
export type FuelEuFuelClass = keyof typeof FUELEU_FUEL;

/**
 * Which Annex II row a grade is reported under (Phase 6 Ruling R4): VLSFO and HSFO as HFO
 * (consistent with the 3.114 CO₂ factor above), LSMGO as MDO/MGO.
 */
export const FUELEU_GRADE_FUEL: Record<FuelGrade, FuelEuFuelClass> = {
  LSMGO: "MDO_MGO",
  VLSFO: "HFO",
  HSFO: "HFO",
};

/**
 * Global warming potentials (100-year) FuelEU uses: Directive (EU) 2018/2001 Annex V Part C
 * point 4 (consolidated text of 2023-11-20, unchanged by Directive (EU) 2023/2413),
 * https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02018L2001-20231120
 */
export const FUELEU_GWP_CH4 = 25;
export const FUELEU_GWP_N2O = 298;

/**
 * Penalty, Regulation (EU) 2023/1805 Annex IV Part B: a deficit is converted to tonnes of VLSFO
 * equivalent at 41 000 MJ/t and charged EUR 2 400 per tonne.
 */
export const FUELEU_VLSFO_MJ_PER_T = 41_000;
export const FUELEU_PENALTY_EUR_PER_T = 2_400;

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
 * Route search: an edge with a sample point (sampled every ≤ 10 nm, endpoints included) inside a
 * hazard zone weighs this many times its length, so the shortest path goes round the hazard
 * whenever the network allows. Illustrative.
 */
export const HAZARD_EDGE_PENALTY = 1000;

/** Highest significant wave height (m) at which a barge can bunker alongside (planning limit). */
export const BUNKERING_MAX_WAVE_M = 2.0;

/**
 * Heavy weather: a route option or stop plan that meets a significant wave height above this (m)
 * at the time the ship is there is infeasible (`heavy_weather`). Illustrative planning limit.
 */
export const HEAVY_WEATHER_MAX_WAVE_M = 6.0;

/** Storm cells: grid points over the limit within ± this many hours of the baseline's pass time. */
export const STORM_WINDOW_HOURS = 6;

/**
 * Keep-out radius (nm) of a storm cell. At least the half-diagonal of a 2° grid cell anywhere in the
 * 30–56°N grid, so outside the circle the cell is never the nearest sample (`sampleWeather` takes
 * the nearest grid point).
 */
export const STORM_CELL_RADIUS_NM = 80;

/** Provisions: the reserve (days) the company keeps at the end of a voyage. Illustrative. */
export const PROVISIONS_RESERVE_DAYS = 7;

/** Provisions: the days of stores a resupply tops up to. Illustrative. */
export const PROVISIONS_TARGET_DAYS = 60;

/**
 * Purifier sludge (m³) per tonne of fuel burned, by grade (MARPOL Annex I sludge tank; residual
 * fuels leave far more than distillates). Illustrative planning rates.
 */
export const SLUDGE_M3_PER_MT: Record<"HSFO" | "VLSFO" | "LSMGO", number> = {
  HSFO: 0.015,
  VLSFO: 0.01,
  LSMGO: 0.003,
};

/**
 * Sewage into the holding tank per person per day (m³), counted only in port or at anchor: at sea
 * the treatment plant discharges (MARPOL Annex IV). Illustrative.
 */
export const SEWAGE_M3_PER_PERSON_DAY = 0.07;

/** Waste tanks are planned to this share of capacity at most. Illustrative. */
export const WASTE_MAX_FILL = 0.9;

/**
 * Hours before arrival each notice is due: security information under SOLAS XI-2/9; the advance
 * waste notification under Directive (EU) 2019/883 Art. 6 (EU ports only); the agent's
 * appointment by desk practice.
 */
export const NOTICE_LEAD_HOURS: Record<
  "agent_appointment" | "security_pre_arrival" | "eu_waste_notification",
  number
> = {
  agent_appointment: 24,
  security_pre_arrival: 24,
  eu_waste_notification: 24,
};

/**
 * War-risk additional premium (% of hull value) for a transit of a `premium` area: 0.5 % for a
 * Bab-el-Mandeb transit, July 2026 (S&P Global/Marsh via Al Jazeera, 23 Jul 2026; see
 * docs/research/2026-11-19-maritime-security-sources.md).
 */
export const WAR_RISK_PREMIUM_PCT = 0.5;

/** A security quote's embark or disembark port covers a route only within this distance (nm) of it. */
export const SECURITY_POINT_MAX_NM = 250;

/** Holding-tank sewage goes overboard only this far (nm) from the nearest land (MARPOL Annex IV reg. 11.1.1). */
export const SEWAGE_DISCHARGE_MIN_LAND_NM = 12;

/** …and only while en route at this speed over ground (kn) or more (same regulation). */
export const SEWAGE_DISCHARGE_MIN_SOG_KN = 4;

/** A discharge window shorter than this (h) is not shown on the timeline. */
export const SEWAGE_MIN_WINDOW_HOURS = 1;

/** The changeover to LSMGO starts this many hours before the sulphur-ECA line (illustrative). */
export const ECA_CHANGEOVER_LEAD_HOURS = 1;

/** Bucket size (degrees) of the coastline index behind the distance-from-land check. */
export const COAST_CELL_DEG = 1;

/** A storm passed farther than this (nm) from its edge is not on the voyage timeline. */
export const STORM_PASS_NEAR_NM = 160;
