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

describe("the stop plan does the whole port call", () => {
  const HOUR = 3_600_000;
  const stores = {
    crew: 22,
    provisionsPersonDays: 264,
    sludgeM3: 11,
    sludgeCapacityM3: 14,
    sewageM3: 6,
    sewageCapacityM3: 15,
    onBoard: [],
  };
  const terms = {
    portDuesUsd: 3200,
    clearanceHours: 2,
    stores: true,
    provisionsUsdPerPersonDay: 12,
    storesHours: 8,
    wasteReception: true,
    sludgeUsdPerM3: 180,
    sewageUsdPerM3: 60,
    wasteHours: 3,
    euWasteFeeUsd: 950,
  };

  it("no stores, no port call: today's plan", () => {
    const p = evaluateStopPlan(input(), stop(), 12);
    expect(p.portCall).toBeNull();
    expect(p.stop?.clearanceHours).toBe(0);
    expect(p.stop?.serviceHours).toBe(6);
  });

  it("call adds clearance and cost", () => {
    const base = evaluateStopPlan(input(), stop(), 12);
    const p = evaluateStopPlan(input({ stores, nautical: [] }), stop({ terms }), 12);
    expect(p.portCall?.extraCostUsd).toBe(3200 + 950);
    expect(Date.parse(p.eta) - Date.parse(base.eta)).toBe(2 * HOUR);
    expect(p.totalCostUsd - base.totalCostUsd).toBeGreaterThan(4150);
  });

  it("storing longer than bunkering moves the ETA by the difference too", () => {
    const short = { ...stores, provisionsPersonDays: 22 * 3 };
    const base = evaluateStopPlan(input(), stop(), 12);
    const p = evaluateStopPlan(input({ stores: short, nautical: [] }), stop({ terms }), 12);
    expect(p.portCall?.jobs.find((j) => j.kind === "provisions")?.done).toBe(true);
    expect(p.stop?.serviceHours).toBe(8);
    expect(Date.parse(p.eta) - Date.parse(base.eta)).toBe(4 * HOUR);
  });

  it("no stores at port: provisions needed make the plan infeasible", () => {
    const short = { ...stores, provisionsPersonDays: 22 * 3 };
    const p = evaluateStopPlan(
      input({ stores: short, nautical: [] }),
      stop({ terms: { ...terms, stores: false } }),
      12,
    );
    expect(p.reasons).toContain("provisions_unavailable");
    expect(p.feasible).toBe(false);
  });
});

describe("provisions must last the voyage", () => {
  const crewOf22 = (days: number) => ({
    crew: 22,
    provisionsPersonDays: 22 * days,
    sludgeM3: 2,
    sludgeCapacityM3: 14,
    sewageM3: 2,
    sewageCapacityM3: 15,
    onBoard: [],
  });
  const plenty = { LSMGO: 600, VLSFO: 1500, HSFO: 0 };
  const fed = (days: number) =>
    input({
      fuel: { robMt: plenty, safetyMarginDays: 2, tankCapacityMt: plenty },
      stores: crewOf22(days),
      nautical: [],
    });

  it("a route that arrives under the provisions reserve is infeasible; the ranking without them is not", () => {
    const short = optimiseRouteSpeed(fed(3));
    for (const o of short.options) expect(o.reasons).toContain("insufficient_provisions");
    expect(short.baseline.reasons).toContain("insufficient_provisions");
    const stocked = optimiseRouteSpeed(fed(60));
    for (const o of stocked.options) expect(o.reasons).not.toContain("insufficient_provisions");
    expect(short.bestCandidateId).toBe(stocked.bestCandidateId);
  });

  it("a stop that restocks them is the plan", () => {
    const terms = {
      portDuesUsd: 3200,
      clearanceHours: 2,
      stores: true,
      provisionsUsdPerPersonDay: 12,
      storesHours: 8,
      wasteReception: true,
      sludgeUsdPerM3: 180,
      sewageUsdPerM3: 60,
      wasteHours: 3,
      euWasteFeeUsd: 950,
    };
    // Room in the tank for the stop's 300 mt, and far enough out for its 24-hour notices.
    const r = optimiseRouteSpeed({
      ...fed(3),
      fuel: {
        robMt: { LSMGO: 200, VLSFO: 1500, HSFO: 0 },
        safetyMarginDays: 2,
        tankCapacityMt: plenty,
      },
      stops: [
        stop({
          terms,
          position: ll(35.5, 24),
          points: [ll(35, 15), ll(35.5, 24), ll(35, 25)],
        }),
      ],
    });
    expect(r.plan?.kind).toBe("stop");
    const call = r.stopPlans[0]?.portCall;
    expect(call?.jobs.find((j) => j.kind === "provisions")?.done).toBe(true);
  });
});

describe("a stop plan through a danger area is security-planned", () => {
  // The stop route runs (35,15) -> Marsaxlokk at (35.5,20) -> (35,25); the area covers lon 21-23,
  // after the stop. The team boards before it and leaves after it, both on the track.
  const guarded = {
    id: "guarded",
    name: "Guarded",
    level: "SUBSTANTIAL" as const,
    policy: "guards" as const,
    boxes: [{ minLat: 34, maxLat: 36, minLon: 21, maxLon: 23 }],
    asOf: "2026-11-09",
    source: "test",
    note: "test",
  };
  const team = {
    quoteId: 7,
    providerId: 7,
    embark: { portId: 107, position: ll(35.4, 20.5) },
    disembark: { portId: 207, position: ll(35, 24.5) },
    teamSize: 4,
    dayRateUsd: 1000,
    fixedFeesUsd: 5000,
    minDays: 3,
    validUntil: null,
  };
  const secured = (quotes: (typeof team)[]) =>
    input({ security: { areas: [guarded], quotes, hullValueUsd: 45_000_000, canal: null } });

  it("carries the team the quote covers and adds its cost to the total", () => {
    const s = stop();
    const withTeam = evaluateStopPlan(secured([team]), s, 12);
    const without = evaluateStopPlan(input(), s, 12);
    expect(withTeam.security?.needsTeam).toBe(true);
    expect(withTeam.security?.quoteId).toBe(7);
    expect(withTeam.security?.teamDays).toBeGreaterThanOrEqual(3);
    const teamUsd = withTeam.security?.costLines.find((l) => l.kind === "security_team")?.usd;
    expect(teamUsd).toBe((withTeam.security?.teamDays ?? 0) * 1000 + 5000);
    expect(withTeam.totalCostUsd).toBeCloseTo(without.totalCostUsd + (teamUsd ?? 0), 6);
    expect(withTeam.reasons).not.toContain("security_unavailable");
  });

  it("is blocked when no quote covers the team, as a route is", () => {
    const p = evaluateStopPlan(secured([]), stop(), 12);
    expect(p.reasons).toContain("security_unavailable");
    expect(p.feasible).toBe(false);
  });

  it("without security data has no security key, so today's plans are unchanged", () => {
    const p = evaluateStopPlan(input(), stop(), 12);
    expect("security" in p).toBe(false);
  });
});
