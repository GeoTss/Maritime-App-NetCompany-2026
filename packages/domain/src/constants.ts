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
