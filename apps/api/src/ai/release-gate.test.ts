import type { Fact } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { checkNumbers, citedFactIds, numericTokens, statesFact } from "./release-gate.js";

const calc = (id: string, value: number | string | boolean, unit: string | null = null): Fact => ({
  id,
  label: id,
  value,
  unit,
  provenance: { source: "calculation", calculationId: 1, calculator: "planBunkers", path: "x" },
});

const str = (id: string, value: string): Fact => ({
  id,
  label: id,
  value,
  unit: null,
  provenance: { source: "db", table: "vessels", rowId: 1, field: "imo" },
});

describe("numericTokens", () => {
  it("reads thousands commas, decimals, a leading currency sign and a trailing percent", () => {
    const none = { currency: null, unit: null };
    expect(numericTokens("$233,851.20 and €9,000 and 12.5% and 7")).toEqual([
      {
        text: "233,851.20",
        value: 233851.2,
        decimals: 2,
        multiplier: 1,
        percent: false,
        ...none,
        currency: "USD",
      },
      {
        text: "9,000",
        value: 9000,
        decimals: 0,
        multiplier: 1,
        percent: false,
        ...none,
        currency: "EUR",
      },
      { text: "12.5%", value: 12.5, decimals: 1, multiplier: 1, percent: true, ...none, unit: "%" },
      { text: "7", value: 7, decimals: 0, multiplier: 1, percent: false, ...none },
    ]);
  });

  it("reads a scale suffix as a multiplier", () => {
    const none = { percent: false, currency: null, unit: null };
    expect(numericTokens("$16k, 1.2M, 3 mn, €2bn, 8 thousand, 5 million, 2 billion")).toEqual([
      { text: "16k", value: 16_000, decimals: 0, multiplier: 1_000, ...none, currency: "USD" },
      { text: "1.2M", value: 1_200_000, decimals: 1, multiplier: 1_000_000, ...none },
      { text: "3 mn", value: 3_000_000, decimals: 0, multiplier: 1_000_000, ...none },
      { text: "2bn", value: 2e9, decimals: 0, multiplier: 1e9, ...none, currency: "EUR" },
      { text: "8 thousand", value: 8_000, decimals: 0, multiplier: 1_000, ...none },
      { text: "5 million", value: 5e6, decimals: 0, multiplier: 1e6, ...none },
      { text: "2 billion", value: 2e9, decimals: 0, multiplier: 1e9, ...none },
    ]);
  });

  it("matches scale suffixes case-insensitively", () => {
    expect(
      numericTokens("16 THOUSAND, $2Bn, $2 MN, $1.2 mln, 3 Million").map((t) => [t.text, t.value]),
    ).toEqual([
      ["16 THOUSAND", 16_000],
      ["2Bn", 2e9],
      ["2 MN", 2e6],
      ["1.2 mln", 1_200_000],
      ["3 Million", 3e6],
    ]);
  });

  it("reads lowercase m as million only right after a currency sign or code", () => {
    expect(
      numericTokens("$1.2m, €3m, USD 4m, EUR 5 m, 2.5 m, 10 m/s, 300 m³, 6 M").map((t) => [
        t.text,
        t.value,
      ]),
    ).toEqual([
      ["1.2m", 1_200_000],
      ["3m", 3e6],
      ["4m", 4e6],
      ["5 m", 5e6],
      ["2.5", 2.5],
      ["10", 10],
      ["300", 300],
      ["6 M", 6e6],
    ]);
  });

  it("does not read units that start like a suffix as one", () => {
    expect(numericTokens("300 mt, 5 min, 10 Kestrel, 4 Marsaxlokk").map((t) => t.text)).toEqual([
      "300",
      "5",
      "10",
      "4",
    ]);
  });

  it("ignores the markers of a numbered list at the start of lines", () => {
    expect(numericTokens("1. Kestrel\n2. Strait Line\n3) Nordwind").map((t) => t.text)).toEqual([]);
  });

  it("keeps a line-start number that does not continue a list", () => {
    expect(numericTokens("2. Kestrel").map((t) => t.text)).toEqual(["2"]);
    expect(numericTokens("1. Kestrel\n3. Strait Line").map((t) => t.text)).toEqual(["3"]);
    expect(numericTokens("Saves\n1.5 h").map((t) => t.text)).toEqual(["1.5"]);
  });

  it("splits a comma run that is not thousands grouping into separate numbers", () => {
    expect(numericTokens("12,13").map((t) => t.text)).toEqual(["12", "13"]);
  });

  it("ignores numbers inside fact citations", () => {
    expect(numericTokens("cost [f_plan_bunkering_12_options.0.totalCostUsd] here")).toEqual([]);
    expect(numericTokens("[f_a_1_x, f_b_2_y]")).toEqual([]);
  });
});

describe("citedFactIds", () => {
  it("lists every id in square-bracket citations, in order, once", () => {
    expect(citedFactIds("a [f_a_1_x] b [f_b_2_y, f_a_1_x] c [f_c]")).toEqual([
      "f_a_1_x",
      "f_b_2_y",
      "f_c",
    ]);
  });
});

describe("checkNumbers", () => {
  const cases: {
    name: string;
    answer: string;
    facts: Fact[];
    passed: boolean;
    ungrounded?: string[];
  }[] = [
    {
      name: "$233,851 [f_x] with fact 233851.2 passes at 0 dp",
      answer: "Total $233,851 [f_x].",
      facts: [calc("f_x", 233851.2, "USD")],
      passed: true,
    },
    {
      name: "a value rounded up at its displayed precision passes",
      answer: "About 233,852 [f_x].",
      facts: [calc("f_x", 233851.6)],
      passed: true,
    },
    {
      name: "a value off by more than half a displayed unit fails",
      answer: "About 233,853 [f_x].",
      facts: [calc("f_x", 233851.6)],
      passed: false,
      ungrounded: ["233,853"],
    },
    {
      name: '"8,000 cheaper" with no such fact fails and lists 8,000',
      answer: "Kestrel is 8,000 cheaper than Strait Line.",
      facts: [calc("f_x", 233851.2), calc("f_y", 250133.9)],
      passed: false,
      ungrounded: ["8,000"],
    },
    {
      name: "a currency-signed ungrounded number is listed without the sign",
      answer: "Saves $8,000.",
      facts: [],
      passed: false,
      ungrounded: ["8,000"],
    },
    {
      name: "an IMO inside a string fact passes",
      answer: "MV Aegean Pioneer (IMO 9480019) [f_imo]",
      facts: [str("f_imo", "9480019")],
      passed: true,
    },
    {
      name: "a voyage number's digits inside a string fact pass",
      answer: "Voyage AP-2611 [f_voy]",
      facts: [str("f_voy", "AP-2611")],
      passed: true,
    },
    {
      name: "digits from an ISO timestamp fact pass as written",
      answer: "ETA 2026-11-15 10:30 UTC [f_eta]",
      facts: [str("f_eta", "2026-11-15T10:30:00.000Z")],
      passed: true,
    },
    {
      name: "a number that is only part of a digit run in a string fact fails",
      answer: "2 options",
      facts: [str("f_eta", "2026-11-15T10:30:00.000Z")],
      passed: false,
      ungrounded: ["2"],
    },
    {
      name: "a percentage equal to the fact value passes",
      answer: "12.5% [f_p]",
      facts: [calc("f_p", 12.5)],
      passed: true,
    },
    {
      name: "a percentage equal to a fraction fact times 100 passes",
      answer: "phase-in 70% [f_p]",
      facts: [calc("f_p", 0.7)],
      passed: true,
    },
    {
      name: "a percentage matching no fact fails",
      answer: "phase-in 71%",
      facts: [calc("f_p", 0.7)],
      passed: false,
      ungrounded: ["71%"],
    },
    {
      name: "decimals are compared at the displayed precision",
      answer: "1.2 h [f_d] and 1.3 h",
      facts: [calc("f_d", 1.24)],
      passed: false,
      ungrounded: ["1.3"],
    },
    {
      name: "numbers inside citations are ignored",
      answer: "See [f_plan_bunkering_12_options.0.rank].",
      facts: [calc("f_plan_bunkering_12_options.0.rank", 3)],
      passed: true,
    },
    {
      name: "a negative fact matches its magnitude",
      answer: "short by 12.4 mt [f_s]",
      facts: [calc("f_s", -12.4)],
      passed: true,
    },
    {
      name: "booleans never ground a number",
      answer: "1",
      facts: [calc("f_b", true)],
      passed: false,
      ungrounded: ["1"],
    },
    {
      name: "each ungrounded number is listed once, in order",
      answer: "5 then 8,000 then 5",
      facts: [],
      passed: false,
      ungrounded: ["5", "8,000"],
    },
    {
      name: "a number with a matching fact but no citation fails (every number is cited)",
      answer: "Total $233,851.",
      facts: [calc("f_x", 233851.2)],
      passed: false,
      ungrounded: ["233,851"],
    },
    {
      name: "a number cited with a fact of another value fails",
      answer: "Total $233,851 [f_y].",
      facts: [calc("f_x", 233851.2), calc("f_y", 5)],
      passed: false,
      ungrounded: ["233,851"],
    },
    {
      name: "a number cited with an unknown fact id fails, and so does the citation",
      answer: "Total $233,851 [f_nope].",
      facts: [calc("f_x", 233851.2)],
      passed: false,
      ungrounded: ["233,851", "[f_nope]"],
    },
    {
      name: "a citation of an unknown fact fails even with no number before it",
      answer: "Kestrel is [f_8000_usd] cheaper.",
      facts: [],
      passed: false,
      ungrounded: ["[f_8000_usd]"],
    },
    {
      name: "an unknown id next to a known one in a citation fails",
      answer: "Total $233,851 [f_x, f_bogus].",
      facts: [calc("f_x", 233851.2)],
      passed: false,
      ungrounded: ["[f_bogus]"],
    },
    {
      name: "a citation of a known fact with no number passes",
      answer: "Best is Kestrel at Marsaxlokk [f_best].",
      facts: [str("f_best", "MTMLA-kestrel")],
      passed: true,
    },
    {
      name: "a scaled number within its displayed precision passes",
      answer: "Saves $16k [f_saving].",
      facts: [calc("f_saving", 16_230)],
      passed: true,
    },
    {
      name: "a scaled number cited with an unrelated fact fails",
      answer: "Costs $6k [f_delay] more.",
      facts: [calc("f_delay", 11.12)],
      passed: false,
      ungrounded: ["6k"],
    },
    {
      name: "a scaled number is not matched by its bare digits",
      answer: "Saves $16k [f_x].",
      facts: [calc("f_x", 16)],
      passed: false,
      ungrounded: ["16k"],
    },
    {
      name: "a scaled number outside its displayed precision fails",
      answer: "Saves 1.2M [f_x] and 8 thousand [f_y].",
      facts: [calc("f_x", 1_260_000), calc("f_y", 8_400)],
      passed: false,
      ungrounded: ["1.2M"],
    },
    {
      name: "a scaled number never matches a string fact",
      answer: "ETA 15k [f_eta]",
      facts: [str("f_eta", "2026-11-15T10:30:00.000Z")],
      passed: false,
      ungrounded: ["15k"],
    },
    {
      name: "non-ASCII digits are always ungrounded",
      answer: "Saves \u0668\u0660\u0660\u0660 dollars and \uff18\uff10 more [f_x].",
      facts: [calc("f_x", 8000), calc("f_y", 80)],
      passed: false,
      ungrounded: ["\u0668\u0660\u0660\u0660", "\uff18\uff10"],
    },
    {
      name: "a spelled-out number with a scale word fails",
      answer: "Kestrel is about eight thousand dollars cheaper.",
      facts: [],
      passed: false,
      ungrounded: ["eight thousand"],
    },
    {
      name: "spelled-out numbers next to a unit, currency or percent fail",
      answer:
        "It is five percent dearer, needs twelve tonnes, takes three hours, waits twenty-five days, " +
        "costs $ nine more, adds a dozen mt and two hundred tonnes, and is 4 % [f_p] or seven % off.",
      facts: [calc("f_p", 4)],
      passed: false,
      ungrounded: [
        "five",
        "twelve",
        "three",
        "twenty-five",
        "nine",
        "dozen",
        "two hundred",
        "seven",
      ],
    },
    {
      name: "bare spelled-out counts pass",
      answer: "I compared two options from three suppliers; one is feasible.",
      facts: [],
      passed: true,
    },
    {
      name: "other bare spelled-out words pass",
      answer: "One of the quotes halves the delay; a quarter of the fleet is in port.",
      facts: [],
      passed: true,
    },
    ...[
      ["Kestrel waits one day longer.", "one"],
      ["It takes one hour longer.", "one"],
      ["Short by one tonne.", "one"],
      ["It is zero hours late.", "zero"],
      ["It takes half an hour more.", "half"],
      ["Kestrel is one thousand cheaper.", "one thousand"],
      ["Kestrel saves one million.", "one million"],
      ["Kestrel saves a million.", "million"],
      ["Kestrel saves a thousand dollars.", "thousand"],
      ["It is half a million cheaper.", "half a million"],
      ["It saves about a quarter of a million.", "quarter of a million"],
      ["Kestrel saves 2 billion or so.", null],
    ].map(([answer, word]) => ({
      name: word ? `"${answer}" fails on "${word}"` : `"${answer}" fails on its digits`,
      answer: answer as string,
      facts: [],
      passed: false,
      ungrounded: [word ?? "2 billion"],
    })),
    {
      name: "a scale word that scales a digit token is checked once, with the token",
      answer:
        "Kestrel saves 16 thousand dollars [f_s], 1.2 million euros [f_e] and 16 thousand tonnes [f_q].",
      facts: [calc("f_s", 16_171.5), calc("f_e", 1_234_000), calc("f_q", 16_000)],
      passed: true,
    },
    {
      name: "a digit token scaled by a word must match at its scale",
      answer: "Kestrel saves 16 thousand dollars [f_s].",
      facts: [calc("f_s", 16)],
      passed: false,
      ungrounded: ["16 thousand"],
    },
    {
      name: "metres are a unit, not million",
      answer: "Waves 2.5 m [f_w], wind 10 m/s [f_v], hold 300 m³ [f_h].",
      facts: [calc("f_w", 2.5), calc("f_v", 10), calc("f_h", 300)],
      passed: true,
    },
    {
      name: "a currency-led lowercase m is million",
      answer: "About $1.2m [f_c] or USD 1.2m [f_c].",
      facts: [calc("f_c", 1_234_567)],
      passed: true,
    },
    {
      name: "a currency-led lowercase m does not match the bare digits",
      answer: "About $1.2m [f_c].",
      facts: [calc("f_c", 1.2)],
      passed: false,
      ungrounded: ["1.2m"],
    },
    {
      name: "case-insensitive scale suffixes are checked at their scale",
      answer: "Saves 16 THOUSAND [f_s], $2Bn [f_b], $2 MN [f_m] and $1.2 mln [f_l].",
      facts: [calc("f_s", 16_171.5), calc("f_b", 2e9), calc("f_m", 2e6), calc("f_l", 1_200_000)],
      passed: true,
    },
    {
      name: "list markers of a numbered list pass; a broken sequence does not",
      answer: "1. Kestrel at Marsaxlokk\n2. Strait Line at Gibraltar\n4. Nordwind",
      facts: [],
      passed: false,
      ungrounded: ["4"],
    },
    {
      name: "several numbers before one multi-id citation pass",
      answer: "Headline $712/mt and $738/mt [f_a, f_b].",
      facts: [calc("f_a", 712), calc("f_b", 738)],
      passed: true,
    },
    {
      name: "each number is backed by the first citation after it",
      answer: "For 300 mt, at $233,914.45 [f_total].",
      facts: [calc("f_total", 233914.449), calc("f_qty", 300)],
      passed: false,
      ungrounded: ["300"],
    },
    {
      name: "a citation in the next sentence does not cover a number",
      answer: "Recommendation 1 is pending. See [f_rec].",
      facts: [calc("f_rec", 1)],
      passed: false,
      ungrounded: ["1"],
    },
    {
      name: "an answer with no numbers passes",
      answer: "Bunker at Marsaxlokk with Kestrel Marine Fuels.",
      facts: [],
      passed: true,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = checkNumbers(c.answer, c.facts);
      expect(result.passed).toBe(c.passed);
      expect(result.repaired).toBe(false);
      expect(result.ungroundedNumbers).toEqual(c.ungrounded ?? []);
    });
  }
});

describe("numericTokens: currency, unit, sign and formats", () => {
  it("carries the currency and unit written next to each number", () => {
    expect(
      numericTokens(
        "USD 738 per mt, $712/mt, US$700 per tonne, 738 EUR/t, €9,000, 26 USD, " +
          "8 thousand dollars, 1.2 million euros, 300 mt, 12 tonnes, 70 percent, 4 %, " +
          "11.12 hours, a 36.32-hour delay, 1,234 t CO₂, 56 tCO2, 12.5 kn, 2,450 nm, 3 days",
      ).map((t) => [t.text, t.currency, t.unit]),
    ).toEqual([
      ["738", "USD", "/mt"],
      ["712", "USD", "/mt"],
      ["700", "USD", "/mt"],
      ["738", "EUR", "/mt"],
      ["9,000", "EUR", null],
      ["26", "USD", null],
      ["8 thousand", "USD", null],
      ["1.2 million", "EUR", null],
      ["300", null, "mt"],
      ["12", null, "mt"],
      ["70%", null, "%"],
      ["4%", null, "%"],
      ["11.12", null, "h"],
      ["36.32", null, "h"],
      ["1,234", null, "t CO₂"],
      ["56", null, "t CO₂"],
      ["12.5", null, "kn"],
      ["2,450", null, "nm"],
      ["3", null, "days"],
    ]);
  });

  it("reads a mass followed by CO₂ as a CO₂ mass, and kilograms and grams as their own units", () => {
    expect(
      numericTokens(
        "738 mt CO2, 738 tonnes CO₂, 738 t of CO2, 738 metric tons of CO₂, 738 kg CO2, 5 kg, " +
          "5.2 g CO₂/dwt·nm",
      ).map((t) => [t.text, t.unit]),
    ).toEqual([
      ["738", "t CO₂"],
      ["738", "t CO₂"],
      ["738", "t CO₂"],
      ["738", "t CO₂"],
      ["738", "kg"],
      ["5", "kg"],
      ["5.2", "g"],
    ]);
  });

  it("does not read a letter glued to the next number as a unit", () => {
    expect(numericTokens("2026-11-15T10:30 and 26 USD2").map((t) => [t.text, t.unit])).toEqual([
      ["2026", null],
      ["11", null],
      ["15", null],
      ["10", null],
      ["30", null],
      ["26", null],
      ["2", null],
    ]);
  });

  it("reads a leading minus as negative, but not a hyphen after a letter or digit", () => {
    expect(
      numericTokens(
        "-26 USD, −$26, $-26, USD -26, –26 USD, $–26, AP-2611, 2026-11-15, 10-12 days, 10–12 days",
      ).map((t) => [t.text, t.value]),
    ).toEqual([
      ["-26", -26],
      ["-26", -26],
      ["-26", -26],
      ["-26", -26],
      ["-26", -26],
      ["-26", -26],
      ["2611", 2611],
      ["2026", 2026],
      ["11", 11],
      ["15", 15],
      ["10", 10],
      ["12", 12],
      ["10", 10],
      ["12", 12],
    ]);
  });

  it("reads space-grouped thousands as one number", () => {
    expect(
      numericTokens("233 914, 1 234 567.5, 233\u00a0914 and 12 34").map((t) => [t.text, t.value]),
    ).toEqual([
      ["233 914", 233_914],
      ["1 234 567.5", 1_234_567.5],
      ["233\u00a0914", 233_914],
      ["12", 12],
      ["34", 34],
    ]);
  });

  it("skips the digits of names that state no amount", () => {
    expect(
      numericTokens("CO2, CO₂, tCO2, IMO 2020, ISO 8217, ISO 8217:2017, MARPOL Annex VI"),
    ).toEqual([]);
  });
});

/** A fact with a unit and a label, as the tools emit them. */
const labelled = (
  id: string,
  value: number | string,
  unit: string | null,
  label: string = id,
): Fact => ({ ...calc(id, value, unit), label });

const SAVING_LABEL = "Saving of the best option against the cheapest headline price, in total cost";

describe("checkNumbers v2", () => {
  const cases: {
    name: string;
    answer: string;
    facts: Fact[];
    passed: boolean;
    ungrounded?: string[];
  }[] = [
    // unit and currency must agree
    {
      name: '"USD 738 per mt" vs a EUR/mt fact of 738 is ungrounded',
      answer: "Kestrel quotes USD 738 per mt [f_p].",
      facts: [labelled("f_p", 738, "EUR/mt")],
      passed: false,
      ungrounded: ["738"],
    },
    {
      name: '"738 mt" vs a USD/mt fact of 738 is ungrounded',
      answer: "Kestrel offers 738 mt [f_p].",
      facts: [labelled("f_p", 738, "USD/mt")],
      passed: false,
      ungrounded: ["738"],
    },
    {
      name: '"EUR 738" vs a EUR/mt fact of 738 is grounded',
      answer: "Kestrel quotes EUR 738 [f_p].",
      facts: [labelled("f_p", 738, "EUR/mt")],
      passed: true,
    },
    {
      name: '"-26 USD" vs a saving fact of 26 with "cheaper" is grounded',
      answer: "Kestrel works out cheaper, at -26 USD [f_s].",
      facts: [labelled("f_s", 26, "USD", SAVING_LABEL)],
      passed: true,
    },
    {
      name: '"USD … per mt" and "$…/mt" are equivalent to a USD/mt fact',
      answer: "USD 738 per mt [f_a], $712/mt [f_b] and 700 USD per tonne [f_c].",
      facts: [
        labelled("f_a", 738, "USD/mt"),
        labelled("f_b", 712, "USD/mt"),
        labelled("f_c", 700, "USD/mt"),
      ],
      passed: true,
    },
    {
      name: '"percent" is equivalent to a % fact',
      answer: "Strait Line is 3.6 percent [f_c] dearer.",
      facts: [labelled("f_c", 3.6, "%")],
      passed: true,
    },
    {
      name: "written units that agree with the fact units are grounded",
      answer:
        "300 mt [f_q] in 11.12 hours [f_d] at 12.5 kn [f_s] over 2,450 nm [f_n], " +
        "3 days [f_t], 1,234 t CO₂ [f_c] and €9,000 [f_e].",
      facts: [
        labelled("f_q", 300, "mt"),
        labelled("f_d", 11.12, "h"),
        labelled("f_s", 12.5, "kn"),
        labelled("f_n", 2450, "nm"),
        labelled("f_t", 3, "days"),
        labelled("f_c", 1234.2, "t CO₂"),
        labelled("f_e", 9000, "EUR"),
      ],
      passed: true,
    },
    {
      name: "a currency that disagrees with the fact is ungrounded",
      answer: "The barge fee is $9,000 [f_e].",
      facts: [labelled("f_e", 9000, "EUR")],
      passed: false,
      ungrounded: ["9,000"],
    },
    {
      name: "a unit that disagrees with the fact is ungrounded",
      answer: "The delay is 11 days [f_d].",
      facts: [labelled("f_d", 11, "h")],
      passed: false,
      ungrounded: ["11"],
    },
    {
      name: "a percentage of a fact in USD is ungrounded",
      answer: "That is 12% [f_x].",
      facts: [labelled("f_x", 12, "USD")],
      passed: false,
      ungrounded: ["12%"],
    },
    {
      name: "a percentage is not a % fact times 100",
      answer: "That is 50% [f_p].",
      facts: [labelled("f_p", 0.5, "%")],
      passed: false,
      ungrounded: ["50%"],
    },
    {
      name: "a fact with no unit is not unit-checked",
      answer: "Short by 12.4 mt [f_x].",
      facts: [labelled("f_x", 12.4, null)],
      passed: true,
    },
    // sign
    {
      name: "a negative number never matches a positive fact",
      answer: "The total is -26 USD [f_t], which is lower.",
      facts: [labelled("f_t", 26, "USD", "Total delivered cost")],
      passed: false,
      ungrounded: ["-26"],
    },
    {
      name: 'an en dash reads as a minus: "–26 USD" never matches a positive non-saving fact',
      answer: "The total is –26 USD [f_t].",
      facts: [labelled("f_t", 26, "USD", "Total delivered cost")],
      passed: false,
      ungrounded: ["-26"],
    },
    {
      name: "an en dash between numbers is a range, not a minus",
      answer: "The delay is 10–12 hours [f_a].",
      facts: [labelled("f_a", 12, "h")],
      passed: false,
      ungrounded: ["10"],
    },
    {
      name: "a negative saving needs less, lower or cheaper in its sentence",
      answer: "Kestrel costs -26 USD more [f_s].",
      facts: [labelled("f_s", 26, "USD", SAVING_LABEL)],
      passed: false,
      ungrounded: ["-26"],
    },
    {
      name: "a negative difference said to be lower is grounded",
      answer: "Kestrel's price is −$26 lower [f_c].",
      facts: [labelled("f_c", 26, "USD/mt", "difference of headline price and headline price")],
      passed: true,
    },
    {
      name: "a negative number matches a negative fact",
      answer: "The balance is -12.4 mt [f_b].",
      facts: [labelled("f_b", -12.4, "mt")],
      passed: true,
    },
    // not numeric claims
    {
      name: "chemical and regulation names are not numbers",
      answer:
        "CO2 and CO₂ are capped under IMO 2020; the fuel meets ISO 8217:2017 and MARPOL Annex VI.",
      facts: [],
      passed: true,
    },
    {
      name: "CO2 in a unit does not hide the amount before it",
      answer: "It emits 1,234 t CO2.",
      facts: [],
      passed: false,
      ungrounded: ["1,234"],
    },
    {
      name: "a clock time a fact holds passes uncited, in either form",
      answer: "Arrives 08:00 UTC, so the pilot boards at 8:00.",
      facts: [str("f_eta", "2026-11-15T08:00:00.000Z")],
      passed: true,
    },
    {
      name: "a zero-padded clock time matches a fact written without the zero",
      answer: "Pilot at 06:30.",
      facts: [str("f_pilot", "6:30 LT")],
      passed: true,
    },
    {
      name: "a clock time no fact holds is checked as numbers",
      answer: "Arrives 09:00 UTC.",
      facts: [str("f_eta", "2026-11-15T08:00:00.000Z")],
      passed: false,
      ungrounded: ["09", "00"],
    },
    {
      name: "an IMO number equal to a fact passes uncited",
      answer: "Aegean Pioneer, IMO 9480019, is at sea.",
      facts: [str("f_imo", "9480019")],
      passed: true,
    },
    {
      name: "an IMO number no fact equals is ungrounded",
      answer: "Aegean Pioneer, IMO 9480020, is at sea.",
      facts: [str("f_imo", "9480019")],
      passed: false,
      ungrounded: ["9480020"],
    },
    // Phase 5: MMSIs and hazard ids are identifiers, not amounts, when the ledger carries them
    {
      name: "an MMSI in a fact label passes uncited",
      answer: "MMSI 205795000 is best on route B, 1,234.5 nm [f_d].",
      facts: [labelled("f_d", 1234.5, "nm", "MMSI 205795000, route B: distance")],
      passed: true,
    },
    {
      name: "an MMSI equal to a fact value passes uncited, also written MMSI:",
      answer: "The ship (MMSI: 205795000) is not in the fleet.",
      facts: [str("f_mmsi", "205795000")],
      passed: true,
    },
    {
      name: "an MMSI no fact carries is ungrounded",
      answer: "MMSI 205795001 is best on route B.",
      facts: [labelled("f_d", 1234.5, "nm", "MMSI 205795000, route B: distance")],
      passed: false,
      ungrounded: ["205795001"],
    },
    {
      name: "a hazard id equal to a fact value passes uncited",
      answer: "Route B avoids synthetic:1 and ais:distress_beacon:970123456.",
      facts: [str("f_h1", "synthetic:1"), str("f_h2", "ais:distress_beacon:970123456")],
      passed: true,
    },
    {
      name: "a hazard id no fact value equals is ungrounded (a longer id or a label does not count)",
      answer: "Route B avoids synthetic:1 and synthetic:2.",
      facts: [
        str("f_h1", "synthetic:12"),
        labelled("f_l", "Keep clear", null, "Reported hazard synthetic:2"),
      ],
      passed: false,
      ungrounded: ["1", "2"],
    },
    {
      name: "a quantity space-grouped onto a held hazard id is checked",
      answer: "Avoids synthetic:1 950 t.",
      facts: [str("f_h1", "synthetic:1")],
      passed: false,
      ungrounded: ["1 950"],
    },
    // review round 1: an exempt span never hides a number joined onto it
    {
      name: "a quantity space-grouped onto the 2 of CO2 is checked, not skipped",
      answer: "Total CO2 950 t this voyage.",
      facts: [],
      passed: false,
      ungrounded: ["2 950"],
    },
    {
      name: "a quantity space-grouped onto a lowercase co2 is checked",
      answer: "Emitted co2 120 t.",
      facts: [],
      passed: false,
      ungrounded: ["2 120"],
    },
    {
      name: "a quantity comma-grouped onto the 2 of CO2 is checked",
      answer: "Emitted CO2,500 t.",
      facts: [],
      passed: false,
      ungrounded: ["2,500"],
    },
    {
      name: "a quantity space-grouped onto the minutes of a held clock time is checked",
      answer: "Arrives 08:00 950 mt loaded.",
      facts: [str("f_eta", "2026-11-15T08:00:00.000Z")],
      passed: false,
      ungrounded: ["00 950"],
    },
    {
      name: "the minutes and seconds of a timestamp fact do not hold a clock time",
      answer: "Arrives 15:30 UTC.",
      facts: [str("f_eta", "2026-11-17T03:15:30.000Z")],
      passed: false,
      ungrounded: ["15", "30"],
    },
    {
      name: "the seconds of a timestamp fact do not hold 00:00",
      answer: "The clock reads 00:00.",
      facts: [str("f_eta", "2026-11-15T08:00:00.000Z")],
      passed: false,
      ungrounded: ["00"],
    },
    {
      name: '"mt CO2" and "tonnes CO2" are CO₂, not fuel',
      answer: "It emits 738 mt CO2 [f_fuel] or 738 tonnes CO2 [f_fuel].",
      facts: [labelled("f_fuel", 738, "mt")],
      passed: false,
      ungrounded: ["738"],
    },
    {
      name: "a mass followed by CO₂ is grounded by a t CO₂ fact",
      answer: "It emits 738 mt CO2 [f_c], 738 t of CO2 [f_c] and 738 metric tons of CO₂ [f_c].",
      facts: [labelled("f_c", 738, "t CO₂")],
      passed: true,
    },
    {
      name: "kilograms and grams agree with no fact in tonnes",
      answer: "It emits 738 kg CO2 [f_c], or 738 g [f_q].",
      facts: [labelled("f_c", 738, "t CO₂"), labelled("f_q", 738, "mt")],
      passed: false,
      ungrounded: ["738"],
    },
    // space-grouped thousands
    {
      name: "a space-grouped number is one number, grounded at its precision",
      answer: "Total $233 914 [f_x].",
      facts: [labelled("f_x", 233914.449, "USD")],
      passed: true,
    },
    {
      name: "an uncited space-grouped number is listed whole",
      answer: "Total 233 914.",
      facts: [],
      passed: false,
      ungrounded: ["233 914"],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = checkNumbers(c.answer, c.facts);
      expect(result.ungroundedNumbers).toEqual(c.ungrounded ?? []);
      expect(result.passed).toBe(c.passed);
    });
  }

  it("records its pass as attempt 1", () => {
    expect(checkNumbers("Saves $8,000.", []).attempts).toEqual([
      { attempt: 1, passed: false, ungroundedNumbers: ["8,000"] },
    ]);
  });
});

describe("statesFact: the text shows a fact's value as the gate reads it", () => {
  const total = labelled("f_t", 233_914.449, "USD", "total delivered cost");
  it.each([
    ["$233,914.45", true],
    ["$233,914", true],
    ["USD 234k", true],
    ["$0.23 million", true],
    ["$240k", false],
    ["233,914 mt", false],
    ["EUR 233,914", false],
    ["", false],
    ["See [f_t].", false],
  ])("%s -> %s", (text, want) => {
    expect(statesFact(`Total ${text} [f_t].`, total)).toBe(want);
  });

  it("needs no citation, and reads a percentage of a fraction fact as the gate does", () => {
    expect(statesFact("It holds 300 mt.", labelled("f_q", 300, "mt"))).toBe(true);
    expect(statesFact("That is 70%.", labelled("f_r", 0.7, null))).toBe(true);
    expect(statesFact("That is 70%.", labelled("f_r", 0.7, "USD"))).toBe(false);
  });
});
