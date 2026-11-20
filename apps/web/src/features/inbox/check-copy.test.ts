import { describe, expect, it } from "vitest";
import { CHECK_COPY, oneBasedLines } from "./check-copy";

const fail = (check: string, detail: string) => ({ check, passed: false, detail });

describe("CHECK_COPY", () => {
  it("says the unit check in plain words, one-based", () => {
    expect(
      CHECK_COPY.unit_known?.(fail("unit_known", 'Price of line 0 is not per mt ("/ mt").')),
    ).toBe("Line 1: the price unit “/ mt” was not recognised. Confirm it is per tonne.");
  });
  it("says the quantity check in plain words", () => {
    expect(
      CHECK_COPY.quantity_unambiguous?.(
        fail("quantity_unambiguous", 'Quantity of line 0 is not a single amount ("300/350 mt").'),
      ),
    ).toBe("Line 1: the quantity “300/350 mt” is not one amount.");
  });
  it("shows line numbers 1-based in any other detail", () => {
    expect(oneBasedLines('Grade "x" of line 1 is not recognised.')).toContain("line 2");
  });
});
