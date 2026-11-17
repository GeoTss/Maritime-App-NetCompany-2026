/**
 * The demo world's invariants for the joint route-and-bunker planner (R1–R6): pure, no database.
 * The pinned demo (seed 20261114, anchor 14 Nov 08:00Z) with the recorded weather and hazards,
 * seeded congestion and the three DEMO_SCENARIO offers.
 */
import {
  buildBunkerPlanInput,
  currentPlanFuel,
  demoOffers,
  fleetRoutePlan,
  generateWorld,
  pinnedNow,
} from "@pharos/db";
import {
  activeHazardZones,
  buildRouteGraph,
  evaluateRoute,
  optimiseRouteSpeed,
  planBunkers,
  polylineNm,
  projectFuelAlongTrack,
} from "@pharos/domain";
import { loadSeaNetwork, recordedLiveData } from "@pharos/integrations";
import { describe, expect, it } from "vitest";

const ANCHOR = new Date("2026-11-14T08:00:00Z");
const world = generateWorld({ seed: 20261114, anchor: ANCHOR });
const live = recordedLiveData({ anchor: ANCHOR, ports: world.ports });
const zones = activeHazardZones(live.hazards, pinnedNow(ANCHOR));
const graph = buildRouteGraph(loadSeaNetwork().segments);
const voyage = world.voyages.find((v) => v.voyageNo === "AP-2611");
if (!voyage) throw new Error("no AP-2611");
const offers = demoOffers(world);
const plan = fleetRoutePlan(world, voyage.id, graph, live.weather, zones, {
  congestion: "seed",
  offers,
  fixedOrder: null,
});
const result = optimiseRouteSpeed(plan.input);

describe("demo world: joint route-and-bunker invariants", () => {
  it("R1 alert: the current plan's LSMGO falls below its margin before Rotterdam", () => {
    const fuel = currentPlanFuel(world, voyage.id, live.weather);
    expect(fuel.grades.LSMGO.belowMarginAt).not.toBeNull();
  });

  it("R2 need: no route keeps the LSMGO margin at any speed that meets the berth window", () => {
    const { input } = plan;
    const fuel = input.fuel;
    if (!fuel) throw new Error("no fuel on the fleet plan");
    let checked = 0;
    for (const c of input.candidates) {
      for (let s = input.curve.minSpeedKn; s <= input.curve.maxSpeedKn; s += input.speedStepKn) {
        if (!evaluateRoute(input, c, s).meetsArriveBy) continue;
        checked++;
        const track = projectFuelAlongTrack({
          startAt: input.startAt,
          points: c.points,
          speedKn: s,
          stepNm: input.stepNm,
          curve: input.curve,
          weather: input.weather,
          robMt: fuel.robMt,
          safetyMarginDays: fuel.safetyMarginDays,
          stop: null,
          probesNm: [],
        });
        expect(track.grades.LSMGO.belowMarginAt, `${c.id} at ${s} kn`).not.toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("R3 rescue: Marsaxlokk with Kestrel is the recommended plan", () => {
    expect(result.plan?.kind).toBe("stop");
    expect(result.plan?.optionId).toBe("MTMLA-kestrel");
    const malta = plan.input.stops.find((s) => s.optionId === "MTMLA-kestrel");
    expect(Math.abs(polylineNm(malta?.points ?? []) - 3188)).toBeLessThan(10);
  });

  it("R4 comparison: a second quote gives a feasible plan", () => {
    expect(result.plan?.next).not.toBeNull();
  });

  it("R5 bunker answer intact", () => {
    const bunker = planBunkers(
      buildBunkerPlanInput(world, voyage.id, offers, undefined, {
        weather: live.weather,
        congestion: "seed",
      }),
    );
    expect(bunker.bestOptionId).toBe("MTMLA-kestrel");
    const best = bunker.options.find((o) => o.optionId === bunker.bestOptionId);
    expect(Math.abs((best?.totalCostUsd ?? 0) - 233942.91134964247)).toBeLessThan(1e-6);
    expect(Math.abs(bunker.savingVsCheapestHeadlineUsd - 16138.452312674606)).toBeLessThan(1e-6);
  });

  it("R6 tank: Kestrel's 300 t fits at Marsaxlokk", () => {
    const kestrel = result.stopPlans.find((s) => s.optionId === "MTMLA-kestrel");
    expect(kestrel?.reasons).not.toContain("exceeds_tank_capacity");
    expect(kestrel?.qtyMt).toBe(300);
  });
});
