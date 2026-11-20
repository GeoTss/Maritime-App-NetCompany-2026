import { describe, expect, it } from "vitest";
import {
  CII_RATING_BOUNDARIES,
  CII_REFERENCE_PARAMS,
  ciiRating,
  co2Tonnes,
  etsCost,
  etsCoverage,
  etsPhaseIn,
} from "./index.js";

describe("co2Tonnes", () => {
  it("sums grade tonnes × Cf", () => {
    // 10 × 3.206 + 20 × 3.114 + 0 = 32.06 + 62.28 = 94.34
    expect(co2Tonnes({ LSMGO: 10, VLSFO: 20, HSFO: 0 })).toBeCloseTo(94.34, 10);
  });
  it("is 0 for empty tanks", () => {
    expect(co2Tonnes({ LSMGO: 0, VLSFO: 0, HSFO: 0 })).toBe(0);
  });
});

describe("etsCoverage", () => {
  it("maps EU membership of both ends", () => {
    expect(etsCoverage(true, true)).toBe(1);
    expect(etsCoverage(true, false)).toBe(0.5);
    expect(etsCoverage(false, true)).toBe(0.5);
    expect(etsCoverage(false, false)).toBe(0);
  });
});

describe("etsPhaseIn", () => {
  it("is 0 up to 2023, tabled 2024-2026, 1 afterwards", () => {
    expect(etsPhaseIn(2020)).toBe(0);
    expect(etsPhaseIn(2023)).toBe(0);
    expect(etsPhaseIn(2024)).toBe(0.4);
    expect(etsPhaseIn(2025)).toBe(0.7);
    expect(etsPhaseIn(2026)).toBe(1);
    expect(etsPhaseIn(2030)).toBe(1);
  });
});

describe("etsCost", () => {
  const base = { co2T: 100, coverage: 0.5, euaPriceEur: 80, eurUsd: 1.1 };
  it("2025: 100 × 0.5 × 0.7 = 35 t; × 80 = 2800 EUR; × 1.1 = 3080 USD", () => {
    const r = etsCost({ ...base, year: 2025 });
    expect(r.coveredCo2T).toBeCloseTo(35, 10);
    expect(r.phaseIn).toBe(0.7);
    expect(r.costEur).toBeCloseTo(2800, 8);
    expect(r.costUsd).toBeCloseTo(3080, 8);
  });
  it("2026: 100 × 0.5 × 1 = 50 t; 4000 EUR; 4400 USD", () => {
    const r = etsCost({ ...base, year: 2026 });
    expect(r.coveredCo2T).toBeCloseTo(50, 10);
    expect(r.costEur).toBeCloseTo(4000, 8);
    expect(r.costUsd).toBeCloseTo(4400, 8);
  });
  it("2023 is not covered", () => {
    const r = etsCost({ ...base, year: 2023 });
    expect(r).toEqual({ coveredCo2T: 0, phaseIn: 0, costEur: 0, costUsd: 0 });
  });
  it("parses its input: a negative co2T or a NaN year is rejected", () => {
    expect(() => etsCost({ ...base, co2T: -1, year: 2025 })).toThrow();
    expect(() => etsCost({ ...base, year: Number.NaN })).toThrow();
  });
  it("is deterministic", () => {
    const i = { ...base, year: 2025 };
    expect(etsCost(i)).toEqual(etsCost(i));
  });
});

describe("ciiRating", () => {
  const bulk = {
    shipType: "bulk_carrier",
    dwt: 58000,
    co2T: 15000,
    distanceNm: 70000,
    year: 2026,
  } as const;

  it("bulk carrier 58 000 dwt in 2026 is rated A", () => {
    // attained = 15000 × 1e6 / (58000 × 70000) = 1.5e10 / 4.06e9 = 3.6946
    // reference = 4745 × 58000^-0.622 ≈ 5.1687; required = reference × (1 − 0.11) ≈ 4.6002
    // ratio = 3.6946 / 4.6002 ≈ 0.8031 < 0.86 → A
    const r = ciiRating(bulk);
    expect(r.attained).toBeCloseTo(3.6946, 3);
    expect(r.reference).toBeCloseTo(5.1687, 3);
    expect(r.required).toBeCloseTo(4.6002, 3);
    expect(r.ratio).toBeCloseTo(0.8031, 3);
    expect(r.rating).toBe("A");
  });

  it("uses the 279 000 DWT cap for the reference line only", () => {
    const r = ciiRating({ ...bulk, dwt: 300000, co2T: 30000 });
    expect(r.reference).toBeCloseTo(4745 * 279000 ** -0.622, 12);
    // attained = 30000 × 1e6 / (300000 × 70000) = 3e10 / 2.1e10
    expect(r.attained).toBeCloseTo(3e10 / 2.1e10, 12);
  });

  it("does not cap tankers or containers", () => {
    const t = ciiRating({ shipType: "tanker", dwt: 300000, co2T: 1, distanceNm: 1, year: 2026 });
    expect(t.reference).toBeCloseTo(5247 * 300000 ** -0.61, 12);
    const c = ciiRating({ shipType: "container", dwt: 100000, co2T: 1, distanceNm: 1, year: 2026 });
    expect(c.reference).toBeCloseTo(1984 * 100000 ** -0.489, 12);
  });

  it("applies Z per year; years after 2026 stay at 11 %", () => {
    const ref = (y: number) => ciiRating({ ...bulk, year: y });
    expect(ref(2023).required / ref(2023).reference).toBeCloseTo(0.95, 12);
    expect(ref(2024).required / ref(2024).reference).toBeCloseTo(0.93, 12);
    expect(ref(2025).required / ref(2025).reference).toBeCloseTo(0.91, 12);
    expect(ref(2028).required / ref(2028).reference).toBeCloseTo(0.89, 12);
  });

  it("classifies on the boundaries: ratio at d1 is B, at d4 is E, just below is the better letter", () => {
    const dwt = 50000;
    const distanceNm = 10000;
    const probe = (ratio: number) => {
      const { required } = ciiRating({
        shipType: "bulk_carrier",
        dwt,
        co2T: 1,
        distanceNm,
        year: 2026,
      });
      const co2T = (ratio * required * dwt * distanceNm) / 1e6;
      return ciiRating({ shipType: "bulk_carrier", dwt, co2T, distanceNm, year: 2026 });
    };
    const [d1, d2, d3, d4] = CII_RATING_BOUNDARIES.bulk_carrier;
    // Back-solving co2T from a ratio loses an ulp, so "at the boundary" is d × (1 + 1e-12):
    // the first representable side of the boundary, which must fall in the worse class (strict <).
    const at = (d: number) => d * (1 + 1e-12);
    expect(probe(at(d1)).rating).toBe("B");
    expect(probe(d1 - 1e-6).rating).toBe("A");
    expect(probe(at(d2)).rating).toBe("C");
    expect(probe(at(d3)).rating).toBe("D");
    expect(probe(at(d4)).rating).toBe("E");
    expect(probe(d4 - 1e-6).rating).toBe("D");
    expect(probe(at(d4)).ratio).toBeCloseTo(d4, 9);
  });

  it("zero co2 is A", () => {
    expect(ciiRating({ ...bulk, co2T: 0 }).rating).toBe("A");
  });

  it("parses its input: a negative co2T or a NaN year is rejected", () => {
    expect(() => ciiRating({ ...bulk, co2T: -1 })).toThrow();
    expect(() => ciiRating({ ...bulk, year: Number.NaN })).toThrow();
  });
  it("throws RangeError for zero distance or zero dwt", () => {
    expect(() => ciiRating({ ...bulk, distanceNm: 0 })).toThrow(RangeError);
    expect(() => ciiRating({ ...bulk, dwt: 0 })).toThrow(RangeError);
  });

  it("is deterministic", () => {
    expect(ciiRating(bulk)).toEqual(ciiRating(bulk));
  });

  it("has parameters for every ship type", () => {
    expect(Object.keys(CII_REFERENCE_PARAMS).sort()).toEqual(
      Object.keys(CII_RATING_BOUNDARIES).sort(),
    );
  });
});
