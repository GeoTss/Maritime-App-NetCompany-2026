import { describe, expect, it } from "vitest";
import { publicShips } from "./map-data";
import { TRAFFIC, VESSELS } from "./map-fixtures";
import { pickShipMmsi } from "./map-view";

const click = (target: Element | null, mmsi: unknown) =>
  ({
    originalEvent: { target },
    features: [{ properties: { mmsi } }],
  }) as never;

describe("pickShipMmsi", () => {
  it("ignores a click that landed inside an HTML marker", () => {
    const marker = document.createElement("div");
    marker.className = "maplibregl-marker";
    const button = document.createElement("button");
    marker.append(button);
    expect(pickShipMmsi(click(button, "999000001"))).toBeNull();
  });

  it("keeps the canvas click on a feature with an mmsi", () => {
    const canvas = document.createElement("canvas");
    expect(pickShipMmsi(click(canvas, "211121690"))).toBe("211121690");
  });
});

describe("publicShips", () => {
  it("drops traffic whose mmsi is a fleet vessel and keeps the rest", () => {
    const first = TRAFFIC.items[0];
    if (!first) throw new Error("fixture needs a ship");
    const twin = { ...first, mmsi: VESSELS[0]?.mmsi ?? "" };
    const out = publicShips([twin, ...TRAFFIC.items], VESSELS);
    expect(out.map((s) => s.mmsi)).toEqual(TRAFFIC.items.map((s) => s.mmsi));
  });
});
