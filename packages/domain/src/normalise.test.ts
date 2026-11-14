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
    ["USD 612 - USD 650", null],
    ["612 USD or 650 USD", null],
    ["300 usd/mt - 350 usd/mt", null],
    ["300 up to 350", null],
    ["300 and 350", null],
    ["9.000 mt", null],
    ["1.234", null],
    ["1.234.567", null],
    ["$.50", null],
    ["-300", null],
    ["USD -300", null],
    ["0.5", 0.5],
    ["612.50 usd/mt basis rotterdam", 612.5],
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
    ["0.55%", null],
    ["0.55% fuel oil", null],
    ["DMA 0.15", null],
    ["DMA 0.1", "LSMGO"],
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
  it("rejects blank non-null asWritten", () => {
    expect(evidenceSupports(source, "Basis Rotterdam.", "")).toBe(false);
    expect(evidenceSupports(source, "Basis Rotterdam.", "   ")).toBe(false);
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

describe("evidenceSupports token boundaries", () => {
  const src = "Quantity: 300 mt";
  const rows: [string, string, string, boolean][] = [
    ["Quantity: 300 mt", "30", "partial number", false],
    ["Quantity: 300 mt", "300", "whole number", true],
    ["Quantity: 300 mt", "300 mt", "number and unit", true],
    ["Quantity: 300 mt", "Quantity", "leading word", true],
    ["Quantity: 300 mt", "uantity", "inside a word", false],
    ["Quantity: 300 mt", "m", "single letter inside word", false],
    ["Price US$738 pmt", "$738", "symbol edge is not alphanumeric", true],
    ["Price US$738 pmt", "738", "digit after symbol", true],
    ["Price USD 738.50 pmt", "738", "decimal tail", false],
    ["Price USD 738.50 pmt", "738.50", "full decimal", true],
    ["Qty 2,500 mt", "500", "thousands group tail", false],
    ["Qty 2,500 mt", "2,500", "full grouped number", true],
    ["Qty 2,500 mt", "2", "head of grouped number", false],
    ["Qty 2.500 mt", "500", "dot-group tail", false],
    ["Sentence ends 300. Next", "300", "full stop then space is fine", true],
    ["Qty 300, then 30 mt", "30", "later standalone occurrence", true],
    ["Qty 300 and 30.", "30", "later occurrence at end", true],
    ["Qty 300 mt", "300 MT", "case folded", true],
    ["Qty 300\n  mt", "300 mt", "whitespace folded", true],
    ["Rate USD612.50", "612.50", "letters glued before a digit edge", false],
    ["Rate USD612.50", "USD", "letters before digit", false],
  ];
  it.each(rows)("%s | %s (%s) -> %s", (evidence, asWritten, _why, expected) => {
    expect(evidenceSupports(evidence, evidence, asWritten)).toBe(expected);
  });
  it("still requires the evidence to be in the source", () => {
    expect(evidenceSupports("other text", src, "300")).toBe(false);
  });
});
