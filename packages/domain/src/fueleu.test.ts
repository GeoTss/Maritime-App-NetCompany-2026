/*
 * FuelEU Maritime, Regulation (EU) 2023/1805:
 * - Art. 4(2): reference value 91.16 g CO₂eq/MJ; limit = reference × (1 − reduction), reduction
 *   2 % from 2025, 6 % from 2030, 14.5 % from 2035, 31 % from 2040, 62 % from 2045, 80 % from 2050.
 * - Annex II: HFO LCV 0.0405 MJ/g, WtT 13.5 g CO₂eq/MJ, Cf CO₂ 3.114; MDO/MGO LCV 0.0427,
 *   WtT 14.4, Cf CO₂ 3.206; both Cf CH₄ 0.00005 and Cf N₂O 0.00018 (g/g fuel).
 * - Annex IV Part B: penalty = |CB| / (GHGIE_actual × 41 000) × 2 400 EUR, CB in g CO₂eq.
 * The Annex I intensity equation and the Annex IV penalty are images on EUR-Lex; the form used is
 * the one ABS publishes (intensity = WtT + (Cf_CO2 + Cf_CH4·GWP_CH4 + Cf_N2O·GWP_N2O) / LCV for a
 * fossil fuel with no slip; CB = (target − actual) × energy).
 * GWP100: CH₄ 25, N₂O 298, Directive (EU) 2018/2001 Annex V Part C point 4 (consolidated text of
 * 2023-11-20, unchanged by Directive (EU) 2023/2413),
 * https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02018L2001-20231120
 */
import { describe, expect, it } from "vitest";
import {
  FUELEU_FUEL,
  FUELEU_GRADE_FUEL,
  FUELEU_GWP_CH4,
  FUELEU_GWP_N2O,
  FUELEU_PENALTY_EUR_PER_T,
  FUELEU_REFERENCE_G_PER_MJ,
  FUELEU_VLSFO_MJ_PER_T,
} from "./constants.js";
import { fuelEuCost, fuelEuTargetGPerMj, wtwIntensityGPerMj } from "./fueleu.js";

const HFO_100 = { LSMGO: 0, VLSFO: 0, HSFO: 100 };

describe("constants", () => {
  it("match the regulation and the directive", () => {
    expect(FUELEU_REFERENCE_G_PER_MJ).toBe(91.16);
    expect(FUELEU_GWP_CH4).toBe(25);
    expect(FUELEU_GWP_N2O).toBe(298);
    expect(FUELEU_VLSFO_MJ_PER_T).toBe(41_000);
    expect(FUELEU_PENALTY_EUR_PER_T).toBe(2_400);
    expect(FUELEU_FUEL.HFO).toEqual({
      lcvMjPerG: 0.0405,
      wttGPerMj: 13.5,
      cfCo2: 3.114,
      cfCh4: 0.00005,
      cfN2o: 0.00018,
    });
    expect(FUELEU_FUEL.MDO_MGO).toEqual({
      lcvMjPerG: 0.0427,
      wttGPerMj: 14.4,
      cfCo2: 3.206,
      cfCh4: 0.00005,
      cfN2o: 0.00018,
    });
    expect(FUELEU_GRADE_FUEL).toEqual({ LSMGO: "MDO_MGO", VLSFO: "HFO", HSFO: "HFO" });
  });
});

describe("fuelEuTargetGPerMj", () => {
  it("2026 = 91.16 × (1 − 0.02) = 89.3368", () => {
    expect(fuelEuTargetGPerMj(2026)).toBeCloseTo(89.3368, 10);
  });
  it("steps at 2030 (6 %: 85.6904) and 2050 (80 %: 18.232), holding between steps", () => {
    expect(fuelEuTargetGPerMj(2029)).toBeCloseTo(89.3368, 10);
    expect(fuelEuTargetGPerMj(2030)).toBeCloseTo(85.6904, 10);
    expect(fuelEuTargetGPerMj(2035)).toBeCloseTo(77.9418, 10); // 91.16 × 0.855
    expect(fuelEuTargetGPerMj(2060)).toBeCloseTo(18.232, 10);
  });
  it("is null before 2025", () => {
    expect(fuelEuTargetGPerMj(2024)).toBeNull();
  });
});

describe("wtwIntensityGPerMj", () => {
  it("HFO: 13.5 + (3.114 + 0.00005×25 + 0.00018×298) / 0.0405 = 13.5 + 3.16889/0.0405 ≈ 91.7442", () => {
    expect(wtwIntensityGPerMj("HSFO")).toBeCloseTo(91.7442, 4);
    expect(wtwIntensityGPerMj("VLSFO")).toBe(wtwIntensityGPerMj("HSFO"));
  });
  it("MGO: 14.4 + (3.206 + 0.00125 + 0.05364) / 0.0427 = 14.4 + 3.26089/0.0427 ≈ 90.7674", () => {
    expect(wtwIntensityGPerMj("LSMGO")).toBeCloseTo(90.7674, 4);
  });
});

describe("fuelEuCost", () => {
  it("100 mt HFO at coverage 1 in 2026", () => {
    // energy = 100e6 g × 0.0405 MJ/g = 4 050 000 MJ
    // balance = (89.3368 − 91.7442) × 4 050 000 g = −9 749 970 g ≈ −9.75 t CO₂eq
    // penalty = 9 749 970 / (91.7442 × 41 000) × 2 400 = 9 749 970 / 3 761 512.2 × 2 400 ≈ EUR 6 220.9
    // in USD at 1.08: 6 220.9 × 1.08 ≈ 6 718.6
    const r = fuelEuCost({ fuelMt: HFO_100, coverage: 1, year: 2026, eurUsd: 1.08 });
    expect(r.energyMj).toBeCloseTo(4_050_000, 6);
    expect(r.intensityGPerMj).toBeCloseTo(91.7442, 4);
    expect(r.targetGPerMj).toBeCloseTo(89.3368, 10);
    expect(r.complianceBalanceT).toBeCloseTo(-9.75, 2);
    expect(r.penaltyEur).toBeCloseTo(6220.9, 1);
    expect(r.penaltyUsd).toBeCloseTo(r.penaltyEur * 1.08, 9);
  });
  it("half that at coverage 0.5", () => {
    const full = fuelEuCost({ fuelMt: HFO_100, coverage: 1, year: 2026, eurUsd: 1.08 });
    const half = fuelEuCost({ fuelMt: HFO_100, coverage: 0.5, year: 2026, eurUsd: 1.08 });
    expect(half.energyMj).toBeCloseTo(full.energyMj / 2, 6);
    expect(half.intensityGPerMj).toBeCloseTo(full.intensityGPerMj, 12);
    expect(half.complianceBalanceT).toBeCloseTo(full.complianceBalanceT / 2, 9);
    expect(half.penaltyEur).toBeCloseTo(full.penaltyEur / 2, 9);
  });
  it("mixed fuel is energy-weighted: 10 mt MGO + 10 mt HFO", () => {
    // E_MGO = 10e6 × 0.0427 = 427 000 MJ; E_HFO = 10e6 × 0.0405 = 405 000 MJ; E = 832 000
    // I = (427 000 × 90.7674 + 405 000 × 91.7442) / 832 000 ≈ 91.2429
    const r = fuelEuCost({
      fuelMt: { LSMGO: 10, VLSFO: 10, HSFO: 0 },
      coverage: 1,
      year: 2026,
      eurUsd: 1,
    });
    expect(r.energyMj).toBeCloseTo(832_000, 6);
    const i =
      (427_000 * wtwIntensityGPerMj("LSMGO") + 405_000 * wtwIntensityGPerMj("HSFO")) / 832_000;
    expect(r.intensityGPerMj).toBeCloseTo(i, 9);
    expect(r.intensityGPerMj).toBeCloseTo(91.2429, 3);
    // balance = (89.3368 − 91.2429) × 832 000 g ≈ −1.5859 t
    expect(r.complianceBalanceT).toBeCloseTo(((89.3368 - i) * 832_000) / 1e6, 9);
    expect(r.penaltyEur).toBeCloseTo((((i - 89.3368) * 832_000) / (i * 41_000)) * 2_400, 6);
  });
  it("no in-scope energy costs nothing", () => {
    const zero = {
      energyMj: 0,
      intensityGPerMj: 0,
      complianceBalanceT: 0,
      penaltyEur: 0,
      penaltyUsd: 0,
    };
    expect(fuelEuCost({ fuelMt: HFO_100, coverage: 0, year: 2026, eurUsd: 1.08 })).toEqual({
      ...zero,
      targetGPerMj: fuelEuTargetGPerMj(2026),
    });
    expect(
      fuelEuCost({ fuelMt: { LSMGO: 0, VLSFO: 0, HSFO: 0 }, coverage: 1, year: 2026, eurUsd: 1 }),
    ).toEqual({ ...zero, targetGPerMj: fuelEuTargetGPerMj(2026) });
  });
  it("before 2025 there is no limit, so no balance and no penalty", () => {
    const r = fuelEuCost({ fuelMt: HFO_100, coverage: 1, year: 2024, eurUsd: 1.08 });
    expect(r.targetGPerMj).toBeNull();
    expect(r.energyMj).toBeCloseTo(4_050_000, 6);
    expect(r.complianceBalanceT).toBe(0);
    expect(r.penaltyEur).toBe(0);
    expect(r.penaltyUsd).toBe(0);
  });
  it("rejects an invalid input", () => {
    expect(() =>
      fuelEuCost({ fuelMt: HFO_100, coverage: 0.7 as never, year: 2026, eurUsd: 1 }),
    ).toThrow();
    expect(() =>
      fuelEuCost({ fuelMt: { ...HFO_100, HSFO: -1 }, coverage: 1, year: 2026, eurUsd: 1 }),
    ).toThrow();
  });
  it("is deterministic", () => {
    const input = {
      fuelMt: { LSMGO: 12.3, VLSFO: 4.5, HSFO: 6.7 },
      coverage: 0.5 as const,
      year: 2026,
      eurUsd: 1.08,
    };
    expect(JSON.stringify(fuelEuCost(input))).toBe(JSON.stringify(fuelEuCost(input)));
  });
});
