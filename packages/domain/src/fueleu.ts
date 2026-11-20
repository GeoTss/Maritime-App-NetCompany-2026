/**
 * FuelEU Maritime exposure (Regulation (EU) 2023/1805): the penalty a quantity of fuel would
 * attract at the year's GHG-intensity limit if nothing offsets it. Pooling, banking, borrowing,
 * the yearly average and the repeat-deficit multiplier are out of scope (Phase 6 Ruling R4).
 * Pure.
 */
import {
  FUEL_GRADES,
  FuelEuCostInput,
  type FuelEuCostInput as FuelEuCostInputT,
  type FuelEuCostResult,
  type FuelGrade,
} from "@pharos/shared";
import {
  FUELEU_FUEL,
  FUELEU_GRADE_FUEL,
  FUELEU_GWP_CH4,
  FUELEU_GWP_N2O,
  FUELEU_PENALTY_EUR_PER_T,
  FUELEU_REDUCTION,
  FUELEU_REFERENCE_G_PER_MJ,
  FUELEU_VLSFO_MJ_PER_T,
} from "./constants.js";

const G_PER_T = 1e6;

/** The year's GHG-intensity limit, g CO₂eq/MJ: reference × (1 − reduction); null before 2025. */
export function fuelEuTargetGPerMj(year: number): number | null {
  let reduction: number | null = null;
  for (const [from, r] of Object.entries(FUELEU_REDUCTION)) {
    if (Number(from) <= year) reduction = r;
  }
  return reduction === null ? null : FUELEU_REFERENCE_G_PER_MJ * (1 - reduction);
}

/** Well-to-wake intensity of a grade: WtT + (Cf_CO2 + Cf_CH4·GWP_CH4 + Cf_N2O·GWP_N2O) / LCV. */
export function wtwIntensityGPerMj(grade: FuelGrade): number {
  const f = FUELEU_FUEL[FUELEU_GRADE_FUEL[grade]];
  const ttw = f.cfCo2 + f.cfCh4 * FUELEU_GWP_CH4 + f.cfN2o * FUELEU_GWP_N2O;
  return f.wttGPerMj + ttw / f.lcvMjPerG;
}

/**
 * Energy in scope = Σ fuel × LCV × coverage; intensity energy-weighted; balance =
 * (target − intensity) × energy; penalty = |balance| / (intensity × 41 000) × 2 400 EUR when the
 * balance is a deficit, else 0.
 */
export function fuelEuCost(rawInput: FuelEuCostInputT): FuelEuCostResult {
  const input = FuelEuCostInput.parse(rawInput);
  let energyMj = 0;
  let weighted = 0;
  for (const grade of FUEL_GRADES) {
    const e =
      input.fuelMt[grade] *
      G_PER_T *
      FUELEU_FUEL[FUELEU_GRADE_FUEL[grade]].lcvMjPerG *
      input.coverage;
    energyMj += e;
    weighted += e * wtwIntensityGPerMj(grade);
  }
  const targetGPerMj = fuelEuTargetGPerMj(input.year);
  const intensityGPerMj = energyMj > 0 ? weighted / energyMj : 0;
  const balanceG =
    targetGPerMj === null || energyMj === 0 ? 0 : (targetGPerMj - intensityGPerMj) * energyMj;
  const penaltyEur =
    balanceG < 0
      ? (-balanceG / (intensityGPerMj * FUELEU_VLSFO_MJ_PER_T)) * FUELEU_PENALTY_EUR_PER_T
      : 0;
  return {
    energyMj,
    intensityGPerMj,
    targetGPerMj,
    complianceBalanceT: balanceG / G_PER_T,
    penaltyEur,
    penaltyUsd: penaltyEur * input.eurUsd,
  };
}
