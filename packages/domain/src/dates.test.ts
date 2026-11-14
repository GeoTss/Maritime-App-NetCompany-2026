import { describe, expect, it } from "vitest";
import { bargeFeeTotal, isoDayAfter, parseDeliveryWindow, parseQuoteDate } from "./dates.js";

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
