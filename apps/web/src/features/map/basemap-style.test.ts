import { describe, expect, it } from "vitest";
import { buildBasemapStyle, DEMO_VIEW, type MapColors } from "./basemap-style";

const colors: MapColors = {
  sea: "rgb(1 1 1)",
  land: "rgb(2 2 2)",
  coast: "rgb(3 3 3)",
  traffic: "rgb(4 4 4)",
  wave0: "rgb(12 12 12)",
  wave1: "rgb(13 13 13)",
  wave2: "rgb(14 14 14)",
  wave3: "rgb(15 15 15)",
  plan: "rgb(6 6 6)",
  alarm: "rgb(7 7 7)",
  storm: "rgb(16 16 16)",
  beacon: "rgb(9 9 9)",
  caution: "rgb(10 10 10)",
  text: "rgb(11 11 11)",
};

describe("buildBasemapStyle", () => {
  const style = buildBasemapStyle(colors, "http://localhost/basemap.generated.geojson");

  it("is offline: no glyphs, no sprite, no tile urls", () => {
    expect(style).not.toHaveProperty("glyphs");
    expect(style).not.toHaveProperty("sprite");
    const text = JSON.stringify(style);
    expect(text).not.toMatch(/tiles|https?:\/\/(?!localhost)/);
    expect(Object.values(style.sources).every((s) => s.type === "geojson")).toBe(true);
  });

  it("draws sea, land and coast from the token colours", () => {
    const byId = Object.fromEntries(style.layers.map((l) => [l.id, l]));
    expect(byId.sea?.paint).toMatchObject({ "background-color": colors.sea });
    expect(byId.land?.paint).toMatchObject({ "fill-color": colors.land });
    expect(byId.coast?.paint).toMatchObject({ "line-color": colors.coast });
    expect(style.layers.some((l) => l.type === "symbol")).toBe(false);
  });

  it("starts framed on the Mediterranean inside the demo region", () => {
    expect(DEMO_VIEW.longitude).toBeGreaterThan(-20);
    expect(DEMO_VIEW.longitude).toBeLessThan(45);
    expect(DEMO_VIEW.latitude).toBeGreaterThan(25);
    expect(DEMO_VIEW.latitude).toBeLessThan(66);
  });
});
