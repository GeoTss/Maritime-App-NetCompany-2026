import { describe, expect, it } from "vitest";
import {
  evidenceSupports,
  normaliseCurrency,
  normaliseGrade,
  normaliseMassUnit,
  normalisePerUnit,
  parseAmount,
} from "./normalise.js";

describe("parseAmount", () => {
  const cases: [string | null, number | null][] = [
    ["738", 738],
    ["  738  ", 738],
    ["USD 738", 738],
    ["$738.50", 738.5],
    ["738 USD/mt", 738],
    ["9,000", 9000],
    ["9,000 mt", 9000],
    ["1,234.5", 1234.5],
    ["1,234,567", 1234567],
    ["0", 0],
    ["738,", 738],
    // ranges and alternatives
    ["300/350", null],
    ["300-350", null],
    ["300 - 350", null],
    ["300 to 350", null],
    ["300 or 350", null],
    ["300 TO 350", null],
    // approximations
    ["abt 300", null],
    ["about 300", null],
    ["approx 300", null],
    ["approx. 300", null],
    ["~300", null],
    // decimal comma / ambiguous grouping
    ["1 234,5", null],
    ["1234,5", null],
    ["1,5", null],
    ["1.234,5", null],
    ["1 234", null],
    // no number
    ["", null],
    ["   ", null],
    ["TBA", null],
    [null as unknown as string, null],
  ];
  it.each(cases)("parseAmount(%j) = %j", (input, expected) => {
    expect(parseAmount(input as string)).toBe(expected);
  });
  it("is deterministic", () => {
    expect(parseAmount("1,234.5")).toBe(parseAmount("1,234.5"));
  });
});

describe("normaliseCurrency", () => {
  const cases: [string | null, "USD" | "EUR" | null][] = [
    ["USD", "USD"],
    ["usd", "USD"],
    ["US$", "USD"],
    ["$", "USD"],
    ["U.S. dollars", "USD"],
    [" us dollars ", "USD"],
    ["EUR", "EUR"],
    ["€", "EUR"],
    ["eur", "EUR"],
    ["euro", "EUR"],
    ["Euros", "EUR"],
    ["GBP", null],
    ["", null],
    [null, null],
  ];
  it.each(cases)("normaliseCurrency(%j) = %j", (input, expected) => {
    expect(normaliseCurrency(input)).toBe(expected);
  });
});

describe("normaliseMassUnit", () => {
  const cases: [string | null, "mt" | null][] = [
    ["mt", "mt"],
    ["MT", "mt"],
    ["mts", "mt"],
    ["t", "mt"],
    ["tonnes", "mt"],
    ["metric tons", "mt"],
    ["Metric Tonnes", "mt"],
    [" mt ", "mt"],
    ["m3", null],
    ["cbm", null],
    ["litres", null],
    ["", null],
    [null, null],
  ];
  it.each(cases)("normaliseMassUnit(%j) = %j", (input, expected) => {
    expect(normaliseMassUnit(input)).toBe(expected);
  });
});

describe("normalisePerUnit", () => {
  const cases: [string | null, "per_mt" | "lump_sum" | null][] = [
    ["mt", "per_mt"],
    ["pmt", "per_mt"],
    ["PMT", "per_mt"],
    ["per mt", "per_mt"],
    ["/mt", "per_mt"],
    ["per metric ton", "per_mt"],
    ["lump sum", "lump_sum"],
    ["LS", "lump_sum"],
    ["lumpsum", "lump_sum"],
    ["per barrel", null],
    ["", null],
    [null, null],
  ];
  it.each(cases)("normalisePerUnit(%j) = %j", (input, expected) => {
    expect(normalisePerUnit(input)).toBe(expected);
  });
});

describe("normaliseGrade", () => {
  const cases: [string | null, "LSMGO" | "VLSFO" | "HSFO" | null][] = [
    ["LSMGO", "LSMGO"],
    ["lsmgo", "LSMGO"],
    ["MGO", "LSMGO"],
    ["MGO 0.1%", "LSMGO"],
    ["DMA with 0.1", "LSMGO"],
    ["DMA 0.1% S", "LSMGO"],
    ["VLSFO", "VLSFO"],
    ["vlsfo 0.5%", "VLSFO"],
    ["0.5% fuel oil", "VLSFO"],
    ["0.50% S bunkers", "VLSFO"],
    ["HSFO", "HSFO"],
    ["IFO380", "HSFO"],
    ["IFO 380", "HSFO"],
    ["RMG380", "HSFO"],
    ["3.5%", "HSFO"],
    ["3.5% sulphur fuel oil", "HSFO"],
    // ambiguous: more than one family
    ["VLSFO / HSFO", null],
    ["MGO or VLSFO", null],
    // not a grade
    ["DMA", null],
    ["10.5% fuel", null],
    ["", null],
    [null, null],
  ];
  it.each(cases)("normaliseGrade(%j) = %j", (input, expected) => {
    expect(normaliseGrade(input)).toBe(expected);
  });
});

describe("evidenceSupports", () => {
  const source = "Hi,\nOur offer: VLSFO 0.5%   USD 612.50 / MT\nBasis Rotterdam.";
  it("accepts evidence that is a substring and contains asWritten", () => {
    expect(evidenceSupports(source, "VLSFO 0.5% USD 612.50 / MT", "612.50")).toBe(true);
  });
  it("collapses whitespace and case", () => {
    expect(evidenceSupports(source, "vlsfo 0.5%\n usd 612.50 / mt", "USD 612.50")).toBe(true);
  });
  it("accepts evidence without asWritten", () => {
    expect(evidenceSupports(source, "Basis Rotterdam.", null)).toBe(true);
  });
  it("rejects evidence not in source", () => {
    expect(evidenceSupports(source, "VLSFO USD 700", "700")).toBe(false);
  });
  it("rejects asWritten not inside evidence", () => {
    expect(evidenceSupports(source, "Basis Rotterdam.", "612.50")).toBe(false);
  });
  it("rejects null or empty evidence", () => {
    expect(evidenceSupports(source, null, "612.50")).toBe(false);
    expect(evidenceSupports(source, "", null)).toBe(false);
    expect(evidenceSupports(source, "   ", null)).toBe(false);
  });
  it("is deterministic", () => {
    const a = evidenceSupports(source, "Basis Rotterdam.", null);
    expect(evidenceSupports(source, "Basis Rotterdam.", null)).toBe(a);
  });
});
