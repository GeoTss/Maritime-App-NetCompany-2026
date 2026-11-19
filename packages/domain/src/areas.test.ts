import { describe, expect, it } from "vitest";
import { areaPasses } from "./areas.js";
import { greatCircleNm } from "./geo.js";

const line = [
  { lat: 36, lon: -10 },
  { lat: 36, lon: 10 },
];
const box = (minLon: number, maxLon: number) => ({ minLat: 35, maxLat: 37, minLon, maxLon });

describe("areaPasses", () => {
  it("lists the areas a route enters in order, with where it enters", () => {
    const passes = areaPasses(line, 20, [
      { id: "east", boxes: [box(3, 5)] },
      { id: "west", boxes: [box(-5, -3)] },
    ]);
    expect(passes.map((p) => p.areaId)).toEqual(["west", "east"]);
    const toWest = greatCircleNm(line[0] as never, { lat: 36, lon: -5 });
    expect(Math.abs((passes[0]?.enterNm ?? 0) - toWest)).toBeLessThanOrEqual(20);
  });

  it("is empty when the route misses every area", () => {
    expect(
      areaPasses(line, 20, [{ id: "north", boxes: [{ ...box(-5, 5), minLat: 50, maxLat: 52 }] }]),
    ).toEqual([]);
  });
});
