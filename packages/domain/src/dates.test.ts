import { describe, expect, it } from "vitest";
import {
  bargeFeeTotal,
  isoDayAfter,
  mentionsDate,
  parseDeliveryWindow,
  parseQuoteDate,
  readsAsDateOnly,
} from "./dates.js";

const REF = new Date("2026-11-14T09:30:00Z");

describe("parseQuoteDate", () => {
  const rows: [string, string][] = [
    ["15 Nov 2026", "2026-11-15"],
    ["15 November", "2026-11-15"],
    ["15/11/2026", "2026-11-15"],
    ["15.11.26", "2026-11-15"],
    ["2026-11-15", "2026-11-15"],
    ["Nov 15", "2026-11-15"],
    ["15 Nov 2026 1200 LT", "2026-11-15"],
    ["15 Nov 12:00 UTC", "2026-11-15"],
    ["15 Nov noon LT", "2026-11-15"],
    ["15 NOV 2026", "2026-11-15"],
    ["15 Nov.", "2026-11-15"],
    ["15 Nov 2027 UTC", "2027-11-15"],
    ["15 Nov 2026 1200 LT", "2026-11-15"],
    ["15 Nov 1200 LT", "2026-11-15"],
    ["15/11/2026 1200 UTC", "2026-11-15"],
    ["Nov. 15", "2026-11-15"],
    ["Mon 16 Nov", "2026-11-16"],
    ["Monday, 16th November 2026", "2026-11-16"],
    ["1st Dec", "2026-12-01"],
    ["15/11", "2026-11-15"],
    ["  15  Nov  ", "2026-11-15"],
    // 29 Feb: 2028 is a leap year
    ["29/02/2028", "2028-02-29"],
    // missing year, within 60 days before the reference: same year
    ["20 Sep", "2026-09-20"],
    // missing year, more than 60 days before the reference (14 Nov - 60d = 15 Sep): next year
    ["14 Sep", "2027-09-14"],
    ["15 Sep", "2026-09-15"],
  ];
  it.each(rows)("%s -> %s", (input, iso) => {
    expect(parseQuoteDate(input, REF)).toBe(iso);
  });

  it("rolls into next year: 5 Jan with reference 2026-12-20", () => {
    expect(parseQuoteDate("5 Jan", new Date("2026-12-20T00:00:00Z"))).toBe("2027-01-05");
  });

  // A missing year resolves into [reference - 60 days, reference + 305 days).
  const NEW_YEAR = new Date("2027-01-02T10:00:00Z");
  it.each([
    ["30 Dec", "2026-12-30"],
    ["5 Jan", "2027-01-05"],
    ["2 Jan", "2027-01-02"],
    // 2026-11-03 is exactly 60 days before the reference: still the earlier year
    ["3 Nov", "2026-11-03"],
    // 2026-11-02 is 61 days before: the later year (304 days ahead)
    ["2 Nov", "2027-11-02"],
  ])("rolls back across the year boundary: %s with reference 2027-01-02 -> %s", (input, iso) => {
    expect(parseQuoteDate(input, NEW_YEAR)).toBe(iso);
  });

  it("a date up to 305 days ahead takes the later year: 1 Sep with reference 2026-11-14", () => {
    expect(parseQuoteDate("1 Sep", REF)).toBe("2027-09-01");
  });

  it("29 Feb without a year takes the leap year in the window, else null", () => {
    expect(parseQuoteDate("29 Feb", new Date("2027-12-01T00:00:00Z"))).toBe("2028-02-29");
    expect(parseQuoteDate("29 Feb", REF)).toBeNull();
  });

  it("a day a 29 Feb pushes just outside the window is null: 1 Mar with reference 2027-05-01", () => {
    expect(parseQuoteDate("1 Mar", new Date("2027-05-01T00:00:00Z"))).toBeNull();
  });

  it.each([
    "31/02/2026",
    "29/02/2026",
    "32 Nov",
    "0 Nov",
    "15/13/2026",
    "tomorrow",
    "",
    "   ",
    "Nov",
    "15 Foo 2026",
    "2026-13-01",
    "15 Nov 2026 and more words",
    "15 Nov 1600",
    "Nov 15 1200",
    "15/11/1999",
    "1999-11-15",
    "2100-11-15",
    "5-6/11",
    "7-8.11",
    "15-11-26",
    "5-6",
    "18-11",
  ])("returns null for %j", (input) => {
    expect(parseQuoteDate(input, REF)).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseQuoteDate(null, REF)).toBeNull();
  });

  it("is deterministic and does not mutate the reference", () => {
    const before = REF.getTime();
    expect(parseQuoteDate("15 Nov", REF)).toBe(parseQuoteDate("15 Nov", REF));
    expect(REF.getTime()).toBe(before);
  });
});

describe("parseDeliveryWindow", () => {
  const rows: [string, { from: string; to: string }][] = [
    ["18-19 Nov", { from: "2026-11-18", to: "2026-11-19" }],
    ["18 Nov - 19 Nov 2026", { from: "2026-11-18", to: "2026-11-19" }],
    ["18/11-19/11", { from: "2026-11-18", to: "2026-11-19" }],
    ["18-19 Nov 2026", { from: "2026-11-18", to: "2026-11-19" }],
    ["18 to 19 Nov", { from: "2026-11-18", to: "2026-11-19" }],
    ["5-6/11", { from: "2026-11-05", to: "2026-11-06" }],
    ["10-12/11", { from: "2026-11-10", to: "2026-11-12" }],
    ["7-8.11", { from: "2026-11-07", to: "2026-11-08" }],
    ["1-2/12", { from: "2026-12-01", to: "2026-12-02" }],
    ["18/11-19", { from: "2026-11-18", to: "2026-11-19" }],
    ["18-19/11", { from: "2026-11-18", to: "2026-11-19" }],
    ["on 18 Nov", { from: "2026-11-18", to: "2026-11-18" }],
    ["18 Nov", { from: "2026-11-18", to: "2026-11-18" }],
    ["ETA 18 Nov +/- 1 day", { from: "2026-11-17", to: "2026-11-19" }],
    ["ETA 18 Nov ± 2 days", { from: "2026-11-16", to: "2026-11-20" }],
    ["28 Nov - 2 Dec", { from: "2026-11-28", to: "2026-12-02" }],
    ["30 Dec - 2 Jan", { from: "2026-12-30", to: "2027-01-02" }],
    ["30 Dec - 2 Jan 2027", { from: "2026-12-30", to: "2027-01-02" }],
    ["ETA 1 Dec +/- 1 day", { from: "2026-11-30", to: "2026-12-02" }],
  ];
  it.each(rows)("%s", (input, expected) => {
    expect(parseDeliveryWindow(input, REF)).toEqual(expected);
  });

  it.each([
    "5-6",
    "18-11",
    "20-19 Nov",
    "19 Nov - 18 Nov",
    "soon",
    "",
    "31/02-02/03",
    "ETA 18 Nov +/- x day",
  ])("returns null for %j", (input) => {
    expect(parseDeliveryWindow(input, REF)).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseDeliveryWindow(null, REF)).toBeNull();
  });

  const NEW_YEAR = new Date("2027-01-02T10:00:00Z");
  it.each([
    ["28-30 Dec", { from: "2026-12-28", to: "2026-12-30" }],
    ["30 Dec - 2 Jan", { from: "2026-12-30", to: "2027-01-02" }],
    ["on 30 Dec", { from: "2026-12-30", to: "2026-12-30" }],
    ["ETA 31 Dec +/- 1 day", { from: "2026-12-30", to: "2027-01-01" }],
    ["3-5 Jan", { from: "2027-01-03", to: "2027-01-05" }],
  ])("rolls back across the year boundary: %s with reference 2027-01-02", (input, expected) => {
    expect(parseDeliveryWindow(input, NEW_YEAR)).toEqual(expected);
  });

  it("is deterministic", () => {
    expect(parseDeliveryWindow("18-19 Nov", REF)).toEqual(parseDeliveryWindow("18-19 Nov", REF));
  });
});

describe("isoDayAfter", () => {
  it("counts whole UTC days from the reference's UTC day", () => {
    expect(isoDayAfter(new Date("2026-11-14T23:30:00Z"), 0)).toBe("2026-11-14");
    expect(isoDayAfter(new Date("2026-11-14T03:00:00Z"), 60)).toBe("2027-01-13");
    expect(isoDayAfter(new Date("2026-11-14T03:00:00Z"), 120)).toBe("2027-03-14");
    expect(isoDayAfter(new Date("2028-02-28T00:00:00Z"), 1)).toBe("2028-02-29");
    expect(isoDayAfter(new Date("2027-01-02T00:00:00Z"), -3)).toBe("2026-12-30");
  });
});

describe("bargeFeeTotal", () => {
  it("per_mt: 9 USD/mt x 300 mt = 2700", () => {
    expect(bargeFeeTotal(9, "per_mt", 300)).toBe(2700);
  });
  it("lump_sum ignores quantity: 2800", () => {
    expect(bargeFeeTotal(2800, "lump_sum", 300)).toBe(2800);
  });
  it("zero quantity: per_mt 0, lump sum unchanged", () => {
    expect(bargeFeeTotal(9, "per_mt", 0)).toBe(0);
    expect(bargeFeeTotal(2800, "lump_sum", 0)).toBe(2800);
  });
  it("is deterministic", () => {
    expect(bargeFeeTotal(9.5, "per_mt", 300)).toBe(bargeFeeTotal(9.5, "per_mt", 300));
  });
});

describe("mentionsDate", () => {
  it.each([
    "Validity: 14 Nov 2026 17:00 LT",
    "Valid until: 15th November 1700 LT",
    "Valid till: Nov 16",
    "Validity: Nov 13, 2026 18:00 UTC",
    "Delivery: 18-19 Nov",
    "Delivery 18 to 19 November",
    "This offer is valid until 15/11.",
    "Validity: 16.11.26",
    "Validity: 16.11 1700 LT",
    "Valid till: 2026-11-16 18:00 UTC",
    "Delivery window 18/11-19/11",
    "Validity: 16-11-2026",
    "Offer valid until Monday",
    "Valid until Sat noon",
    "Offer firm until today 17:00",
    "Valid until tomorrow",
    "ETA 1st of December",
    // round 3 (A'): ordinals, y/m/d, US m/d when the day is over 12, parts of a month, weeks
    "Valid till 1700 hrs on the 14th",
    "Offer valid till the 14th, 17:00 LT",
    "Delivery: 22nd - 24th",
    "Delivery 22nd-24th",
    "Valid until 2026/11/14 17:00 JST",
    "Delivery: 2026.11.22 - 2026.11.24",
    "Delivery: 11/22 - 11/24",
    "Offer valid until 11/14 COB",
    "Offer valid until 11/14/2026 5:00 PM CST",
    "Delivery: end Nov",
    "Delivery: end of Nov",
    "Delivery: early December",
    "Delivery window: mid-Dec",
    "Delivery: mid December",
    "Delivery: 1st half Dec",
    "Delivery: first half December",
    "Delivery: beginning December",
    "Delivery: late Nov",
    "Delivery: week 48",
    "Delivery: wk 48",
    "Delivery: end of next week",
    "Delivery: end of this week",
  ])("finds a date in %j", (line) => {
    expect(mentionsDate(line)).toBe(true);
  });

  it.each([
    "Price: USD 738 per mt",
    "Quantity: 300 mt LSMGO 0.1%",
    "VLSFO 0.5% / HSFO 3.5%",
    "280/320 mt",
    "Barge fee: USD 2,800 lump sum",
    "Delivery by barge",
    "Prices are valid for 24 hours",
    "Prices may vary",
    "Delivery charge: EUR 1.500",
    "IMO 9480019",
    "",
    // round 3: the wider patterns must not read amounts, percentages or durations as dates
    "Valid for 30 mins",
    "Offer valid for immediate acceptance - 1.5 hours",
    "We deliver within 3 days of notice",
    "2 / 3 days notice",
    "100 mt / 150 mt",
    "USD 683/mt",
    "VLSFO 500 mt / LSMGO 100 mt",
    "Price: USD 683 per mt - 30 days credit",
    "Two weeks notice",
    "Delivery: prompt, on vessel arrival",
  ])("finds no date in %j", (line) => {
    expect(mentionsDate(line)).toBe(false);
  });
});

describe("DD-MMM-YY and DD-MMM-YYYY are one date, never a range (round 3)", () => {
  const ref = new Date("2026-11-12T13:05:00Z");
  it.each([
    ["20-Nov-26", "2026-11-20"],
    ["20-NOV-26", "2026-11-20"],
    ["20-Nov-2026", "2026-11-20"],
    ["20.Nov.26", "2026-11-20"],
    ["20/Nov/2026", "2026-11-20"],
    ["20 Nov 26", "2026-11-20"],
    ["20-Nov", "2026-11-20"],
  ])("parseQuoteDate(%j) = %s", (written, iso) => {
    expect(parseQuoteDate(written, ref)).toBe(iso);
  });

  it.each([
    ["20-Nov-26", { from: "2026-11-20", to: "2026-11-20" }],
    ["20-Nov-2026", { from: "2026-11-20", to: "2026-11-20" }],
    ["20-Nov-26 to 22-Nov-26", { from: "2026-11-20", to: "2026-11-22" }],
    ["20-Nov-2026 - 22-Nov-2026", { from: "2026-11-20", to: "2026-11-22" }],
    ["20/Nov/26 - 22/Nov/26", { from: "2026-11-20", to: "2026-11-22" }],
    // unchanged: a day range before a month, and a range after a month name
    ["18-19 Nov", { from: "2026-11-18", to: "2026-11-19" }],
    ["Nov 20-26", { from: "2026-11-20", to: "2026-11-26" }],
    ["30 Nov - 2 Dec", { from: "2026-11-30", to: "2026-12-02" }],
  ])("parseDeliveryWindow(%j)", (written, window) => {
    expect(parseDeliveryWindow(written, ref)).toEqual(window);
  });
});

describe("readsAsDateOnly", () => {
  it.each([
    "18 Nov 2026",
    "22 Nov",
    "Friday, 13. November 2026 10:00",
    "Monday 23 Nov at 12:00 LT",
    "11/11/2026 10:00 (GMT+01:00)",
  ])("%j is only a date", (text) => {
    expect(readsAsDateOnly(text)).toBe(true);
  });

  it.each([
    "Sun Marine Bunkers",
    "Luca Dubois",
    "Kestrel Desk <bunkers@kestrel-fuels.example>",
    "Bunker Desk",
    "",
  ])("%j is not only a date", (text) => {
    expect(readsAsDateOnly(text)).toBe(false);
  });
});

// Regression suite (round 3): every date form the reviewers probed (rr3/md.mts, rr3/pq.mts), with
// what it must give. mentionsDate decides whether an omitted date sends the quote to review; the
// parsers decide the stored day (null: a human reads it).
describe("reviewer probe forms: mentionsDate, parseQuoteDate, parseDeliveryWindow", () => {
  const ref = new Date("2026-11-12T13:05:00Z");
  const rows: [string, boolean, string | null, { from: string; to: string } | null][] = [
    ["Valid till 2026/11/20", true, null, null],
    ["2026/11/20", true, null, null],
    ["2026.11.20", true, null, null],
    ["20261120", false, null, null],
    ["11/20/2026", true, null, null],
    ["11/20", true, null, null],
    ["11/20/26", true, null, null],
    ["12/1/2026", true, "2026-01-12", { from: "2026-01-12", to: "2026-01-12" }],
    ["11-20-2026", true, null, null],
    ["Nov 20th", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["20th of November", true, null, null],
    ["20th November", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["20.11", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["20.11.", true, null, null],
    ["w/c 23 Nov", true, null, null],
    ["end of next week", true, null, null],
    ["next week", false, null, null],
    ["early next week", false, null, null],
    ["within 3 days", false, null, null],
    ["prompt", false, null, null],
    ["COB Friday", true, null, null],
    ["EOD", false, null, null],
    ["Nov.20", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["NOV20", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["20NOV", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["20-Nov-26", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["1st half Dec", true, null, null],
    ["first half December", true, null, null],
    ["mid-Dec", true, null, null],
    ["mid December", true, null, null],
    ["end Nov", true, null, null],
    ["end of Nov", true, null, null],
    ["early Dec", true, null, null],
    ["beginning December", true, null, null],
    ["Dec 1-3", true, null, { from: "2026-12-01", to: "2026-12-03" }],
    ["1-3 Dec", true, null, { from: "2026-12-01", to: "2026-12-03" }],
    ["ETA 22/11", true, null, { from: "2026-11-22", to: "2026-11-22" }],
    ["ETA 22nd", true, null, null],
    ["ETA 2026-11-22", true, null, { from: "2026-11-22", to: "2026-11-22" }],
    ["22-11-2026", true, "2026-11-22", { from: "2026-11-22", to: "2026-11-22" }],
    ["22.11.2026", true, "2026-11-22", { from: "2026-11-22", to: "2026-11-22" }],
    ["22/11/2026", true, "2026-11-22", { from: "2026-11-22", to: "2026-11-22" }],
    ["Thursday", true, null, null],
    ["Thu 12:00", true, null, null],
    ["Delivery 22-24 Nov", true, null, { from: "2026-11-22", to: "2026-11-24" }],
    ["Delivery: 22nd-24th", true, null, null],
    ["valid 48 hrs", false, null, null],
    ["17:00 LT 14th", true, null, null],
    ["14th 1700LT", true, null, null],
    ["the 14th", true, null, null],
    ["fourteenth of November", false, null, null],
    ["Nov 14", true, "2026-11-14", { from: "2026-11-14", to: "2026-11-14" }],
    ["November", false, null, null],
    ["Dec", false, null, null],
    ["in December", false, null, null],
    ["20/XI", false, null, null],
    ["20 nov.", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["20 noviembre", false, null, null],
    ["20. November", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["w/c 23/11", true, null, null],
    ["w/e 22 Nov", true, null, null],
    ["wk 48", true, null, null],
    ["week 48", true, null, null],
    ["KW 48", true, null, null],
    ["14th 17:00", true, null, null],
    ["14th", true, null, null],
    ["1700 hrs 14th", true, null, null],
    ["2026/11/14", true, null, null],
    ["11/14", true, null, null],
    ["11/14/2026", true, null, null],
    ["14.11.", true, null, null],
    ["COB today", true, null, null],
    ["today 17:00", true, null, null],
    ["tomorrow noon", true, null, null],
    ["48 hrs", false, null, null],
    ["20 Nov 26", true, "2026-11-20", { from: "2026-11-20", to: "2026-11-20" }],
    ["1700 LT", false, null, null],
    ["Fri 1700", true, null, null],
    ["14 Nov 1700 LT", true, "2026-11-14", { from: "2026-11-14", to: "2026-11-14" }],
    ["2026.11.14", true, null, null],
    ["22nd-24th", true, null, null],
    ["22nd", true, null, null],
    ["22nd to 24th", true, null, null],
    ["22 Nov+/-2 days", true, null, { from: "2026-11-20", to: "2026-11-24" }],
    ["22-24.11", true, null, { from: "2026-11-22", to: "2026-11-24" }],
    ["22-24/11", true, null, { from: "2026-11-22", to: "2026-11-24" }],
    ["22/24 Nov", true, null, null],
  ];
  it.each(rows)("%j: mentionsDate %s, date %j, window %j", (text, mentions, date, window) => {
    expect(mentionsDate(text)).toBe(mentions);
    expect(parseQuoteDate(text, ref)).toBe(date);
    expect(parseDeliveryWindow(text, ref)).toEqual(window);
  });
});

// Regression suite: the date forms round 1's reviewer probed (scratchpad/probe-dates.mts). A null
// is a date the parser does not read, so the quote goes to review (dates_parsed / ruling A).
describe("reviewer probe forms, round 1: parseQuoteDate and parseDeliveryWindow", () => {
  const ref = new Date("2026-11-14T10:00:00Z");
  it.each([
    ["15th November", "2026-11-15"],
    ["15th Nov 2026", "2026-11-15"],
    ["Nov 15, 2026", "2026-11-15"],
    ["16.11.2026 / 12:00", null],
    ["end of day 16/11", null],
    ["COB 16 Nov", null],
    ["16 Nov 26", "2026-11-16"],
    ["11/16/2026", null],
    ["2026/11/16", null],
    ["16-11-2026", "2026-11-16"],
    ["Monday 16 Nov", "2026-11-16"],
    ["16 Nov 2026 12:00 LT", "2026-11-16"],
    ["16 Nov at 12:00", "2026-11-16"],
    ["until 16 Nov", null],
    ["16Nov", "2026-11-16"],
    ["16 Nov.", "2026-11-16"],
    ["Nov 16th", "2026-11-16"],
    ["16 XI 2026", null],
    ["today", null],
    ["16 Nov 0900", null],
    ["1600 LT 16 Nov", null],
  ] as [string, string | null][])("parseQuoteDate(%j) = %j", (text, date) => {
    expect(parseQuoteDate(text, ref)).toBe(date);
  });
  it.each([
    ["18/19 Nov", null],
    ["18th-19th Nov", { from: "2026-11-18", to: "2026-11-19" }],
    ["Nov 18-19", { from: "2026-11-18", to: "2026-11-19" }],
    ["18 - 19 November 2026", { from: "2026-11-18", to: "2026-11-19" }],
    ["18 to 19 Nov", { from: "2026-11-18", to: "2026-11-19" }],
    ["between 18 and 19 Nov", null],
    ["w/c 16 Nov", null],
    ["18-19/11", { from: "2026-11-18", to: "2026-11-19" }],
    ["30 Nov - 2 Dec", { from: "2026-11-30", to: "2026-12-02" }],
    ["18 Nov onwards", null],
    ["ETA 18 Nov +/- 2 days", { from: "2026-11-16", to: "2026-11-20" }],
    ["laycan 18-19 Nov", { from: "2026-11-18", to: "2026-11-19" }],
    ["18-19.11.2026", { from: "2026-11-18", to: "2026-11-19" }],
    ["18-19 Nov (on arrival)", { from: "2026-11-18", to: "2026-11-19" }],
    ["1-2 Dec", { from: "2026-12-01", to: "2026-12-02" }],
  ] as [string, { from: string; to: string } | null][])(
    "parseDeliveryWindow(%j) = %j",
    (text, window) => {
      expect(parseDeliveryWindow(text, ref)).toEqual(window);
    },
  );
});

describe("parseDeliveryWindow: copied labels and remarks", () => {
  const ref = new Date("2026-11-14T08:00:00Z");
  it.each([
    ["Delivery Nov 15-17", "2026-11-15", "2026-11-17"],
    ["Delivery window: 19-20 Nov", "2026-11-19", "2026-11-20"],
    ["14-15 Nov (on arrival)", "2026-11-14", "2026-11-15"],
    ["Dates: 22-24 Nov (subject to berth)", "2026-11-22", "2026-11-24"],
  ])("%s -> %s..%s", (written, from, to) => {
    expect(parseDeliveryWindow(written, ref)).toEqual({ from, to });
  });
  it("keeps a remark that holds a date (an alternative must not be dropped)", () => {
    expect(parseDeliveryWindow("18 Nov (or 19 Nov)", ref)).toBeNull();
  });
});
