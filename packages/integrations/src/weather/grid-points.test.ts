import { describe, expect, it } from "vitest";
import { gridPoints } from "./grid-points.js";

describe("gridPoints", () => {
  it("covers the demo region with 14 x 24 = 336 points", () => {
    const pts = gridPoints();
    expect(pts).toHaveLength(336);
    expect(pts[0]).toEqual({ lat: 30, lon: -12 });
    expect(pts.at(-1)).toEqual({ lat: 56, lon: 34 });
  });
});
