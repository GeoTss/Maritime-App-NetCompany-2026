import type {
  ConsumptionCurve,
  LatLon,
  RouteOptionResult,
  RouteSpeedInput,
  StopCandidate,
  StopPlanResult,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { portStayFuelMt } from "./consumption.js";
import { co2Tonnes, etsCost } from "./emissions.js";
import { optimiseRouteSpeed } from "./route-optimiser.js";
import { evaluateStopPlan, recommendPlan } from "./stop-plan.js";

const ll = (lat: number, lon: number): LatLon => ({ lat, lon });
const START = "2026-11-14T08:00:00.000Z";
const curve: ConsumptionCurve = {
  refSpeedKn: 13,
  refMtPerDay: 30,
  auxMtPerDay: 2.5,
  minSpeedKn: 9,
  maxSpeedKn: 14.5,
};
// Both inside the Mediterranean ECA: everything burns LSMGO.
const DIRECT = { id: "A", label: "Direct", points: [ll(35, 15), ll(35, 25)] };
const SOUTH = { id: "B", label: "South", points: [ll(35, 15), ll(34.5, 20), ll(35, 25)] };

const stop = (over: Partial<StopCandidate> = {}): StopCandidate => ({
  optionId: "MTMLA-kestrel",
  quoteId: 1,
  supplierId: 1,
  portId: 1,
  unlocode: "MTMLA",
  portIsEu: true,
  stayGrade: "LSMGO",
  position: ll(35.5, 20),
  points: [ll(35, 15), ll(35.5, 20), ll(35, 25)],
  stopPointIndex: 1,
  waitingHours: 4,
  bunkeringHours: 6,
  grade: "LSMGO",
  qtyMt: 300,
  offeredQtyMt: 300,
  pricePerMt: 738,
  bargeFee: 2800,
  fxToUsd: 1,
  deliveryFrom: null,
  deliveryTo: null,
  orderRecommendationId: null,
  routeError: null,
  ...over,
});

/** 50 t of LSMGO: too little for the whole track at any speed, enough to reach the stop slowly. */
const input = (over: Partial<RouteSpeedInput> = {}): RouteSpeedInput => ({
  startAt: START,
  candidates: [DIRECT, SOUTH],
  baseline: { candidateId: "A", speedKn: 12 },
  curve,
  speedStepKn: 0.5,
  stepNm: 20,
  arriveBy: null,
  notBefore: null,
  dailyCostUsd: 16_000,
  fuelPriceUsdPerMt: { LSMGO: 820, VLSFO: 610, HSFO: 480 },
  etsCoverage: 0.5,
  market: { euaPriceEur: 75, eurUsd: 1.08, year: 2026 },
  weather: null,
  hazards: [],
  fuel: {
    robMt: { LSMGO: 50, VLSFO: 0, HSFO: 0 },
    safetyMarginDays: 2,
    tankCapacityMt: { LSMGO: 600, VLSFO: 1500, HSFO: 0 },
  },
  stops: [stop()],
  ...over,
});

const planOf = (r: ReturnType<typeof optimiseRouteSpeed>, id: string): StopPlanResult => {
  const s = r.stopPlans.find((x) => x.optionId === id);
  if (!s) throw new Error(`no stop plan ${id}`);
  return s;
};

describe("optimiseRouteSpeed with fuel on board", () => {
  it("keeps the fuel-blind choice when the best route runs short", () => {
    const withFuel = optimiseRouteSpeed(input({ stops: [] }));
    const blind = optimiseRouteSpeed(input({ fuel: null, stops: [] }));
    expect(withFuel.bestCandidateId).toBe(blind.bestCandidateId);
    const best = withFuel.options.find((o) => o.candidateId === withFuel.bestCandidateId);
    expect(best?.reasons).toContain("insufficient_fuel");
    expect(best?.feasible).toBe(false);
    expect(best?.fuel?.keepsMargins).toBe(false);
    expect(blind.stopPlans).toEqual([]);
    expect(blind.plan).toBeNull();
    expect(blind.options.every((o) => o.fuel === null)).toBe(true);
  });

  it("recommends the cheapest feasible stop plan", () => {
    const cheap = stop({ optionId: "GIGIB-cheap", pricePerMt: 600, deliveryTo: START });
    const r = optimiseRouteSpeed(input({ stops: [cheap, stop()] }));
    expect(planOf(r, "GIGIB-cheap").reasons).toContain("outside_delivery_window");
    expect(r.plan?.kind).toBe("stop");
    expect(r.plan?.optionId).toBe("MTMLA-kestrel");
    expect(r.plan?.next).toBeNull();
  });

  it("says what the stop adds", () => {
    const r = optimiseRouteSpeed(input());
    const plan = planOf(r, "MTMLA-kestrel");
    const best = r.options.find((o) => o.candidateId === r.bestCandidateId);
    expect(plan.feasible).toBe(true);
    expect(r.plan?.addedHours).toBeCloseTo(plan.hours - (best?.hours ?? 0), 9);
    expect(r.plan?.addedUsd).toBeCloseTo(
      plan.voyageCostUsd + plan.bargeFeeUsd - (best?.totalCostUsd ?? 0),
      9,
    );
    expect(plan.stop?.waitingHours).toBe(4);
    expect(plan.fuel?.breakpoints.map((b) => b.kind)).toContain("stop_departure");
  });

  it("compares with the next feasible quote", () => {
    const dearer = stop({ optionId: "ESALG-nordwind", pricePerMt: 800 });
    const r = optimiseRouteSpeed(input({ stops: [dearer, stop()] }));
    expect(r.plan?.optionId).toBe("MTMLA-kestrel");
    const next = planOf(r, "ESALG-nordwind");
    expect(r.plan?.next?.optionId).toBe("ESALG-nordwind");
    expect(r.plan?.next?.marginUsd).toBeCloseTo(
      next.totalCostUsd - planOf(r, "MTMLA-kestrel").totalCostUsd,
      9,
    );
  });

  it("plans a stop even when the best route keeps its margins", () => {
    const fuel = {
      robMt: { LSMGO: 500, VLSFO: 0, HSFO: 0 },
      safetyMarginDays: 2,
      tankCapacityMt: { LSMGO: 900, VLSFO: 1500, HSFO: 0 },
    };
    const r = optimiseRouteSpeed(input({ fuel }));
    expect(r.options.every((o) => o.feasible)).toBe(true);
    expect(r.plan?.kind).toBe("stop");
  });

  it("returns no plan when every stop plan is infeasible", () => {
    const r = optimiseRouteSpeed(
      input({ stops: [stop({ offeredQtyMt: 100 }), stop({ optionId: "x", deliveryTo: START })] }),
    );
    expect(r.plan).toBeNull();
    for (const s of r.stopPlans) {
      expect(s.feasible).toBe(false);
      expect(s.reasons.length).toBeGreaterThan(0);
    }
  });

  it("reports exceeds_tank_capacity, insufficient_quantity and outside_delivery_window", () => {
    const tank = {
      robMt: { LSMGO: 50, VLSFO: 0, HSFO: 0 },
      safetyMarginDays: 2,
      tankCapacityMt: { LSMGO: 300, VLSFO: 1500, HSFO: 0 },
    };
    expect(optimiseRouteSpeed(input({ fuel: tank })).stopPlans[0]?.reasons).toContain(
      "exceeds_tank_capacity",
    );
    expect(
      optimiseRouteSpeed(input({ stops: [stop({ offeredQtyMt: 200 })] })).stopPlans[0]?.reasons,
    ).toContain("insufficient_quantity");
    expect(
      optimiseRouteSpeed(input({ stops: [stop({ deliveryFrom: "2026-12-01T00:00:00.000Z" })] }))
        .stopPlans[0]?.reasons,
    ).toContain("outside_delivery_window");
  });

  it("reports a stop the sea graph cannot route", () => {
    const r = optimiseRouteSpeed(
      input({ stops: [stop({ optionId: "nowhere", routeError: "no_path" }), stop()] }),
    );
    const none = planOf(r, "nowhere");
    expect(none.reasons).toEqual(["no_sea_route"]);
    expect(none.feasible).toBe(false);
    expect(none.fuel).toBeNull();
    expect(none.stop).toBeNull();
    expect(planOf(r, "MTMLA-kestrel").feasible).toBe(true);
  });

  it("with no stops, recommends the best route only when it keeps the margins", () => {
    const ample = {
      robMt: { LSMGO: 500, VLSFO: 0, HSFO: 0 },
      safetyMarginDays: 2,
      tankCapacityMt: { LSMGO: 900, VLSFO: 1500, HSFO: 0 },
    };
    const ok = optimiseRouteSpeed(input({ fuel: ample, stops: [] }));
    expect(ok.plan).toMatchObject({
      kind: "route",
      optionId: ok.bestCandidateId,
      addedHours: 0,
      addedUsd: 0,
    });
    // The other route keeps its margins too: it is the next feasible plan.
    expect(ok.plan?.next?.optionId).toBe(ok.bestCandidateId === "A" ? "B" : "A");
    expect(optimiseRouteSpeed(input({ stops: [] })).plan).toBeNull();
  });

  it("counts a stay at an EU port in full for ETS", () => {
    const base = input({ etsCoverage: 0 });
    const eu = evaluateStopPlan(base, stop({ portIsEu: true }), 11);
    const nonEu = evaluateStopPlan(base, stop({ portIsEu: false }), 11);
    const stayCo2 = co2Tonnes({ LSMGO: portStayFuelMt(curve, 10), VLSFO: 0, HSFO: 0 });
    const expected = etsCost({
      co2T: stayCo2,
      coverage: 1,
      year: 2026,
      euaPriceEur: 75,
      eurUsd: 1.08,
    }).costUsd;
    expect(eu.etsCostUsd - nonEu.etsCostUsd).toBeCloseTo(expected, 9);
    expect(nonEu.etsCostUsd).toBe(0);
  });

  it("with no stops, recommends the cheapest route that keeps every margin when the best runs short", () => {
    const opt = (candidateId: string, totalCostUsd: number, hours: number, feasible: boolean) =>
      ({
        candidateId,
        totalCostUsd,
        hours,
        eta: new Date(Date.parse(START) + hours * 3_600_000).toISOString(),
        feasible,
        reasons: feasible ? [] : ["insufficient_fuel"],
      }) as unknown as RouteOptionResult;
    const a = opt("A", 100_000, 200, false);
    const b = opt("B", 120_000, 210, true);
    const c = opt("C", 150_000, 205, true);
    expect(recommendPlan(a, [a, b, c], [])).toEqual({
      kind: "route",
      optionId: "B",
      addedHours: 10,
      addedUsd: 20_000,
      next: { optionId: "C", totalCostUsd: 150_000, marginUsd: 30_000 },
    });
    expect(recommendPlan(a, [a], [])).toBeNull();
  });

  it("reports a stop that no speed makes feasible at its earliest arrival", () => {
    // A berth window that has already closed: every speed misses it.
    const r = optimiseRouteSpeed(input({ arriveBy: START }));
    const s = r.stopPlans[0];
    expect(s?.feasible).toBe(false);
    expect(s?.reasons).toContain("misses_arrive_by");
    expect(s?.speedKn).toBe(curve.maxSpeedKn);
  });
});
