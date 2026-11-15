import { currentVoyage, generateWorld, voyageState } from "@pharos/db";
import {
  buildRouteGraph,
  candidateRoutes,
  greatCircleNm,
  pointAlongPolyline,
  polylineNm,
} from "@pharos/domain";
import { describe, expect, it } from "vitest";
import { RECORDED_DIR, syntheticHazards } from "./recorded.js";
import { loadSeaNetwork } from "./routes/network.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
const vessel = world.vessels.find((v) => v.name.includes("Thessaly Star"));
if (!vessel) throw new Error("the seed world has no Thessaly Star");
const voyage = currentVoyage(world, vessel.id);
if (!voyage) throw new Error("Thessaly Star has no current voyage");
const { report } = voyageState(world, voyage.id);
const destination = world.ports.find((p) => p.id === voyage.destinationPortId);
if (!destination) throw new Error("destination port missing");
const shortest = candidateRoutes(
  buildRouteGraph(loadSeaNetwork().segments),
  { lat: report.lat, lon: report.lon },
  { lat: destination.lat, lon: destination.lon },
)[0];
if (!shortest) throw new Error("no candidate route");
const FRACTION = 0.4;
const expected = pointAlongPolyline(shortest.points, polylineNm(shortest.points) * FRACTION);

describe("synthetic hazard fixture", () => {
  it("is one labelled entry on Thessaly Star's shortest sea route, 40 % along it", () => {
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
    expect(greatCircleNm({ lat: h?.lat ?? 0, lon: h?.lon ?? 0 }, expected)).toBeLessThan(1);
  });

  it.skipIf(!process.env.PRINT_SYNTHETIC)("prints the coordinates", () => {
    console.log(JSON.stringify({ lat: Math.round(expected.lat * 1e4) / 1e4, lon: Math.round(expected.lon * 1e4) / 1e4 }));
  });
});
