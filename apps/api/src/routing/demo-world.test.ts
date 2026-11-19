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
  shipRoutePlan,
  withStormDetour,
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
    expect(Math.abs((bunker.savingVsCheapestHeadlineUsd ?? 0) - 16138.452312674606)).toBeLessThan(
      1e-6,
    );
  });

  it("R6 tank: Kestrel's 300 t fits at Marsaxlokk", () => {
    const kestrel = result.stopPlans.find((s) => s.optionId === "MTMLA-kestrel");
    expect(kestrel?.reasons).not.toContain("exceeds_tank_capacity");
    expect(kestrel?.qtyMt).toBe(300);
  });
});

describe("demo world: port call and storms (R7, R8)", () => {
  it("R7 port call: Kestrel at Marsaxlokk resupplies, delivers sludge, brings the charts in time", () => {
    const kestrel = result.stopPlans.find((s) => s.optionId === "MTMLA-kestrel");
    const call = kestrel?.portCall;
    const job = (k: string) => call?.jobs.find((j) => j.kind === k);
    expect(job("provisions")).toMatchObject({ needed: true, done: true });
    expect(job("sludge")).toMatchObject({ needed: true, done: true });
    expect(job("charts")).toMatchObject({ needed: true, done: true, qty: 4 });
    expect(call?.outdated.every((o) => o.inTime)).toBe(true);
    expect(call?.notices).toHaveLength(3);
    expect(call?.notices.some((n) => n.overdue)).toBe(false);
    expect(call?.extraCostUsd).toBeGreaterThan(0);
  });

  // The recorded storm (waves over 6 m across Biscay, 17-19 Nov on the pinned clock) meets FAUN,
  // a real cargo ship off Gibraltar at 9.1 kn, on its way to Rotterdam.
  const faun = live.traffic.find((t) => t.mmsi === "314886000");
  const rotterdam = world.ports.find((p) => p.unlocode === "NLRTM");
  if (!faun || !rotterdam) throw new Error("no FAUN or Rotterdam in the recorded data");
  const storm = shipRoutePlan(world, faun, rotterdam, graph, live.weather, zones);

  it("R8 storm: FAUN's baseline meets heavy weather; the plan adds a route round it and avoids it", () => {
    const r = optimiseRouteSpeed(storm.input);
    expect(r.baseline.reasons).toContain("heavy_weather");
    expect(storm.stormCells.length).toBeGreaterThan(0);
    expect(storm.input.candidates.map((c) => c.id)).toContain("S");
    const best = r.options.find((o) => o.candidateId === r.bestCandidateId);
    expect(best?.reasons).not.toContain("heavy_weather");
  });

  it("detour deduplicated: no S when it repeats a candidate already there", () => {
    const s = storm.input.candidates.find((c) => c.id === "S");
    if (!s) throw new Error("no S");
    const without = storm.input.candidates.filter((c) => c.id !== "S");
    const again = withStormDetour(
      graph,
      without[0]?.points[0] ?? { lat: 0, lon: 0 },
      {
        lat: rotterdam.lat,
        lon: rotterdam.lon,
      },
      { ...storm.input, candidates: [...without, { ...s, id: "B2" }] },
    );
    expect(again.candidates.map((c) => c.id)).not.toContain("S");
    expect(again.stormCells.length).toBeGreaterThan(0);
  });
});

describe("demo world: the synthetic storm (R9)", () => {
  // The demo stack lays a labelled synthetic gale west of Crete over the recorded weather.
  const stormy = recordedLiveData({ anchor: ANCHOR, ports: world.ports, syntheticStorm: true });
  const plan9 = fleetRoutePlan(world, voyage.id, graph, stormy.weather, zones, {
    congestion: "seed",
    offers,
    fixedOrder: null,
  });
  const result9 = optimiseRouteSpeed(plan9.input);

  it("R9 the plan steers round it: Kestrel stays recommended, its route and B and C avoid the cells", () => {
    expect(plan9.stormCells.map((c) => [c.id, c.synthetic])).toEqual([
      ["storm:34,20", true],
      ["storm:34,22", true],
    ]);
    expect(result9.plan?.optionId).toBe("MTMLA-kestrel");
    const kestrel = result9.stopPlans.find((s) => s.optionId === "MTMLA-kestrel");
    expect(kestrel?.feasible).toBe(true);
    expect(kestrel?.maxWaveHeightM).toBeLessThanOrEqual(6);
    const ids = plan9.input.candidates.map((c) => c.id);
    expect(ids).toEqual(["A", "B", "C"]);
    for (const id of ["B", "C"]) {
      const o = result9.options.find((x) => x.candidateId === id);
      expect(o?.reasons, id).not.toContain("heavy_weather");
    }
    expect(result9.plan?.next?.optionId).toBe("ESALG-nordwind");
  });
});
