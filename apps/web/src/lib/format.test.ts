import { describe, expect, it } from "vitest";
import { displayDecimals, formatNumber, formatUtc, possessive } from "@/lib/format";

/** The digits (and sign and point) of a formatted number, without grouping or unit. */
const digitsOf = (text: string) => text.replace(/[^0-9.-]/g, "");

const UNITS = [null, "USD", "EUR", "USD/mt", "EUR/mt", "mt", "t CO₂", "kn", "nm", "h", "%", "m"];
const VALUES = [0, 1, 7, 12.5, 612.5, 612.499, 233914, 233914.4999, 1_234_567.891, -42.25, 0.05];

describe("formatNumber", () => {
  it("formatNumber never changes a value's digits beyond display rounding", () => {
    for (const unit of UNITS) {
      for (const value of VALUES) {
        const text = formatNumber(value, unit);
        const expected = value.toFixed(displayDecimals(unit, value));
        expect(digitsOf(text), `${value} ${unit} -> ${text}`).toBe(expected);
      }
    }
  });

  it("groups thousands and keeps fixed decimals per unit", () => {
    expect(formatNumber(612.5, "USD/mt")).toBe("612.50 USD/mt");
    expect(formatNumber(233914, "USD")).toBe("USD 233,914.00");
    expect(formatNumber(48024.56, "USD")).toBe("USD 48,024.56");
    expect(possessive("Nordwind Bunker Services")).toBe("Nordwind Bunker Services'");
    expect(formatNumber(1500.25, "mt")).toBe("1,500.3 mt");
    expect(formatNumber(14.2, "kn")).toBe("14.2 kn");
    expect(formatNumber(12.5, "%")).toBe("12.5%");
    expect(formatNumber(3, null)).toBe("3");
  });

  it("never invents a value for a non-finite input", () => {
    expect(formatNumber(Number.NaN, "mt")).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY, null)).toBe("—");
  });
});

describe("formatUtc", () => {
  it("shows the instant in UTC with a Z", () => {
    expect(formatUtc("2026-11-14T08:05:00Z")).toBe("14 Nov 08:05Z");
    expect(formatUtc("2026-11-14T10:05:00+02:00")).toBe("14 Nov 08:05Z");
  });
});
