import {
  buildRouteGraph,
  draughtLoad,
  optimiseRouteSpeed,
  REFERENCE_VESSEL_PROFILES,
  RouteError,
  remainingRoutePoints,
  routeHazardIds,
  sailedNmAt,
  voyageLoad,
  withLoad,
} from "@pharos/domain";
import { type AisTraffic, type LatLon, type Port, RouteSpeedInput } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { fleetRoutePlan, shipRoutePlan } from "./route-plan.js";
import { voyageState } from "./seed/demo-plan.js";
import { generateWorld } from "./seed/world.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
const p = (lat: number, lon: number): LatLon => ({ lat, lon });

/*
 * A small hand-built sea network from the eastern Mediterranean to Rotterdam: one main lane, and a
 * southern branch between (35.5, 18) and (36, -5.5). Aegean Pioneer's noon position (33.14, 27.02)
 * is about 34 nm from the first node; Rotterdam (51.92, 4.5) about 15 nm from the last.
 */
const MAIN = [
  p(33.5, 26.5),
  p(35.5, 18),
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
const SOUTH = [p(35.5, 18), p(34, 12.5), p(36.3, 4), p(36, -5.5)];
const graph = buildRouteGraph([MAIN, SOUTH]);
/** The same lanes moved into the Pacific: nothing within reach. */
const farGraph = buildRouteGraph([MAIN.map((q) => p(q.lat - 60, -150 + q.lon))]);

const port = (code: string): Port => {
  const found = world.ports.find((x) => x.unlocode === code);
  if (!found) throw new Error(`no port ${code}`);
  return found;
};
const pioneer = () => {
  const vessel = world.vessels.find((v) => v.name === "MV Aegean Pioneer");
  const voyage = world.voyages.find((v) => v.vesselId === vessel?.id && v.voyageNo === "AP-2611");
  if (!voyage) throw new Error("no AP-2611");
  return voyage;
};

describe("fleetRoutePlan", () => {
  it("Aegean Pioneer: planned route A at 12.5 kn, arriveBy at the discharge window end", () => {
    const voyage = pioneer();
    const plan = fleetRoutePlan(world, voyage.id, graph, null);
    const { path, report } = voyageState(world, voyage.id);
    const discharge = world.portCalls.find(
      (c) => c.voyageId === voyage.id && c.purpose === "discharge",
    );

    expect(plan.subject).toBe("MV Aegean Pioneer");
    expect(plan.destination.unlocode).toBe("NLRTM");
    expect(plan.profile).toBe("own");
    const { input } = plan;
    expect(input.startAt).toBe(report.ts.toISOString());
    expect(input.candidates[0]).toEqual({
      id: "A",
      label: "Planned route",
      points: remainingRoutePoints(path, sailedNmAt(path, report.ts)),
    });
    expect(input.baseline).toEqual({ candidateId: "A", speedKn: 12.5 });
    expect(input.arriveBy).toBe(discharge?.berthWindowEnd?.toISOString());
    expect(input.notBefore).toBe(discharge?.berthWindowStart?.toISOString());
    expect(input.arriveBy).toBe("2026-11-27T05:56:09.600Z");
    expect(input.curve).toEqual(path.curve);
    expect(input.dailyCostUsd).toBe(16_000);
    expect(input.speedStepKn).toBe(0.5);
    expect(input.stepNm).toBe(20);
    // Port Said (non-EU) → Rotterdam (EU): coverage 0.5; the world's anchor year and seeded rates.
    expect(input.etsCoverage).toBe(0.5);
    expect(input.market).toEqual({ euaPriceEur: 75, eurUsd: 1.08, year: 2026 });
    expect(input.weather).toBeNull();
    expect(() => RouteSpeedInput.parse(input)).not.toThrow();
  });

  it("a fleet plan carries the voyage's load from cargo and ballast, not a draught", () => {
    const voyage = pioneer();
    const vessel = world.vessels.find((v) => v.id === voyage.vesselId);
    if (!vessel) throw new Error("no vessel");
    const plan = fleetRoutePlan(world, voyage.id, graph, null);
    expect(plan.input.curve).toEqual(withLoad(vessel.consumptionCurve, voyageLoad(vessel, voyage)));
    expect(plan.loadCondition).toBeNull();
  });

  it("adds the shortest and an alternative sea route from the graph as B and C", () => {
    const plan = fleetRoutePlan(world, pioneer().id, graph, null);
    const [a, b, c] = plan.input.candidates;
    expect(plan.input.candidates.map((x) => [x.id, x.label])).toEqual([
      ["A", "Planned route"],
      ["B", "Shortest sea route"],
      ["C", "Alternative sea route"],
    ]);
    const rotterdam = port("NLRTM");
    for (const x of [b, c]) {
      expect(x?.points[0]).toEqual(a?.points[0]);
      expect(x?.points.at(-1)).toEqual({ lat: rotterdam.lat, lon: rotterdam.lon });
    }
    const result = optimiseRouteSpeed(plan.input);
    expect(result.options.map((o) => o.candidateId)).toEqual(["A", "B", "C"]);
    expect(result.baseline.speedKn).toBe(12.5);
  });

  it("leaves only the planned route when the graph cannot route the voyage", () => {
    const plan = fleetRoutePlan(world, pioneer().id, farGraph, null);
    expect(plan.input.candidates.map((x) => x.id)).toEqual(["A"]);
  });

  it("prices fuel at the destination port's latest index price per grade", () => {
    const rotterdam = port("NLRTM");
    const latest = (grade: "LSMGO" | "VLSFO" | "HSFO") =>
      world.portFuelPrices.find((x) => x.portId === rotterdam.id && x.grade === grade)
        ?.priceUsdPerMt;
    const plan = fleetRoutePlan(world, pioneer().id, graph, null);
    expect(plan.input.fuelPriceUsdPerMt).toEqual({
      LSMGO: latest("LSMGO"),
      VLSFO: latest("VLSFO"),
      HSFO: latest("HSFO"),
    });
    // A newer row for one grade replaces it.
    const newer = structuredClone(world);
    newer.portFuelPrices.push({
      id: 10_000,
      portId: rotterdam.id,
      grade: "VLSFO",
      priceUsdPerMt: 999,
      asOf: new Date("2026-11-14T07:00:00Z"),
      source: "test",
    });
    expect(fleetRoutePlan(newer, pioneer().id, graph, null).input.fuelPriceUsdPerMt.VLSFO).toBe(
      999,
    );
  });

  it("clamps the baseline speed to the curve and rounds it to 0.5 kn", () => {
    const planAt = (plannedSpeedKn: number) => {
      const w = structuredClone(world);
      const v = w.voyages.find((x) => x.id === pioneer().id);
      if (!v) throw new Error("no voyage");
      v.plannedSpeedKn = plannedSpeedKn;
      return fleetRoutePlan(w, v.id, graph, null).input;
    };
    const { minSpeedKn, maxSpeedKn } = planAt(12.5).curve;
    expect(planAt(30).baseline.speedKn).toBe(maxSpeedKn);
    expect(planAt(1).baseline.speedKn).toBe(minSpeedKn);
    expect(planAt(12.3).baseline.speedKn).toBe(12.5);
    expect(planAt(12.2).baseline.speedKn).toBe(12);
  });

  it("passes hazards to the input; avoidedHazardIds names those the shortest route crosses", () => {
    // A node on the main lane, 10 nm radius; and a zone in the Pacific nobody passes.
    const onLane = { id: "h-lane", center: p(37.3, 11.5), radiusNm: 10 };
    const far = { id: "h-far", center: p(-30, -150), radiusNm: 10 };
    const none = fleetRoutePlan(world, pioneer().id, graph, null);
    expect(none.input.hazards).toEqual([]);
    expect(none.avoidedHazardIds).toEqual([]);
    const plan = fleetRoutePlan(world, pioneer().id, graph, null, [far, onLane]);
    expect(plan.input.hazards).toEqual([far, onLane]);
    expect(plan.avoidedHazardIds).toEqual(["h-lane"]);
    // The shortest sea route (B) goes round it by the southern branch.
    const b = plan.input.candidates.find((c) => c.id === "B");
    expect(routeHazardIds(b?.points ?? [], plan.input.stepNm, [onLane])).toEqual([]);
    expect(
      optimiseRouteSpeed(plan.input).options.find((o) => o.candidateId === "B")?.feasible,
    ).toBe(true);
  });

  it("passes the weather grid through", () => {
    const weather = {
      startAt: "2026-11-14T08:00:00.000Z",
      stepHours: 3,
      points: [],
    };
    expect(fleetRoutePlan(world, pioneer().id, graph, weather).input.weather).toEqual(weather);
  });
});

describe("shipRoutePlan", () => {
  const ship = (over: Partial<AisTraffic> = {}): AisTraffic => ({
    mmsi: "237000001",
    name: "TEST CARRIER",
    shipType: "cargo",
    lat: 35.6,
    lon: 17.5,
    sogKn: 11.3,
    navStatus: "under_way_using_engine",
    destination: "ALGECIRAS",
    draughtM: null,
    cogDeg: null,
    updatedAt: new Date("2026-11-14T07:30:00Z"),
    ...over,
  });
  const algeciras = port("ESALG");

  it("plans a public ship from its AIS position with the bulk carrier reference profile", () => {
    const plan = shipRoutePlan(world, ship(), algeciras, graph, null);
    const bulk = REFERENCE_VESSEL_PROFILES.bulk_carrier;
    expect(plan.subject).toBe("TEST CARRIER");
    expect(plan.profile).toBe("bulk_carrier");
    expect(plan.destination).toEqual(algeciras);
    const { input } = plan;
    expect(input.startAt).toBe("2026-11-14T07:30:00.000Z");
    expect(input.candidates[0]?.id).toBe("A");
    expect(input.candidates[0]?.points[0]).toEqual({ lat: 35.6, lon: 17.5 });
    expect(input.candidates[0]?.points.at(-1)).toEqual({ lat: algeciras.lat, lon: algeciras.lon });
    // 11.3 kn rounds to 11.5 on the 0.5 kn grid.
    expect(input.baseline).toEqual({ candidateId: "A", speedKn: 11.5 });
    // No draught reported: assumed laden at full load (factor 1).
    expect(plan.loadCondition).toBe("assumed_laden");
    expect(input.curve).toEqual(withLoad(bulk.curve, draughtLoad(bulk, null).load));
    expect(input.dailyCostUsd).toBe(bulk.dailyCostUsd);
    expect(input.arriveBy).toBeNull();
    expect(input.notBefore).toBeNull();
    // Algeciras is in the EU: half the voyage is covered.
    expect(input.etsCoverage).toBe(0.5);
    expect(input.market).toEqual({ euaPriceEur: 75, eurUsd: 1.08, year: 2026 });
    expect(() => RouteSpeedInput.parse(input)).not.toThrow();
  });

  it("reads the load from the AIS draught against the reference profile", () => {
    const bulk = REFERENCE_VESSEL_PROFILES.bulk_carrier;
    const light = shipRoutePlan(
      world,
      ship({ draughtM: bulk.ballastDraughtM }),
      algeciras,
      graph,
      null,
    );
    expect(light.loadCondition).toBe("ballast");
    expect(light.input.curve.load).toEqual({
      displacementMt: bulk.lightshipMt + bulk.ballastMt,
      refDisplacementMt: bulk.lightshipMt + bulk.dwtMt,
    });
    const deep = shipRoutePlan(
      world,
      ship({ draughtM: bulk.ladenDraughtM }),
      algeciras,
      graph,
      null,
    );
    expect(deep.loadCondition).toBe("laden");
    expect(shipRoutePlan(world, ship({ draughtM: 0 }), algeciras, graph, null).loadCondition).toBe(
      "assumed_laden",
    );
    // A ship in ballast burns less on the same route at the same speed.
    const lightR = optimiseRouteSpeed(light.input).baseline;
    const deepR = optimiseRouteSpeed(deep.input).baseline;
    expect(lightR.totalFuelMt).toBeLessThan(deepR.totalFuelMt);
  });

  it("a ship at 3 kn gets the reference speed", () => {
    const plan = shipRoutePlan(world, ship({ sogKn: 3 }), algeciras, graph, null);
    expect(plan.input.baseline.speedKn).toBe(13);
    expect(
      shipRoutePlan(world, ship({ sogKn: null }), algeciras, graph, null).input.baseline.speedKn,
    ).toBe(13);
  });

  it("clamps a fast ship to the top of the curve", () => {
    const plan = shipRoutePlan(world, ship({ sogKn: 16.2 }), algeciras, graph, null);
    expect(plan.input.baseline.speedKn).toBe(14.5);
  });

  it("a tanker gets the tanker profile", () => {
    const plan = shipRoutePlan(world, ship({ shipType: "tanker" }), algeciras, graph, null);
    expect(plan.profile).toBe("tanker");
    const tanker = REFERENCE_VESSEL_PROFILES.tanker;
    expect(plan.input.curve).toEqual(withLoad(tanker.curve, draughtLoad(tanker, null).load));
    expect(plan.input.dailyCostUsd).toBe(REFERENCE_VESSEL_PROFILES.tanker.dailyCostUsd);
  });

  it("no ETS coverage for a non-EU destination; an unnamed ship goes by its MMSI", () => {
    const plan = shipRoutePlan(world, ship({ name: null }), port("GIGIB"), graph, null);
    expect(plan.input.etsCoverage).toBe(0);
    expect(plan.subject).toBe("MMSI 237000001");
  });

  it("passes hazards through and lists those the unconstrained shortest route crosses", () => {
    const onLane = { id: "h-lane", center: p(37.3, 11.5), radiusNm: 10 };
    const plan = shipRoutePlan(world, ship(), algeciras, graph, null, [onLane]);
    expect(plan.input.hazards).toEqual([onLane]);
    expect(plan.avoidedHazardIds).toEqual(["h-lane"]);
    expect(shipRoutePlan(world, ship(), algeciras, graph, null).avoidedHazardIds).toEqual([]);
    expect(shipRoutePlan(world, ship(), algeciras, graph, null).input.hazards).toEqual([]);
  });

  it("a RouteError from the graph propagates", () => {
    expect(() => shipRoutePlan(world, ship(), algeciras, farGraph, null)).toThrow(RouteError);
    const there = ship({ lat: algeciras.lat, lon: algeciras.lon });
    expect(() => shipRoutePlan(world, there, algeciras, graph, null)).toThrow(RouteError);
  });
});
