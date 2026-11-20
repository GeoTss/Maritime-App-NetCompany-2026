import { currentPlanFuel, currentVoyage, generateWorld } from "@pharos/db";
import { recordedLiveData } from "@pharos/integrations";
import { describe, expect, it } from "vitest";
import { buildVessels } from "./world-views.js";

const ANCHOR = new Date("2026-11-14T08:00:00Z");
const NOW = new Date("2026-11-14T08:05:00Z");
const world = generateWorld({ seed: 20261114, anchor: ANCHOR });

describe("buildVessels alerts", () => {
  it("alerts Aegean Pioneer from the current plan's fuel", () => {
    const { weather } = recordedLiveData({ anchor: ANCHOR, ports: world.ports });
    const vessels = buildVessels(world, NOW, weather);
    const pioneer = vessels.find((v) => v.summary.name === "MV Aegean Pioneer");
    expect(pioneer?.summary.alerts).toEqual(["lsmgo_runs_out"]);
    // Every other fleet vessel keeps its LSMGO margin on its current plan.
    const others = vessels.filter((v) => v.summary.name !== "MV Aegean Pioneer");
    expect(others.length).toBeGreaterThan(0);
    for (const v of others) expect(v.summary.alerts, v.summary.name).toEqual([]);
  });

  it("the detail carries the track the alert reads: the one fuel calculation", () => {
    const { weather } = recordedLiveData({ anchor: ANCHOR, ports: world.ports });
    const vessels = buildVessels(world, NOW, weather);
    for (const { summary, detail } of vessels) {
      const voyage = currentVoyage(world, summary.id);
      expect(detail.fuelTrack, summary.name).toEqual(
        voyage ? currentPlanFuel(world, voyage.id, weather) : null,
      );
    }
    // The recorded demo: what get_vessel_status cites for Aegean Pioneer's LSMGO.
    const pioneer = vessels.find((v) => v.summary.name === "MV Aegean Pioneer");
    const lsmgo = pioneer?.detail.fuelTrack?.grades.LSMGO;
    expect(lsmgo?.shortfallMt).toBeCloseTo(71.57, 2);
    expect(lsmgo?.belowMarginAt?.nm).toBeCloseTo(1482.77, 2);
    expect(lsmgo?.runsDryAt?.nm).toBeCloseTo(3117.84, 2);
    expect(pioneer?.detail).not.toHaveProperty("fobProjection");
  });

  it("computes the alert in calm water without a weather snapshot", () => {
    const pioneer = buildVessels(world, NOW, null).find(
      (v) => v.summary.name === "MV Aegean Pioneer",
    );
    expect(pioneer?.summary.alerts).toEqual(["lsmgo_runs_out"]);
  });
});
