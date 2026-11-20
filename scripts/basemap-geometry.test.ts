import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Ring, splitAtAntimeridian } from "./basemap-geometry.js";

const lonJumps = (ring: Ring) =>
  ring.some((p, i) => i > 0 && Math.abs(p[0] - (ring[i - 1] as [number, number])[0]) > 180);

describe("splitAtAntimeridian", () => {
  it("polygon without a jump is returned as is", () => {
    const square: Ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    expect(splitAtAntimeridian([square])).toEqual([[square]]);
  });

  it("ring over the antimeridian splits in two", () => {
    const ring: Ring = [
      [170, 60],
      [179, 60],
      [-179, 60],
      [-170, 60],
      [-170, 70],
      [-179, 70],
      [179, 70],
      [170, 70],
      [170, 60],
    ];
    const parts = splitAtAntimeridian([ring]);
    expect(parts).toHaveLength(2);
    const lons = parts.map((p) => (p[0] as Ring).map(([lon]) => lon));
    for (const [k, part] of parts.entries()) {
      const outer = part[0] as Ring;
      expect(lonJumps(outer)).toBe(false);
      expect(outer[0]).toEqual(outer[outer.length - 1]);
      for (const lon of lons[k] as number[]) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    }
    const maxes = lons.map((l) => Math.max(...l));
    const mins = lons.map((l) => Math.min(...l));
    expect(maxes).toContain(180);
    expect(mins).toContain(-180);
  });

  it("a hole stays with the part of the ring it lies in", () => {
    // The ring starts on the far side of the antimeridian (as Eurasia's does, in Chukotka).
    const outer: Ring = [
      [-175, 60],
      [-170, 60],
      [-170, 70],
      [-179, 70],
      [179, 70],
      [160, 70],
      [160, 60],
      [179, 60],
      [-179, 60],
      [-175, 60],
    ];
    const hole: Ring = [
      [165, 63],
      [170, 63],
      [170, 67],
      [165, 67],
      [165, 63],
    ];
    const parts = splitAtAntimeridian([outer, hole]);
    const main = parts.find((p) => (p[0] as Ring).some(([lon]) => lon === 160));
    expect(main).toHaveLength(2);
    const kept = (main ?? [])[1] ?? [];
    expect(kept.map(([lon]) => lon)).toEqual([165, 170, 170, 165, 165]);
  });
});

describe("the generated basemap", () => {
  it("generated basemap has no antimeridian edge", () => {
    const file = JSON.parse(
      readFileSync(
        new URL("../apps/web/public/basemap.generated.geojson", import.meta.url),
        "utf8",
      ),
    ) as { features: { geometry: { coordinates: Ring[][] } }[] };
    for (const polygon of file.features[0]?.geometry.coordinates ?? []) {
      for (const ring of polygon) {
        expect(lonJumps(ring)).toBe(false);
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });
});
