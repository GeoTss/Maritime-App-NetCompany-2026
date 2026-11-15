import { describe, expect, it } from "vitest";
import { kmhToKn, msToKn } from "./units.js";

describe("units", () => {
  it("kmhToKn: 18.52 km/h / 1.852 = 10 kn", () => {
    expect(kmhToKn(18.52)).toBeCloseTo(10, 12);
  });
  it("msToKn: 1 m/s x 3600 / 1852 = 1.94384 kn", () => {
    expect(msToKn(1)).toBeCloseTo(1.9438444924, 9);
    expect(msToKn(0)).toBe(0);
  });
  it("is deterministic", () => {
    expect(msToKn(7.3)).toBe(msToKn(7.3));
  });
});
