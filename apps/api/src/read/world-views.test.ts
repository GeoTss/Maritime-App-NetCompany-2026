import { generateWorld } from "@pharos/db";
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

  it("computes the alert in calm water without a weather snapshot", () => {
    const pioneer = buildVessels(world, NOW, null).find(
      (v) => v.summary.name === "MV Aegean Pioneer",
    );
    expect(pioneer?.summary.alerts).toEqual(["lsmgo_runs_out"]);
  });
});
