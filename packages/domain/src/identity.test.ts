import { describe, expect, it } from "vitest";
import { imoWithCheckDigit, isValidImo } from "./identity.js";

describe("imoWithCheckDigit", () => {
  it("907472 → 9×7+0×6+7×5+4×4+7×3+2×2 = 139 → check digit 9", () => {
    expect(imoWithCheckDigit("907472")).toBe("9074729");
  });
  it("948001 → 63+24+40+0+0+2 = 129 → check digit 9", () => {
    expect(imoWithCheckDigit("948001")).toBe("9480019");
  });
  it("rejects a base that is not six digits", () => {
    expect(() => imoWithCheckDigit("90747")).toThrow(RangeError);
    expect(() => imoWithCheckDigit("9074720")).toThrow(RangeError);
    expect(() => imoWithCheckDigit("90747a")).toThrow(RangeError);
  });
});

describe("isValidImo", () => {
  it("accepts a seven-digit number with a correct check digit", () => {
    expect(isValidImo("9074729")).toBe(true);
    expect(isValidImo("9480019")).toBe(true);
  });
  it("rejects a wrong check digit", () => {
    expect(isValidImo("9074728")).toBe(false);
  });
  it("rejects anything that is not exactly seven digits", () => {
    expect(isValidImo("907472")).toBe(false);
    expect(isValidImo("90747290")).toBe(false);
    expect(isValidImo("IMO9074729")).toBe(false);
    expect(isValidImo("907472x")).toBe(false);
    expect(isValidImo("")).toBe(false);
  });
});
