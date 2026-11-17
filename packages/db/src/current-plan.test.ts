import {
  buildRouteGraph,
  nearestAlongNm,
  projectFuelAlongTrack,
  remainingRoutePoints,
  sailedNmAt,
} from "@pharos/domain";
import type { LatLon } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { currentPlanFuel, waitingHoursAt } from "./current-plan.js";
import { fleetRoutePlan } from "./route-plan.js";
import { buildBunkerPlanInput, demoOffers, voyageState } from "./seed/demo-plan.js";
import { DEMO_SCENARIO } from "./seed/scenario.js";
import { generateWorld } from "./seed/world.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
const p = (lat: number, lon: number): LatLon => ({ lat, lon });
const MAIN = [
  p(33.5, 26.5),
  p(35.5, 18),
  p(35.9, 14.6),
  p(37.3, 11.5),
  p(37.6, 8),
  p(36, -5.5),
  p(36.5, -9.5),
  p(43.5, -10),
  p(48.5, -5.8),
  p(49.9, -2),
  p(51, 1.6),
  p(51.95, 4.1),
];
const graph = buildRouteGraph([MAIN]);
const farGraph = buildRouteGraph([MAIN.map((q) => p(q.lat - 60, -150 + q.lon))]);

const pioneer = () => {
  const voyage = world.voyages.find((v) => v.voyageNo === "AP-2611");
  if (!voyage) throw new Error("no AP-2611");
  return voyage;
};
const portId = (code: string): number => {
  const port = world.ports.find((x) => x.unlocode === code);
  if (!port) throw new Error(`no port ${code}`);
  return port.id;
};
const opts = { congestion: "seed" as const, offers: demoOffers(world), fixedOrder: null };

describe("currentPlanFuel", () => {
  it("matches the projection on the planned polyline", () => {
    const voyage = pioneer();
    const { path, report } = voyageState(world, voyage.id);
    const byHand = projectFuelAlongTrack({
      startAt: report.ts.toISOString(),
      points: remainingRoutePoints(path, sailedNmAt(path, report.ts)),
      speedKn: voyage.plannedSpeedKn,
      stepNm: 20,
      curve: path.curve,
      weather: null,
      robMt: report.robMt,
      safetyMarginDays: DEMO_SCENARIO.safetyMarginDays,
      stop: null,
      probesNm: [],
    });
    const fuel = currentPlanFuel(world, voyage.id, null);
    expect(Math.abs(fuel.grades.LSMGO.neededMt - byHand.grades.LSMGO.neededMt)).toBeLessThan(1e-9);
    expect(fuel.grades.LSMGO.marginMt).toBeGreaterThan(0);
  });
});

describe("waitingHoursAt", () => {
  it("uses the seeded row when pinned and the latest AIS row otherwise", () => {
    const id = portId("MTMLA");
    const withAis = {
      ...world,
      portCongestion: [
        ...world.portCongestion,
        {
          id: 9999,
          portId: id,
          observedAt: new Date("2026-11-14T07:00:00Z"),
          anchoredCount: 6,
          waitingHours: 9,
          source: "ais" as const,
        },
      ],
    };
    expect(waitingHoursAt(withAis, id, "seed")).toBe(4);
    expect(waitingHoursAt(withAis, id, "latest")).toBe(9);
    expect(waitingHoursAt(world, id, "latest")).toBe(4);
  });
});

describe("fleetRoutePlan with fuel and stops", () => {
  it("fills the fuel on board and builds one stop candidate per offer through the port", () => {
    const voyage = pioneer();
    const plan = fleetRoutePlan(world, voyage.id, graph, null, [], opts);
    expect(plan.input.fuel?.robMt).toEqual(voyageState(world, voyage.id).report.robMt);
    expect(plan.input.stops.map((s) => s.optionId).sort()).toEqual(
      DEMO_SCENARIO.options.map((o) => o.optionId).sort(),
    );
    for (const s of plan.input.stops) {
      const port = world.ports.find((x) => x.id === s.portId);
      expect(s.routeError).toBeNull();
      expect(s.points[s.stopPointIndex]).toEqual({ lat: port?.lat, lon: port?.lon });
      expect(s.qtyMt).toBe(300);
      expect(s.waitingHours).toBe(waitingHoursAt(world, s.portId, "seed"));
    }
  });

  it("fixes the stop to an approved order", () => {
    const voyage = pioneer();
    const plan = fleetRoutePlan(world, voyage.id, graph, null, [], {
      ...opts,
      fixedOrder: { recommendationId: 7, optionId: "MTMLA-kestrel", qtyMt: 250 },
    });
    expect(plan.input.stops).toHaveLength(1);
    expect(plan.input.stops[0]?.orderRecommendationId).toBe(7);
    expect(plan.input.stops[0]?.qtyMt).toBe(250);
  });

  it("reports a port the graph cannot reach", () => {
    const voyage = pioneer();
    const plan = fleetRoutePlan(world, voyage.id, farGraph, null, [], opts);
    for (const s of plan.input.stops) {
      expect(["off_network", "no_path"]).toContain(s.routeError);
      expect(s.stopPointIndex).toBe(1);
    }
  });

  it("has no stops without offers", () => {
    const voyage = pioneer();
    const plan = fleetRoutePlan(world, voyage.id, graph, null, [], { ...opts, offers: [] });
    expect(plan.input.stops).toEqual([]);
    expect(plan.input.fuel).not.toBeNull();
  });
});

describe("buildBunkerPlanInput", () => {
  it("takes fuel at arrival from the planned track", () => {
    const voyage = pioneer();
    const input = buildBunkerPlanInput(world, voyage.id, demoOffers(world), undefined, {
      weather: null,
      congestion: "seed",
    });
    const { path, report } = voyageState(world, voyage.id);
    const planned = remainingRoutePoints(path, sailedNmAt(path, report.ts));
    const malta = world.ports.find((x) => x.unlocode === "MTMLA");
    if (!malta) throw new Error("no MTMLA");
    const along = nearestAlongNm(planned, malta).nm;
    const probe = currentPlanFuel(world, voyage.id, null, [along]).probes[0];
    const option = input.options.find((o) => o.optionId === "MTMLA-kestrel");
    expect(option?.robAtArrivalMt).toBeCloseTo(probe?.robMt.LSMGO ?? -1, 9);
    expect(input.minQtyMt).toBeCloseTo(
      currentPlanFuel(world, voyage.id, null).grades.LSMGO.shortfallMt,
      9,
    );
  });
});
