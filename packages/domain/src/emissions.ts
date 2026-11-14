import type {
  CiiInput,
  CiiRatingLetter,
  CiiResult,
  EtsCostInput,
  EtsCostResult,
  EtsCoverageFactor,
  GradeAmounts,
} from "@pharos/shared";
import { FUEL_GRADES } from "@pharos/shared";
import {
  CII_BULK_CARRIER_REFERENCE_DWT_CAP,
  CII_RATING_BOUNDARIES,
  CII_REDUCTION_Z_PERCENT,
  CII_REFERENCE_PARAMS,
  CO2_FACTOR_T_PER_T,
  ETS_PHASE_IN,
} from "./constants.js";

/** Tonnes of CO2 emitted by burning the given fuel (t fuel × Cf per grade). */
export function co2Tonnes(fuelMt: GradeAmounts): number {
  let total = 0;
  for (const grade of FUEL_GRADES) total += fuelMt[grade] * CO2_FACTOR_T_PER_T[grade];
  return total;
}

/** EU ETS coverage of a voyage: EU↔EU 1, EU↔non-EU 0.5, non-EU↔non-EU 0. */
export function etsCoverage(fromIsEu: boolean, toIsEu: boolean): EtsCoverageFactor {
  if (fromIsEu && toIsEu) return 1;
  if (fromIsEu || toIsEu) return 0.5;
  return 0;
}

/** Share of verified emissions surrendered in a year: ≤2023 → 0, 2024-2026 tabled, later → 1. */
export function etsPhaseIn(year: number): number {
  if (year <= 2023) return 0;
  return ETS_PHASE_IN[year] ?? 1;
}

export function etsCost(input: EtsCostInput): EtsCostResult {
  const phaseIn = etsPhaseIn(input.year);
  const coveredCo2T = input.co2T * input.coverage * phaseIn;
  const costEur = coveredCo2T * input.euaPriceEur;
  return { coveredCo2T, phaseIn, costEur, costUsd: costEur * input.eurUsd };
}

function reductionZPercent(year: number): number {
  const first = 2023;
  const last = 2026;
  const z = CII_REDUCTION_Z_PERCENT[Math.min(Math.max(year, first), last)];
  if (z === undefined) throw new RangeError(`no CII reduction factor for year ${year}`);
  return z;
}

/**
 * Operational CII rating. attained = CO2 (g) / (DWT × nm); the reference line uses
 * capacity = DWT (bulk carriers capped at 279 000), attained always uses actual DWT.
 */
export function ciiRating(input: CiiInput): CiiResult {
  const { shipType, dwt, co2T, distanceNm, year } = input;
  if (!(dwt > 0)) throw new RangeError("dwt must be greater than 0");
  if (!(distanceNm > 0)) throw new RangeError("distanceNm must be greater than 0");

  const capacity =
    shipType === "bulk_carrier" ? Math.min(dwt, CII_BULK_CARRIER_REFERENCE_DWT_CAP) : dwt;
  const { a, c } = CII_REFERENCE_PARAMS[shipType];
  const reference = a * capacity ** -c;
  const required = reference * (1 - reductionZPercent(year) / 100);
  const attained = (co2T * 1e6) / (dwt * distanceNm);
  const ratio = attained / required;

  const [d1, d2, d3, d4] = CII_RATING_BOUNDARIES[shipType];
  let rating: CiiRatingLetter;
  if (ratio < d1) rating = "A";
  else if (ratio < d2) rating = "B";
  else if (ratio < d3) rating = "C";
  else if (ratio < d4) rating = "D";
  else rating = "E";

  return { attained, reference, required, ratio, rating };
}
