import type { NavHazard } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { activeHazardZones, zonesContaining } from "./hazards.js";

const NOW = new Date("2026-11-15T12:00:00Z");
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

const hazard = (over: Partial<NavHazard>): NavHazard => ({
  id: "h",
  kind: "distress_beacon",
  source: "ais",
  mmsi: "970000001",
  lat: 36,
  lon: 10,
  label: "test",
  radiusNm: null,
  observedAt: NOW,
  ...over,
});

describe("activeHazardZones", () => {
  it("uses the default radius of each kind: 5, 10, 2, 10 nm", () => {
    const zones = activeHazardZones(
      [
        hazard({ id: "a", kind: "distress_beacon" }),
        hazard({ id: "b", kind: "sar_aircraft" }),
        hazard({ id: "c", kind: "aton" }),
        hazard({ id: "d", kind: "safety_message" }),
      ],
      NOW,
    );
    expect(zones.map((z) => [z.id, z.radiusNm])).toEqual([
      ["a", 5],
      ["b", 10],
      ["c", 2],
      ["d", 10],
    ]);
    expect(zones[0]?.center).toEqual({ lat: 36, lon: 10 });
  });

  it("drops an expired distress beacon (24 h) and keeps one 23 h old", () => {
    const zones = activeHazardZones(
      [
        hazard({ id: "old", observedAt: hoursAgo(24) }),
        hazard({ id: "fresh", observedAt: hoursAgo(23) }),
      ],
      NOW,
    );
    expect(zones.map((z) => z.id)).toEqual(["fresh"]);
  });

  it("lifetimes: SAR aircraft 6 h, aton 72 h, safety message 24 h", () => {
    const ids = (hours: number) =>
      activeHazardZones(
        [
          hazard({ id: "sar", kind: "sar_aircraft", observedAt: hoursAgo(hours) }),
          hazard({ id: "aton", kind: "aton", observedAt: hoursAgo(hours) }),
          hazard({ id: "msg", kind: "safety_message", observedAt: hoursAgo(hours) }),
        ],
        NOW,
      ).map((z) => z.id);
    expect(ids(5.9)).toEqual(["aton", "msg", "sar"]);
    expect(ids(6)).toEqual(["aton", "msg"]);
    expect(ids(24)).toEqual(["aton"]);
    expect(ids(72)).toEqual([]);
  });

  it("a synthetic hazard never expires", () => {
    const zones = activeHazardZones(
      [hazard({ id: "s", kind: "synthetic", source: "synthetic", observedAt: hoursAgo(9999) })],
      NOW,
    );
    expect(zones.map((z) => z.id)).toEqual(["s"]);
  });

  it("a set radius wins over the kind's default", () => {
    const zones = activeHazardZones([hazard({ radiusNm: 12.5 })], NOW);
    expect(zones[0]?.radiusNm).toBe(12.5);
  });

  it("sorts by id and does not depend on input order", () => {
    const a = hazard({ id: "b" });
    const b = hazard({ id: "a" });
    expect(activeHazardZones([a, b], NOW).map((z) => z.id)).toEqual(["a", "b"]);
    expect(activeHazardZones([b, a], NOW)).toEqual(activeHazardZones([a, b], NOW));
  });

  it("is empty for no hazards", () => {
    expect(activeHazardZones([], NOW)).toEqual([]);
  });
});

describe("zonesContaining", () => {
  // 1° of latitude = 3440.065 × π/180 = 60.04 nm.
  const zones = [
    { id: "z1", center: { lat: 0, lon: 0 }, radiusNm: 61 },
    { id: "z2", center: { lat: 0, lon: 0 }, radiusNm: 59 },
  ];
  it("is true when the distance is within the radius", () => {
    expect(zonesContaining({ lat: 1, lon: 0 }, zones)).toEqual(["z1"]);
    expect(zonesContaining({ lat: 0, lon: 0 }, zones)).toEqual(["z1", "z2"]);
    expect(zonesContaining({ lat: 2, lon: 0 }, zones)).toEqual([]);
  });
});
