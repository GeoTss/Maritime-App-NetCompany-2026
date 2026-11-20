import { describe, expect, it } from "vitest";
import { stormArea, stormsOf } from "./storm-layer";

const box = (lat: number, lon: number) => ({
  minLat: lat - 1,
  maxLat: lat + 1,
  minLon: lon - 1,
  maxLon: lon + 1,
});

describe("stormArea", () => {
  it("draws one outline round adjacent squares: the shared edge is left out", () => {
    const { squares, outline } = stormArea([box(46, -8), box(46, -6)]);
    expect(squares).toHaveLength(2);
    // Two squares have 8 edges; the one they share goes, so 6 remain.
    expect(outline).toHaveLength(6);
    const shared = outline.some((e) => e.every(([lon]) => lon === -7));
    expect(shared).toBe(false);
  });

  it("keeps every edge of squares that do not touch", () => {
    expect(stormArea([box(46, -8), box(50, -2)]).outline).toHaveLength(8);
    expect(stormArea([]).outline).toEqual([]);
  });
});

describe("stormsOf", () => {
  const cell = (id: string, lat: number, lon: number) => ({
    id,
    center: { lat, lon },
    radiusNm: 80,
    maxWaveHeightM: 8,
    from: "2026-11-14T08:00:00.000Z",
    to: "2026-11-15T08:00:00.000Z",
    box: box(lat, lon),
  });
  it("squares that touch, edge or corner, are one storm; apart, two", () => {
    const cells = [cell("a", 34, 20), cell("b", 34, 22), cell("c", -10, -2), cell("d", -12, 0)];
    expect(stormsOf(cells)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
