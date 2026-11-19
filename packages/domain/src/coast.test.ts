import { describe, expect, it } from "vitest";
import { buildCoastIndex, withinNmOfLand } from "./coast.js";

// A straight coast along lat 40 from lon 0 to 2 (one ring, as the coastline file gives it).
const coast = buildCoastIndex([
  [
    { lat: 40, lon: 0 },
    { lat: 40, lon: 2 },
  ],
]);

describe("withinNmOfLand", () => {
  it("point 5 nm off a coast is within 12", () => {
    expect(withinNmOfLand({ lat: 40 + 5 / 60, lon: 1 }, coast, 12)).toBe(true);
  });

  it("point 20 nm off is not", () => {
    expect(withinNmOfLand({ lat: 40 + 20 / 60, lon: 1 }, coast, 12)).toBe(false);
  });

  it("segment in a neighbouring cell counts", () => {
    // Past the coast's east end (lon 2): 6 nm east of the end point, in the next 1° cell.
    const east = 2 + 6 / (60 * Math.cos((40 * Math.PI) / 180));
    expect(withinNmOfLand({ lat: 40, lon: east }, coast, 12)).toBe(true);
    expect(withinNmOfLand({ lat: 40, lon: east }, coast, 5)).toBe(false);
  });
});
