import { describe, expect, it } from "vitest";
import { PRICE_BAND_FRACTION, priceWithinBand, toUsd } from "./price-band.js";

describe("toUsd", () => {
  it("multiplies by the USD-per-unit rate (USD is rate 1)", () => {
    expect(toUsd(738, 1)).toBe(738);
    // EUR 690/mt at EURUSD 1.08 = USD 745.2/mt (hand-computed).
    expect(toUsd(690, 1.08)).toBeCloseTo(745.2, 10);
  });

  it("rejects a non-positive or non-finite rate and a non-finite amount", () => {
    expect(() => toUsd(690, 0)).toThrow(RangeError);
    expect(() => toUsd(690, -1.08)).toThrow(RangeError);
    expect(() => toUsd(690, Number.NaN)).toThrow(RangeError);
    expect(() => toUsd(Number.POSITIVE_INFINITY, 1)).toThrow(RangeError);
  });
});

describe("priceWithinBand", () => {
  it("defaults to a ±15 % band", () => {
    expect(PRICE_BAND_FRACTION).toBe(0.15);
  });

  it("reports the deviation from the market as a fraction and whether it is inside the band", () => {
    // 738 vs 760: |738 - 760| / 760 = 22 / 760 = 0.028947… (hand-computed).
    const r = priceWithinBand(738, 760);
    expect(r.withinBand).toBe(true);
    expect(r.deviationFraction).toBeCloseTo(22 / 760, 12);
  });

  it("includes both band edges and excludes anything beyond", () => {
    expect(priceWithinBand(115, 100).withinBand).toBe(true);
    expect(priceWithinBand(85, 100).withinBand).toBe(true);
    expect(priceWithinBand(115.01, 100).withinBand).toBe(false);
    expect(priceWithinBand(84.99, 100).withinBand).toBe(false);
    // Order-of-magnitude transcription errors.
    expect(priceWithinBand(73.8, 760).withinBand).toBe(false);
    expect(priceWithinBand(7380, 760).withinBand).toBe(false);
  });

  it("takes an explicit band fraction", () => {
    expect(priceWithinBand(105, 100, 0.05).withinBand).toBe(true);
    expect(priceWithinBand(106, 100, 0.05).withinBand).toBe(false);
  });

  it("is deterministic", () => {
    expect(priceWithinBand(712, 741.3)).toEqual(priceWithinBand(712, 741.3));
  });

  it("rejects a non-positive market price, a negative fraction and non-finite inputs", () => {
    expect(() => priceWithinBand(738, 0)).toThrow(RangeError);
    expect(() => priceWithinBand(738, -760)).toThrow(RangeError);
    expect(() => priceWithinBand(738, 760, -0.1)).toThrow(RangeError);
    expect(() => priceWithinBand(Number.NaN, 760)).toThrow(RangeError);
  });
});
