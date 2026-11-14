import type { FuelGrade } from "@pharos/shared";

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
 * Rule: any year >= 2026 is 1; years before 2024 are not covered (look up with `?? 0`).
 */
export const ETS_PHASE_IN: Record<number, number> = {
  2024: 0.4,
  2025: 0.7,
  2026: 1,
};

/** CII reference line parameters: reference = a × capacity^(−c). Source: IMO MEPC.353(78) (G2), Table 1. */
export const CII_REFERENCE_PARAMS = {
  bulk_carrier: { a: 4745, c: 0.622 },
  tanker: { a: 5247, c: 0.61 },
  container: { a: 1984, c: 0.489 },
} as const;

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
export const CII_RATING_BOUNDARIES: Record<
  "bulk_carrier" | "tanker" | "container",
  readonly [number, number, number, number]
> = {
  bulk_carrier: [0.86, 0.94, 1.06, 1.18],
  tanker: [0.82, 0.93, 1.08, 1.28],
  container: [0.83, 0.94, 1.07, 1.19],
};
