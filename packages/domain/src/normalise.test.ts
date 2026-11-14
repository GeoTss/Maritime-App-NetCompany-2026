import { describe, expect, it } from "vitest";
import {
  evidenceSupports,
  hedgedInSource,
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

  // Round 3: a hedge marker inside the as-written text itself means it is not one amount, so a
  // model that keeps the literal span ("min 100 mt") but writes 100 cannot store it.
  it.each([
    "min 100 mt",
    "min. 100 mt",
    "minimum 100 mt",
    "max 100 mt",
    "max. 100 mt",
    "maximum 100 mt",
    "up to 100 mt",
    "upto 100 mt",
    "at least 100 mt",
    "not exceeding 100 mt",
    "around 100 mt",
    "roughly 100 mt",
    "approx. 100 mt",
    "approximately 100 mt",
    "appr. 100 mt",
    "aprox. 100 mt",
    "circa 100 mt",
    "ca 100 mt",
    "ca. 100 mt",
    "c. 100 mt",
    "est. 100 mt",
    "estimated 100 mt",
    "indicative USD 683 per mt",
    "indicatively USD 683 per mt",
    "100 mt or thereabouts",
    "100 mt MOLOO",
    "moloo 100 mt",
    "100 mt more or less",
    "± 100 mt",
    "±100 mt",
    "+/- 100 mt",
    "+- 100 mt",
    "100 mt plus/minus 5%",
    "≈100 mt",
    "~100 mt",
    "100 mt min",
    "100 mt max",
    "around USD 683 per mt",
    "max USD 683 per mt",
    "USD 683 per mt max",
    "MIN 100 MT",
    "100+ mt",
    "USD 683+ per mt",
  ])("parseAmount(%j) = null: a hedge marker in the as-written text", (written) => {
    expect(parseAmount(written)).toBeNull();
  });

  it.each([
    ["Maxwell 100 mt", 100],
    ["Minerva Fuels 100 mt", 100],
    ["Cargo 100 mt", 100],
    ["Best offer USD 683 per mt", 683],
    ["Kestrel Inc. USD 683", 683],
    ["USD 683 per mt", 683],
    ["100 mt", 100],
  ])("parseAmount(%j) = %j: marker words are whole words", (written, value) => {
    expect(parseAmount(written)).toBe(value);
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

describe("hedgedInSource", () => {
  /** The line sits in a small email; the evidence is the whole line unless a span is given. */
  const source = (line: string) => `Dear all,\n${line}\nBest regards`;
  const hedged = (line: string, asWritten: string, evidence = line) =>
    hedgedInSource(source(line), evidence, asWritten);

  it.each([
    // a range or alternative: another amount joined by /, -, –, —, to, or (either side)
    ["Quantity: 100 mt / 150 mt", "100 mt"],
    ["Quantity: 100 mt / 150 mt", "150 mt"],
    ["Quantity: 100 mt or 150 mt", "100 mt"],
    ["Quantity: 280/320 mt", "280"],
    ["Quantity: 280/320 mt", "320 mt"],
    ["Quantity: 280-320 mt", "280"],
    ["Quantity: 280 – 320 mt", "280"],
    ["Quantity: 280 — 320 mt", "320 mt"],
    ["Quantity: 280 to 320 mt", "280"],
    ["Quantity: 100mt-150mt", "100mt"],
    ["Quantity: between 100 and 150 mt", "100"],
    ["Quantity: between 100 and 150 mt", "150 mt"],
    ["Price: USD 683 per mt or USD 690 per mt", "USD 683 per mt"],
    ["Price: USD 683 per mt or USD 690 per mt", "USD 690 per mt"],
    ["Price: USD 683-690 per mt", "USD 683"],
    ["Price: USD 683 / USD 690 per mt", "USD 683"],
    // a marker right before the number or its currency
    ["Quantity: abt 100 mt", "100 mt"],
    ["Quantity: about 100 mt", "100 mt"],
    ["Quantity: approx. 100 mt", "100 mt"],
    ["Quantity: approximately 100 mt", "100 mt"],
    ["Quantity: around 100 mt", "100 mt"],
    ["Quantity: roughly 100 mt", "100 mt"],
    ["Quantity: circa 100 mt", "100 mt"],
    ["Quantity: ca. 100 mt", "100 mt"],
    ["Quantity: c. 100 mt", "100 mt"],
    ["Quantity: ~100 mt", "100 mt"],
    ["Quantity: ≈100 mt", "100 mt"],
    ["Quantity: min. 100 mt", "100 mt"],
    ["Quantity: minimum 100 mt", "100 mt"],
    ["Quantity: max 100 mt", "100 mt"],
    ["Quantity: maximum 100 mt", "100 mt"],
    ["Quantity: at least 100 mt", "100 mt"],
    ["Quantity: up to 100 mt", "100 mt"],
    ["Quantity: MOLOO 100 mt", "100 mt"],
    ["Quantity: more or less 100 mt", "100 mt"],
    ["Price: around USD 683 per mt", "USD 683 per mt"],
    ["Price: abt USD 683 per mt", "683"],
    // a marker right after the number and unit, or a tolerance within 12 characters after
    ["Quantity: 100 mt approx.", "100 mt"],
    ["Quantity: 100 mt max", "100 mt"],
    ["Quantity: 100 mt min", "100 mt"],
    ["Quantity: 100 mt MOLOO", "100 mt"],
    ["Quantity: 100 mt more or less", "100 mt"],
    ["Quantity: 100 mt +/- 5%", "100 mt"],
    ["Quantity: 100 mt ±10%", "100 mt"],
    ["Quantity: 100 mt plus/minus 10%", "100 mt"],
    ["Quantity: 100 mt, 10% more or less at Seller's option", "100 mt"],
    ["Quantity: 300 mt LSMGO +/- 5%", "300 mt"],
    // case and whitespace folded
    ["QUANTITY: ABT   100 MT", "100 mt"],
    // round 3: tolerances and more markers before the amount
    ["Quantity: +/- 300 mt", "300 mt"],
    ["Quantity: ± 300 mt", "300 mt"],
    ["Quantity: +/-300 mt", "300 mt"],
    ["Qty: ±300 mt", "300 mt"],
    ["Quantity: plus/minus 300 mt", "300 mt"],
    ["Price: +/- USD 683 per mt", "USD 683 per mt"],
    ["Quantity: upto 300 mt", "300 mt"],
    ["Quantity: est. 300 mt", "300 mt"],
    ["Quantity: estimated 300 mt", "300 mt"],
    ["Quantity: appr. 300 mt", "300 mt"],
    ["Quantity: aprox. 300 mt", "300 mt"],
    ["Quantity: ca 300 mt", "300 mt"],
    ["Quantity: abt. 300 mt", "300 mt"],
    ["Quantity: not exceeding 300 mt", "300 mt"],
    ["Quantity: some 300 mt", "300 mt"],
    ["Price: indicatively USD 683 per mt", "USD 683 per mt"],
    // a marker on the field label ("Approximate quantity: 300 mt")
    ["Approximate quantity: 300 mt", "300 mt"],
    ["Approx quantity 300 mt", "300 mt"],
    ["Approx. quantity: 300 mt", "300 mt"],
    ["Maximum quantity: 300 mt", "300 mt"],
    ["Minimum quantity 300 mt", "300 mt"],
    ["Min. quantity: 300 mt", "300 mt"],
    ["Qty abt: 300 mt", "300 mt"],
    ["Quantity (approx.): 300 mt", "300 mt"],
    ["Quantity (abt): 300 mt", "300 mt"],
    ["Quantity required (approx.): 300 mt", "300 mt"],
    ["Approx. price: USD 683 per mt", "USD 683 per mt"],
    ["Indicative price: USD 683 per mt", "USD 683 per mt"],
    ["Indicative price (approx.): USD 683 per mt", "USD 683 per mt"],
    // after the amount
    ["Quantity: 300 mt or thereabouts", "300 mt"],
    ["Quantity: 300 mt (abt)", "300 mt"],
    ["Quantity: 300 mt +/-", "300 mt"],
    ["Quantity: 300 mts appr.", "300 mts"],
    ["Quantity: 300 mt approximately", "300 mt"],
    ["Quantity: 300mt abt", "300mt"],
    ["Quantity: 300 mt, 5 pct more or less", "300 mt"],
    ["Quantity: 300 mt max.", "300 mt"],
    ["Quantity: 100+ mt", "100"],
    ["Quantity: 100 mt+", "100 mt"],
    // a tolerance anywhere in the parenthesis right after the amount
    ["Quantity: 300 mt (Seller's option +/- 5%)", "300 mt"],
    ["Quantity: 300 mt (+/- 5% in Sellers option)", "300 mt"],
    ["Price: USD 683 per mt (Platts-linked, +/- daily)", "USD 683 per mt"],
    // a shorthand range: the second amount bare
    ["Price: USD 683/690", "USD 683"],
    ["Quantity: 100/150", "100"],
  ])("hedged: %s | %s", (line, asWritten) => {
    expect(hedged(line, asWritten)).toBe(true);
  });

  it.each([
    ["Quantity: 100 mt", "100 mt"],
    ["Quantity: 100 mt VLSFO ISO 8217-2017", "100 mt"],
    ["VLSFO ISO 8217-2017 100 mt", "100 mt"],
    ["Price: USD 683 per mt (ISO 8217-2017)", "USD 683 per mt"],
    ["Quantity: 100 mt (max tank capacity 400 mt)", "100 mt"],
    ["Quantity: 100 mt, min. lifting 50 mt", "100 mt"],
    ["LSMGO 0.10%S 100 mt @ USD 683/mt 22-24 Nov", "USD 683/mt"],
    ["LSMGO 0.10%S 100 mt @ USD 683/mt 22-24 Nov", "100 mt"],
    ["Price: USD 683 per mt, delivery 22-24 Nov", "USD 683 per mt"],
    ["Price: USD 683 per mt, payment 30 days", "USD 683 per mt"],
    ["Qty: 100 mt to MV Scheldt Express", "100 mt"],
    ["Quantity: 300 mt LSMGO (VLSFO up to 500 mt)", "300 mt"],
    ["LSMGO 0.1% - 300 mt", "300 mt"],
    ["Contact admin 300 mt", "300 mt"],
    ["Maximal Fuels: 300 mt", "300 mt"],
    ["Quantity: 1,200 mt VLSFO 0.5%", "1,200 mt"],
    ["Price: EUR 690 / mt", "EUR 690 / mt"],
    ["Price: USD 712 PMT", "USD 712 PMT"],
    // round 3: a slash or dash between a quantity and a price, or before a non-amount, separates
    // fields; a range needs two amounts of the same kind
    ["LSMGO 0.1% / 100 mt / USD 683 pmt", "100 mt"],
    ["LSMGO 0.1% / 100 mt / USD 683 pmt", "USD 683 pmt"],
    ["LSMGO - 100 mt - USD 683/mt", "100 mt"],
    ["LSMGO - 100 mt - USD 683/mt", "USD 683/mt"],
    ["100 mt LSMGO @ USD 683 pmt / 22-24 Nov", "USD 683 pmt"],
    ["LSMGO 100 mt @ USD 683 pmt - 22/24 Nov", "USD 683 pmt"],
    ["Scheldt Express / Antwerp / LSMGO / 100 mt / USD 683", "100 mt"],
    ["Scheldt Express / Antwerp / LSMGO / 100 mt / USD 683", "USD 683"],
    ["Price: USD 683 per mt - 30 days credit", "USD 683 per mt"],
    ["LSMGO: 100 mt - USD 683 pmt - 22/24 Nov", "100 mt"],
    ["LSMGO: 100 mt - USD 683 pmt - 22/24 Nov", "USD 683 pmt"],
    ["Qty 100 mt / Price USD 683 pmt", "100 mt"],
    ["Qty 100 mt / Price USD 683 pmt", "USD 683 pmt"],
    ["LSMGO 100 MT / VLSFO 500 MT", "100 MT"],
    ["LSMGO 100 mt @ USD 683 pmt, 2 / 3 days notice", "USD 683 pmt"],
    ["VLSFO 500 mt / LSMGO 100 mt", "500 mt"],
    ["VLSFO 500 mt / LSMGO 100 mt", "100 mt"],
    ["VLSFO USD 612 / LSMGO USD 683 pmt", "USD 612"],
    ["LSMGO: 100 mt at USD 683 per mt, min. lifting 50 mt", "100 mt"],
    ["LSMGO 100 mt min. lifting 50 mt", "100 mt"],
    ["LSMGO 100 mt max tank capacity 400 mt", "100 mt"],
    [
      "Vessel / Port / Grade / Qty / Price: Scheldt Express / Antwerp / LSMGO / 100 mt / USD 683",
      "100 mt",
    ],
    [
      "Vessel / Port / Grade / Qty / Price: Scheldt Express / Antwerp / LSMGO / 100 mt / USD 683",
      "USD 683",
    ],
    ["LSMGO 100 mt to be delivered 22-24 Nov", "100 mt"],
    ["LSMGO 100 mt, USD 683 pmt, delivery 22 - 24 Nov", "USD 683 pmt"],
    ["Price: USD 683 pmt or as per Platts", "USD 683 pmt"],
    ["Maxwell Fuels: 300 mt", "300 mt"],
  ])("clean: %s | %s", (line, asWritten) => {
    expect(hedged(line, asWritten)).toBe(false);
  });

  it("reads the whole source line, not the model's evidence span", () => {
    // The model cites only "100 mt"; the line it sits on says "abt 100 mt".
    expect(hedged("Quantity: abt 100 mt", "100 mt", "100 mt")).toBe(true);
    expect(hedged("Quantity: 100-150 mt", "150 mt", "150 mt")).toBe(true);
    expect(hedged("Quantity: 100/150 mt", "150 mt", "150 mt")).toBe(true);
  });

  it("an evidence string spanning lines reads all of them; a hedge on another line does not count", () => {
    const src = "Quantity: 100 mt\n/ 150 mt\nVLSFO: abt 200 mt";
    expect(hedgedInSource(src, "Quantity: 100 mt / 150 mt", "100 mt")).toBe(true);
    expect(hedgedInSource(src, "Quantity: 100 mt", "100 mt")).toBe(false);
  });

  it("checks the occurrence of the amount inside the evidence, and every place the evidence occurs", () => {
    expect(hedgedInSource("300 mt now; earlier abt 300 mt", "earlier abt 300 mt", "300 mt")).toBe(
      true,
    );
    expect(hedgedInSource("Quantity: 2,300 mt, abt", "Quantity: 2,300 mt, abt", "300 mt")).toBe(
      false,
    );
    const twice = "Quantity: 100 mt\nRepeat: abt 100 mt";
    expect(hedgedInSource(twice, "100 mt", "100 mt")).toBe(true);
  });

  it("a marker on the label line right above the amount counts (PDF and table text)", () => {
    expect(hedgedInSource("Approx. quantity\n300 mt\nPrice", "300 mt", "300 mt")).toBe(true);
    expect(hedgedInSource("Quantity (abt):\n300 mt", "300 mt", "300 mt")).toBe(true);
    expect(hedgedInSource("Quantity:\n300 mt", "300 mt", "300 mt")).toBe(false);
    // only when the amount opens its line
    expect(hedgedInSource("Approx. quantity\nLSMGO 300 mt", "LSMGO 300 mt", "300 mt")).toBe(false);
  });

  it("the field kind decides what a bare amount is ranged with", () => {
    // "100" as a quantity beside a price is a field separator; beside another quantity a range
    expect(
      hedgedInSource("LSMGO 100 / USD 683 pmt", "LSMGO 100 / USD 683 pmt", "100", "quantity"),
    ).toBe(false);
    expect(hedgedInSource("LSMGO 100 / 150 mt", "LSMGO 100 / 150 mt", "100", "quantity")).toBe(
      true,
    );
    expect(hedgedInSource("Price: 683 / 690 pmt", "Price: 683 / 690 pmt", "683", "price")).toBe(
      true,
    );
    expect(hedgedInSource("Price: 683 / 100 mt", "Price: 683 / 100 mt", "683", "price")).toBe(
      false,
    );
  });

  it("falls back to the evidence itself when it is not in the source", () => {
    expect(hedgedInSource("other text", "Quantity: abt 100 mt", "100 mt")).toBe(true);
    expect(hedgedInSource("other text", "Quantity: 100 mt", "100 mt")).toBe(false);
  });

  it("is false for null or blank input", () => {
    expect(hedgedInSource("abt 300 mt", null, "300")).toBe(false);
    expect(hedgedInSource("abt 300 mt", "abt 300 mt", null)).toBe(false);
    expect(hedgedInSource("abt 300 mt", "abt 300 mt", "  ")).toBe(false);
  });
});

// Regression suite (round 3): every hedge row the reviewers probed (rr3/hedge*.mts, rr3/inside.mts,
// and round 1's hedge cases), in the source layout each probe used, with what it must give.
describe("reviewer probe rows: hedgedInSource and parseAmount", () => {
  const inEmail = (line: string) => `From: x\nSubject: y\n\nDear all,\n${line}\nBR`;
  const hedged = (line: string, asWritten: string, evidence = line) =>
    hedgedInSource(inEmail(line), evidence, asWritten);

  // rr3/hedge-fr.mts: field separators between a quantity and a price, or before a non-amount.
  it.each([
    ["LSMGO 0.1% / 100 mt / USD 683 pmt", "100 mt"],
    ["LSMGO 0.1% / 100 mt / USD 683 pmt", "USD 683 pmt"],
    ["LSMGO - 100 mt - USD 683/mt", "100 mt"],
    ["LSMGO - 100 mt - USD 683/mt", "USD 683/mt"],
    ["100 mt LSMGO @ USD 683 pmt / 22-24 Nov", "USD 683 pmt"],
    ["LSMGO 100 mt @ USD 683 pmt - 22/24 Nov", "USD 683 pmt"],
    ["Scheldt Express / Antwerp / LSMGO / 100 mt / USD 683", "100 mt"],
    ["Scheldt Express / Antwerp / LSMGO / 100 mt / USD 683", "USD 683"],
    ["Price: USD 683 per mt - 30 days credit", "USD 683 per mt"],
    ["LSMGO 100 mt min. lifting 50 mt", "100 mt"],
    ["LSMGO 100 mt max tank capacity 400 mt", "100 mt"],
    ["LSMGO: 100 mt - USD 683 pmt - 22/24 Nov", "100 mt"],
    ["LSMGO: 100 mt - USD 683 pmt - 22/24 Nov", "USD 683 pmt"],
    ["Qty 100 mt / Price USD 683 pmt", "100 mt"],
    ["Qty 100 mt / Price USD 683 pmt", "USD 683 pmt"],
    ["LSMGO 100 MT / VLSFO 500 MT", "100 MT"],
    ["LSMGO 100 mt @ USD 683 pmt, 2 / 3 days notice", "USD 683 pmt"],
    // rr3/hedge.mts clean summary lines
    ["VLSFO 500 mt / LSMGO 100 mt", "500 mt"],
    ["VLSFO 500 mt / LSMGO 100 mt", "100 mt"],
    ["VLSFO USD 612 / LSMGO USD 683 pmt", "USD 612"],
    ["LSMGO: 100 mt at USD 683 per mt, min. lifting 50 mt", "100 mt"],
    ["LSMGO 100 mt to be delivered 22-24 Nov", "100 mt"],
    ["LSMGO 100 mt, USD 683 pmt, delivery 22 - 24 Nov", "USD 683 pmt"],
    ["Price: USD 683 pmt or as per Platts", "USD 683 pmt"],
    // round 2 required clean lines (rr/i2.mts)
    ["Price: USD 683 per mt, delivery 22-24 Nov", "USD 683 per mt"],
    ["LSMGO 0.10%S 100 mt @ USD 683/mt 22-24 Nov", "USD 683/mt"],
    ["Quantity: 100 mt (max tank capacity 400 mt)", "100 mt"],
    ["Quantity: 100 mt, min. lifting 50 mt", "100 mt"],
    ["Price: USD 683 per mt (ISO 8217-2017)", "USD 683 per mt"],
    ["Price: USD 683 per mt, payment 30 days", "USD 683 per mt"],
    ["Qty: 100 mt to MV Scheldt Express", "100 mt"],
  ])("clean: %j | %j", (line, asWritten) => {
    expect(hedged(line, asWritten)).toBe(false);
  });

  // rr3/hedge-old.mts, rr3/hedge.mts, rr/i2.mts: hedges (round 1 caught these, or should have).
  it.each([
    ["Quantity: +/- 300 mt", "300 mt"],
    ["Quantity: ± 300 mt", "300 mt"],
    ["Quantity: +/-300 mt", "300 mt"],
    ["Qty: ±300 mt", "300 mt"],
    ["Approx. quantity: 300 mt", "300 mt"],
    ["Approximate quantity: 300 mt", "300 mt"],
    ["Approx quantity 300 mt", "300 mt"],
    ["Min. quantity: 300 mt", "300 mt"],
    ["Maximum quantity: 300 mt", "300 mt"],
    ["Minimum quantity 300 mt", "300 mt"],
    ["Quantity required (approx.): 300 mt", "300 mt"],
    ["Quantity: 300 mts appr.", "300 mts"],
    ["Quantity: ca 300 mt", "300 mt"],
    ["Quantity: upto 300 mt", "300 mt"],
    ["Quantity: 300 mt (Seller's option +/- 5%)", "300 mt"],
    ["Price approx. USD 683 per mt", "USD 683 per mt"],
    ["Approx. price: USD 683 per mt", "USD 683 per mt"],
    ["Price: +/- USD 683 per mt", "USD 683 per mt"],
    ["Indicative price (approx.): USD 683 per mt", "USD 683 per mt"],
    ["Quantity: est. 300 mt", "300 mt"],
    ["Quantity: estimated 300 mt", "300 mt"],
    ["Quantity: appr. 300 mt", "300 mt"],
    ["Quantity: aprox. 300 mt", "300 mt"],
    ["Quantity: abt. 300 mt", "300 mt"],
    ["Quantity: not exceeding 300 mt", "300 mt"],
    ["Quantity: max. 300 mt", "300 mt"],
    ["Quantity: 300 mt or thereabouts", "300 mt"],
    ["Quantity: 300 mt (abt)", "300 mt"],
    ["Quantity: 300 mt +/-", "300 mt"],
    ["Quantity: some 300 mt", "300 mt"],
    ["Quantity: 300 mt (+/- 5% in Sellers option)", "300 mt"],
    ["Quantity: 300 mt, 5 pct more or less", "300 mt"],
    ["Quantity: 300 mt approximately", "300 mt"],
    ["Quantity: 300mt abt", "300mt"],
    ["Qty abt: 300 mt", "300 mt"],
    ["Quantity (approx.): 300 mt", "300 mt"],
    ["Quantity (abt): 300 mt", "300 mt"],
    // rr/i2.mts quantity and price hedges
    ["Quantity: 100 - 150 mt", "150 mt"],
    ["Quantity: around 100 mt", "100 mt"],
    ["Quantity: roughly 100 mt", "100 mt"],
    ["Quantity: c. 100 mt", "100 mt"],
    ["Quantity: 100 mt more or less", "100 mt"],
    ["Quantity: 100 mt MOLOO", "100 mt"],
    ["Quantity: 100 mt / 150 mt", "100 mt"],
    ["Quantity: 100 mt or 150 mt", "100 mt"],
    ["Quantity: at least 100 mt", "100 mt"],
    ["Quantity: ≈100 mt", "100 mt"],
    ["Quantity: 100 mt, 10% more or less at Seller's option", "100 mt"],
    ["Quantity: 100 mt plus/minus 10%", "100 mt"],
    ["Quantity: 100 mt ±10%", "100 mt"],
    ["Quantity: 100 mt approx.", "100 mt"],
    ["Price: USD 683 per mt or USD 690 per mt ex-pipe", "USD 683 per mt"],
    ["Price: around USD 683 per mt", "USD 683 per mt"],
    ["Price: indicatively USD 683 per mt", "USD 683 per mt"],
    ["Price: USD 683 per mt (Platts-linked, +/- daily)", "USD 683 per mt"],
    // round 1 (probe-qctx): a sub-span of a range, an approximation
    ["We can offer LSMGO 0.1% at Algeciras, 280/320 mt at EUR 690 per mt.", "280"],
    ["Quantity: abt 300 mt", "300 mt"],
  ])("hedged: %j | %j", (line, asWritten) => {
    expect(hedged(line, asWritten)).toBe(true);
  });

  it("rr/i2.mts: a shortened evidence span cannot hide the marker", () => {
    expect(hedged("Quantity: abt 100 mt", "100 mt", "100 mt")).toBe(true);
    expect(hedged("Quantity: 100-150 mt", "150 mt", "150 mt")).toBe(true);
    expect(hedged("Quantity: 100/150 mt", "150 mt", "150 mt")).toBe(true);
  });

  it("rr3/hedge.mts: a marker on the label line above the amount", () => {
    const src = "From: x\nSubject: y\n\nApprox. quantity\n300 mt\nPrice\nUSD 683 per mt\n";
    expect(hedgedInSource(src, "300 mt", "300 mt")).toBe(true);
    expect(
      hedgedInSource("From: x\nSubject: y\n\nQuantity (abt):\n300 mt\n", "300 mt", "300 mt"),
    ).toBe(true);
  });

  // rr3/inside.mts, rr3/hedge-aw.mts: the model keeps the hedged span in asWritten.
  it.each([
    "min 300 mt",
    "min. 300 mt",
    "minimum 300 mt",
    "max 300 mt",
    "max. 300 mt",
    "maximum 300 mt",
    "up to 300 mt",
    "+/- 300 mt",
    "± 300 mt",
    "+- 300 mt",
    "at least 300 mt",
    "roughly 300 mt",
    "around 300 mt",
    "c. 300 mt",
    "≈300 mt",
    "300 mt MOLOO",
    "300 mt min",
    "300 mt max",
    "300 mt more or less",
    "moloo 300 mt",
    "around USD 683 per mt",
    "max USD 683 per mt",
    "USD 683 per mt max",
    "abt 300 mt",
    "abt 100 mt",
    "approx. 100 mt",
    "about 100 mt",
    "~100 mt",
    "100 mt approx.",
    "100 mt +/- 5%",
    "circa 100 mt",
    "abt USD 683 per mt",
    "approx. USD 683 per mt",
    "USD 683 per mt approx.",
    "~USD 683 per mt",
  ])("parseAmount(%j) = null", (asWritten) => {
    expect(parseAmount(asWritten)).toBeNull();
  });
});
