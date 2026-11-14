import type { Fact } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { checkNumbers, citedFactIds, numericTokens } from "./release-gate.js";

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
    expect(numericTokens("$233,851.20 and €9,000 and 12.5% and 7")).toEqual([
      { text: "233,851.20", value: 233851.2, decimals: 2, multiplier: 1, percent: false },
      { text: "9,000", value: 9000, decimals: 0, multiplier: 1, percent: false },
      { text: "12.5%", value: 12.5, decimals: 1, multiplier: 1, percent: true },
      { text: "7", value: 7, decimals: 0, multiplier: 1, percent: false },
    ]);
  });

  it("reads a scale suffix as a multiplier", () => {
    expect(numericTokens("$16k, 1.2M, 3 mn, €2bn, 8 thousand, 5 million, 2 billion")).toEqual([
      { text: "16k", value: 16_000, decimals: 0, multiplier: 1_000, percent: false },
      { text: "1.2M", value: 1_200_000, decimals: 1, multiplier: 1_000_000, percent: false },
      { text: "3 mn", value: 3_000_000, decimals: 0, multiplier: 1_000_000, percent: false },
      { text: "2bn", value: 2e9, decimals: 0, multiplier: 1e9, percent: false },
      { text: "8 thousand", value: 8_000, decimals: 0, multiplier: 1_000, percent: false },
      { text: "5 million", value: 5e6, decimals: 0, multiplier: 1e6, percent: false },
      { text: "2 billion", value: 2e9, decimals: 0, multiplier: 1e9, percent: false },
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
