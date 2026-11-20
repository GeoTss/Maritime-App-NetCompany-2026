import type {
  ConsumptionCurve,
  LatLon,
  RouteSpeedInput,
  StopCandidate,
  StormCell,
  VoyageEvent,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { buildCoastIndex } from "./coast.js";
import { optimiseRouteSpeed, walkRouteOption } from "./route-optimiser.js";
import { voyageTimeline } from "./timeline.js";

const ll = (lat: number, lon: number): LatLon => ({ lat, lon });
const START = "2026-11-14T08:00:00.000Z";
const HOUR = 3_600_000;
const curve: ConsumptionCurve = {
  refSpeedKn: 13,
  refMtPerDay: 30,
  auxMtPerDay: 2.5,
  minSpeedKn: 9,
  maxSpeedKn: 14.5,
};
const PLENTY = { LSMGO: 600, VLSFO: 1500, HSFO: 0 };
const stores = {
  crew: 22,
  provisionsPersonDays: 22 * 3,
  sludgeM3: 11,
  sludgeCapacityM3: 14,
  sewageM3: 14,
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

/** One route A along `points`, enough fuel, no stops: the plan is that route. */
const routeInput = (points: LatLon[], over: Partial<RouteSpeedInput> = {}): RouteSpeedInput => ({
  startAt: START,
  candidates: [{ id: "A", label: "A", points }],
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
  fuel: { robMt: PLENTY, safetyMarginDays: 2, tankCapacityMt: PLENTY },
  stops: [],
  ...over,
});

const MED = [ll(35, 15), ll(35, 25)];

const timelineOf = (
  input: RouteSpeedInput,
  extra: { coast?: ReturnType<typeof buildCoastIndex> | null; stormCells?: StormCell[] } = {},
) =>
  voyageTimeline({
    input,
    result: optimiseRouteSpeed(input),
    stormCells: extra.stormCells ?? [],
    coast: extra.coast ?? null,
  });

const ofKind = <K extends VoyageEvent["kind"]>(events: VoyageEvent[], kind: K) =>
  events.filter((e): e is Extract<VoyageEvent, { kind: K }> => e.kind === kind);

describe("voyageTimeline", () => {
  it("arrival matches eta", () => {
    // A route plan: the arrival is the option's ETA, and the walk it is built on ends there.
    const input = routeInput(MED);
    const result = optimiseRouteSpeed(input);
    expect(result.plan?.kind).toBe("route");
    const option = result.options.find((o) => o.candidateId === result.plan?.optionId);
    const events = voyageTimeline({ input, result, stormCells: [], coast: null });
    const last = events[events.length - 1];
    expect(last?.kind).toBe("arrival");
    expect(last?.at).toBe(option?.eta);
    const walk = walkRouteOption(input, "A", option?.speedKn ?? 0);
    const end = walk?.steps.at(-1);
    const walkEnd = end ? end.startAt.getTime() + end.hours * HOUR : 0;
    expect(Math.abs(walkEnd - Date.parse(option?.eta ?? ""))).toBeLessThan(1000);

    // A stop plan: arrival and departure at the port are the stop timeline's.
    const low = routeInput(MED, {
      candidates: [{ id: "A", label: "A", points: MED }],
      fuel: {
        robMt: { LSMGO: 50, VLSFO: 0, HSFO: 0 },
        safetyMarginDays: 2,
        tankCapacityMt: PLENTY,
      },
      stops: [stop()],
    });
    const r2 = optimiseRouteSpeed(low);
    expect(r2.plan?.kind).toBe("stop");
    const plan = r2.stopPlans.find((s) => s.optionId === r2.plan?.optionId);
    const e2 = voyageTimeline({ input: low, result: r2, stormCells: [], coast: null });
    expect(ofKind(e2, "port_arrival")[0]?.at).toBe(plan?.stop?.arriveAt);
    expect(ofKind(e2, "port_departure")[0]?.at).toBe(plan?.stop?.departAt);
    expect(e2.at(-1)?.at).toBe(plan?.eta);
    // Events run in time order.
    const times = e2.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("starts inside eca", () => {
    const med = timelineOf(routeInput(MED));
    const entries = ofKind(med, "eca_entry");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.atDeparture).toBe(true);
    expect(entries[0]?.changeoverStartAt).toBeNull();
    expect(ofKind(med, "eca_exit")).toHaveLength(0);

    // Out of the Med past 5°36'W: one exit there.
    const out = timelineOf(routeInput([ll(36, -3), ll(36, -8)]));
    const exits = ofKind(out, "eca_exit");
    expect(exits).toHaveLength(1);
    expect(exits[0]?.position.lon).toBeLessThan(-5.2);
    expect(exits[0]?.position.lon).toBeGreaterThan(-6.2);
  });

  it("entry has a changeover lead", () => {
    // From the Bay of Biscay (outside) into the Channel ECA.
    const events = timelineOf(routeInput([ll(47, -2), ll(50, 0)]));
    const [entry] = ofKind(events, "eca_entry");
    expect(entry?.atDeparture).toBe(false);
    expect(Date.parse(entry?.at ?? "")).toBeGreaterThan(Date.parse(START) + HOUR);
    expect(Date.parse(entry?.changeoverStartAt ?? "")).toBe(Date.parse(entry?.at ?? "") - HOUR);
  });

  it("short windows dropped", () => {
    const fine = { stepNm: 5 };
    // Coast 6 nm north of the track, with a 0.5° gap: only a few nm of track are >12 nm off.
    const gappy = buildCoastIndex([
      [ll(35.1, 14), ll(35.1, 19.9)],
      [ll(35.1, 20.4), ll(35.1, 26)],
    ]);
    const none = timelineOf(routeInput(MED, fine), { coast: gappy });
    expect(ofKind(none, "sewage_window_open")).toHaveLength(0);

    // Coast only near both ends: one long window in between.
    const ends = buildCoastIndex([
      [ll(35.1, 14), ll(35.1, 16)],
      [ll(35.1, 24), ll(35.1, 26)],
    ]);
    const events = timelineOf(routeInput(MED, fine), { coast: ends });
    const opens = ofKind(events, "sewage_window_open");
    const closes = ofKind(events, "sewage_window_close");
    expect(opens).toHaveLength(1);
    expect(closes).toHaveLength(1);
    const span = (Date.parse(closes[0]?.at ?? "") - Date.parse(opens[0]?.at ?? "")) / HOUR;
    expect(opens[0]?.windowHours).toBeGreaterThan(3);
    expect(opens[0]?.windowHours).toBeCloseTo(span, 6);

    expect(ofKind(timelineOf(routeInput(MED, fine)), "sewage_window_open")).toHaveLength(0);
  });

  it("stop actions listed", () => {
    const input = routeInput(MED, {
      fuel: {
        robMt: { LSMGO: 50, VLSFO: 0, HSFO: 0 },
        safetyMarginDays: 2,
        tankCapacityMt: PLENTY,
      },
      stops: [stop({ terms })],
      stores,
      nautical: [],
    });
    const [arrival] = ofKind(timelineOf(input), "port_arrival");
    expect(arrival?.actions).toEqual(
      expect.arrayContaining(["bunkering", "provisions", "sewage", "clearance", "port_dues"]),
    );

    // A route plan whose provisions run under the reserve: restock at the destination.
    const route = timelineOf(
      routeInput(MED, { stores: { ...stores, provisionsPersonDays: 22 * 2 } }),
    );
    const [end] = ofKind(route, "arrival");
    expect(end?.restockNeeded).toBe(true);
    expect(end?.provisionsDaysLeft).toBeLessThan(7);
  });

  it("storm passed", () => {
    const cell: StormCell = {
      id: "storm:35.5,20",
      center: ll(35.5, 20),
      radiusNm: 10,
      maxWaveHeightM: 8.5,
      from: START,
      to: "2026-11-15T08:00:00.000Z",
      synthetic: true,
    };
    const [passed] = ofKind(timelineOf(routeInput(MED), { stormCells: [cell] }), "storm_passed");
    expect(passed?.stormId).toBe("storm:35.5,20");
    expect(passed?.clearanceNm).toBeCloseTo(30 - 10, 0);
    expect(passed?.synthetic).toBe(true);
    expect(passed?.position.lon).toBeCloseTo(20, 1);
  });

  it("one event per storm it passes near; far storms left off", () => {
    const cell = (id: string, lat: number, lon: number): StormCell => ({
      id,
      center: ll(lat, lon),
      radiusNm: 80,
      maxWaveHeightM: 9,
      from: START,
      to: "2026-11-15T08:00:00.000Z",
      stationary: true,
    });
    // Two neighbouring cells of one gale 40 and 70 nm off the track, and one 1,500 nm away.
    const cells = [
      cell("storm:35.67,20", 35 + 40 / 60, 20),
      cell("storm:36.17,21", 35 + 70 / 60, 21),
      cell("storm:10,20", 10, 20),
    ];
    const passed = ofKind(timelineOf(routeInput(MED), { stormCells: cells }), "storm_passed");
    expect(passed.map((e) => e.stormId)).toEqual(["storm:35.67,20"]);
  });
});
