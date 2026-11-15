import { currentVoyage, generateWorld, voyageState } from "@pharos/db";
import {
  greatCircleNm,
  pointAlongPolyline,
  remainingRoutePoints,
  sailedNmAt,
} from "@pharos/domain";
import { describe, expect, it } from "vitest";
import { RECORDED_DIR, syntheticHazards } from "./recorded.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
const vessel = world.vessels.find((v) => v.name.includes("Thessaly Star"));
if (!vessel) throw new Error("the seed world has no Thessaly Star");
const voyage = currentVoyage(world, vessel.id);
if (!voyage) throw new Error("Thessaly Star has no current voyage");
const { path, report } = voyageState(world, voyage.id);
const route = remainingRoutePoints(path, sailedNmAt(path, report.ts));
const AHEAD_NM = 150;

describe("synthetic hazard fixture", () => {
  it("is one labelled entry on Thessaly Star's remaining route, 150 nm ahead of its noon report", () => {
    const [h, ...rest] = syntheticHazards(RECORDED_DIR, new Date("2026-11-14T08:00:00Z"));
    expect(rest).toEqual([]);
    expect(h).toMatchObject({
      id: "synthetic:1",
      kind: "synthetic",
      source: "synthetic",
      mmsi: null,
      radiusNm: 25,
      label: "SYNTHETIC TEST HAZARD — drifting container reported (demo data)",
    });
    const expected = pointAlongPolyline(route, AHEAD_NM);
    expect(greatCircleNm({ lat: h!.lat, lon: h!.lon }, expected)).toBeLessThan(1);
    expect(
      greatCircleNm({ lat: h!.lat, lon: h!.lon }, { lat: report.lat, lon: report.lon }),
    ).toBeGreaterThan(100);
  });
});
