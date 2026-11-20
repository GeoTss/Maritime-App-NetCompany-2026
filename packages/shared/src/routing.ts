/** Route and speed optimiser, weather grid, sea network and congestion contracts (pure maths inputs/outputs). */
import { z } from "zod";
import { ConsumptionCurve, SignedGradeAmounts } from "./calculators.js";
import { NauticalItem, PortCallResult, PortCallTerms, VesselStores } from "./port-call.js";
import {
  EtsCoverageFactor,
  FuelGrade,
  GradeAmounts,
  Id,
  IsoDateTime,
  LatLon,
} from "./primitives.js";
import { SecurityInput, SecurityPlanResult } from "./security.js";

const NonNeg = z.number().nonnegative();
const Positive = z.number().positive();

export const SeaNetwork = z
  .object({
    source: z.string().min(1),
    bbox: z
      .object({
        minLat: z.number().min(-90).max(90),
        maxLat: z.number().min(-90).max(90),
        minLon: z.number().min(-180).max(180),
        maxLon: z.number().min(-180).max(180),
      })
      .strict(),
    segments: z.array(z.array(LatLon)),
  })
  .strict();
export type SeaNetwork = z.infer<typeof SeaNetwork>;

export const RouteGraph = z
  .object({
    nodes: z.array(LatLon),
    edges: z.array(
      z
        .object({
          a: z.number().int().nonnegative(),
          b: z.number().int().nonnegative(),
          nm: NonNeg,
        })
        .strict(),
    ),
  })
  .strict();
export type RouteGraph = z.infer<typeof RouteGraph>;

const Series = z.array(z.number().nullable());

/** One grid point. Wave and wind directions are where they come from; current direction is where it flows to; degrees true. */
export const WeatherPoint = z
  .object({
    lat: LatLon.shape.lat,
    lon: LatLon.shape.lon,
    waveHeightM: Series,
    waveDirDeg: Series,
    windSpeedKn: Series,
    windDirDeg: Series,
    currentSpeedKn: Series,
    currentDirDeg: Series,
    /** Set on a labelled synthetic demo point (the demo storm); absent on real forecasts. */
    synthetic: z.literal(true).optional(),
    /**
     * A demo scenario weather area over this point: its waves and wind hold from `from` to `until`
     * (null: open on that side), past the forecast's last step too. Directions are where they come
     * from. Outside the window the forecast applies (and after it, nothing).
     */
    scenario: z
      .object({
        from: IsoDateTime.nullable(),
        until: IsoDateTime.nullable(),
        waveHeightM: z.number(),
        waveDirDeg: z.number(),
        windSpeedKn: z.number(),
        windDirDeg: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WeatherPoint = z.infer<typeof WeatherPoint>;

export const WeatherGrid = z
  .object({
    startAt: IsoDateTime,
    stepHours: Positive,
    points: z.array(WeatherPoint),
  })
  .strict()
  .superRefine((grid, ctx) => {
    const lengths = new Set<number>();
    for (const p of grid.points) {
      for (const s of [
        p.waveHeightM,
        p.waveDirDeg,
        p.windSpeedKn,
        p.windDirDeg,
        p.currentSpeedKn,
        p.currentDirDeg,
      ]) {
        lengths.add(s.length);
      }
    }
    if (lengths.size > 1 || lengths.has(0)) {
      ctx.addIssue({
        code: "custom",
        path: ["points"],
        message: "every weather series must have the same length of at least 1",
      });
    }
  });
export type WeatherGrid = z.infer<typeof WeatherGrid>;

export const RouteCandidate = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    points: z.array(LatLon).min(2),
  })
  .strict();
export type RouteCandidate = z.infer<typeof RouteCandidate>;

/** A reported navigational hazard as a circle to keep out of: a route passing through it is infeasible. */
export const HazardZone = z
  .object({ id: z.string().min(1), center: LatLon, radiusNm: Positive })
  .strict();
export type HazardZone = z.infer<typeof HazardZone>;

/** A point along a track: distance from the start, time and position. */
export const AlongTrack = z.object({ nm: NonNeg, at: IsoDateTime, position: LatLon }).strict();
export type AlongTrack = z.infer<typeof AlongTrack>;

export const FuelBreakpoint = AlongTrack.extend({
  kind: z.enum(["start", "grade_change", "stop_arrival", "stop_departure", "end"]),
  robMt: SignedGradeAmounts,
}).strict();
export type FuelBreakpoint = z.infer<typeof FuelBreakpoint>;

export const GradeFuelCheck = z
  .object({
    /** Burned on the track (steaming and port stay), this grade. */
    neededMt: NonNeg,
    /** safetyMarginDays × daily consumption at the speed; 0 when the grade is never burned. */
    marginMt: NonNeg,
    minRobMt: z.number(),
    /** max(0, neededMt + marginMt − robAtStart − bunkeredMt). */
    shortfallMt: NonNeg,
    belowMarginAt: AlongTrack.extend({ robMt: z.number() }).strict().nullable(),
    runsDryAt: AlongTrack.nullable(),
  })
  .strict();
export type GradeFuelCheck = z.infer<typeof GradeFuelCheck>;

export const StopTimeline = z
  .object({
    arriveAt: IsoDateTime,
    waitingHours: NonNeg,
    weatherDelayHours: NonNeg,
    bunkeringHours: NonNeg,
    /** Customs, immigration and survey after waiting, before the service starts. */
    clearanceHours: NonNeg,
    /** Bunkering, storing and waste delivery run alongside: the longest of the jobs done here. */
    serviceHours: NonNeg,
    departAt: IsoDateTime,
    /** The workable-weather window ran past the end of the forecast (counted as workable). */
    beyondForecast: z.boolean(),
  })
  .strict();
export type StopTimeline = z.infer<typeof StopTimeline>;

export const TrackFuel = z
  .object({
    breakpoints: z.array(FuelBreakpoint),
    grades: z
      .object({ LSMGO: GradeFuelCheck, VLSFO: GradeFuelCheck, HSFO: GradeFuelCheck })
      .strict(),
    /** Every grade stays at or above its margin at every sub-step end and at stop arrival. */
    keepsMargins: z.boolean(),
    /** Highest wave height sampled on the walk (m); 0 without weather. */
    maxWaveHeightM: NonNeg,
    probes: z.array(AlongTrack.extend({ robMt: SignedGradeAmounts }).strict()),
  })
  .strict();
export type TrackFuel = z.infer<typeof TrackFuel>;

export const TrackStopInput = z
  .object({
    /** Index in `points` of the port position. */
    pointIndex: z.number().int().positive(),
    position: LatLon,
    waitingHours: NonNeg,
    bunkeringHours: NonNeg,
    stayGrade: FuelGrade,
    grade: FuelGrade,
    qtyMt: Positive,
  })
  .strict();
export type TrackStopInput = z.infer<typeof TrackStopInput>;

export const TrackFuelInput = z
  .object({
    startAt: IsoDateTime,
    points: z.array(LatLon).min(2),
    speedKn: Positive,
    stepNm: Positive,
    curve: ConsumptionCurve,
    weather: WeatherGrid.nullable(),
    robMt: GradeAmounts,
    safetyMarginDays: NonNeg,
    stop: TrackStopInput.nullable(),
    probesNm: z.array(NonNeg),
  })
  .strict();
export type TrackFuelInput = z.infer<typeof TrackFuelInput>;

/** A bunker quote turned into a route through its port, for the optimiser to evaluate. */
export const StopCandidate = z
  .object({
    /** Bunker option id, e.g. "MTMLA-kestrel". */
    optionId: z.string().min(1),
    quoteId: Id.nullable(),
    supplierId: Id,
    portId: Id,
    unlocode: z.string().min(1),
    portIsEu: z.boolean(),
    stayGrade: FuelGrade,
    position: LatLon,
    points: z.array(LatLon).min(2),
    stopPointIndex: z.number().int().positive(),
    waitingHours: NonNeg,
    bunkeringHours: NonNeg,
    grade: FuelGrade,
    qtyMt: Positive,
    offeredQtyMt: NonNeg,
    pricePerMt: Positive,
    bargeFee: NonNeg,
    fxToUsd: Positive,
    deliveryFrom: IsoDateTime.nullable(),
    deliveryTo: IsoDateTime.nullable(),
    /** Set when an approved purchase order fixes this stop. */
    orderRecommendationId: Id.nullable(),
    /** Set when the sea graph cannot route through the port: the plan is reported, not evaluated. */
    routeError: z.string().nullable(),
    /** What the port offers and charges for the call; absent or null = fuel only (as before). */
    terms: PortCallTerms.nullable().optional(),
  })
  .strict();
export type StopCandidate = z.infer<typeof StopCandidate>;

export const RouteSpeedInput = z
  .object({
    startAt: IsoDateTime,
    candidates: z.array(RouteCandidate).min(1),
    baseline: z.object({ candidateId: z.string().min(1), speedKn: Positive }).strict(),
    curve: ConsumptionCurve,
    speedStepKn: Positive,
    stepNm: Positive,
    arriveBy: IsoDateTime.nullable(),
    notBefore: IsoDateTime.nullable(),
    dailyCostUsd: NonNeg,
    fuelPriceUsdPerMt: GradeAmounts,
    etsCoverage: EtsCoverageFactor,
    market: z.object({ euaPriceEur: NonNeg, eurUsd: Positive, year: z.number().int() }).strict(),
    weather: WeatherGrid.nullable(),
    hazards: z.array(HazardZone),
    /** Fuel on board; null for a ship with no fleet data (AIS ships): no fuel check. */
    fuel: z
      .object({ robMt: GradeAmounts, safetyMarginDays: NonNeg, tankCapacityMt: GradeAmounts })
      .strict()
      .nullable(),
    /** Bunker stops to evaluate beside the candidates. */
    stops: z.array(StopCandidate),
    /** The vessel's stores and waste; absent or null = no port-call planning (AIS ships). */
    stores: VesselStores.nullable().optional(),
    /** Charts and publications at their current editions, for the out-of-date check. */
    nautical: z.array(NauticalItem).optional(),
    /** Danger areas, security quotes, hull value and canal terms; absent = no security planning. */
    security: SecurityInput.optional(),
  })
  .strict();
export type RouteSpeedInput = z.infer<typeof RouteSpeedInput>;

export const RouteOptionResult = z
  .object({
    candidateId: z.string().min(1),
    speedKn: Positive,
    distanceNm: NonNeg,
    hours: NonNeg,
    calmHours: NonNeg,
    weatherDelayHours: z.number(),
    eta: IsoDateTime,
    fuelMt: GradeAmounts,
    totalFuelMt: NonNeg,
    co2T: NonNeg,
    fuelCostUsd: NonNeg,
    etsCostUsd: NonNeg,
    /** FuelEU Maritime penalty exposure of the option's fuel at `etsCoverage`; inside totalCostUsd. */
    fuelEuCostUsd: NonNeg,
    timeCostUsd: NonNeg,
    totalCostUsd: NonNeg,
    maxWaveHeightM: NonNeg,
    weatherCoveragePct: z.number().min(0).max(100),
    feasible: z.boolean(),
    /** Whether the ETA is within `arriveBy` (always true when there is none). */
    meetsArriveBy: z.boolean(),
    /** Whether the route passes through any hazard zone. */
    crossesHazard: z.boolean(),
    /** Ids of the hazard zones the route passes through, sorted. */
    hazardIds: z.array(z.string()),
    reasons: z.array(
      z.enum([
        "misses_arrive_by",
        "crosses_hazard",
        "insufficient_fuel",
        "heavy_weather",
        "security_unavailable",
        "avoid_area",
        "insufficient_provisions",
      ]),
    ),
    /** The option's security plan; absent or null when the input has no security data. */
    security: SecurityPlanResult.nullable().optional(),
    /** Fuel on board along the option; null when the input has no fuel. */
    fuel: TrackFuel.nullable(),
  })
  .strict();
export type RouteOptionResult = z.infer<typeof RouteOptionResult>;

export const StopPlanReason = z.enum([
  "misses_arrive_by",
  "crosses_hazard",
  "insufficient_fuel",
  "exceeds_tank_capacity",
  "insufficient_quantity",
  "outside_delivery_window",
  "no_sea_route",
  "provisions_unavailable",
  "waste_reception_unavailable",
  "notice_overdue",
  "heavy_weather",
  "security_unavailable",
  "avoid_area",
]);
export type StopPlanReason = z.infer<typeof StopPlanReason>;

export const StopPlanResult = z
  .object({
    optionId: z.string().min(1),
    quoteId: Id.nullable(),
    unlocode: z.string().min(1),
    speedKn: Positive,
    distanceNm: NonNeg,
    steamingHours: NonNeg,
    hours: NonNeg,
    /** Weather delay at sea; the bunkering delay is `stop.weatherDelayHours`. */
    seaWeatherDelayHours: z.number(),
    eta: IsoDateTime,
    stop: StopTimeline.nullable(),
    fuel: TrackFuel.nullable(),
    fuelMt: GradeAmounts,
    co2T: NonNeg,
    fuelCostUsd: NonNeg,
    timeCostUsd: NonNeg,
    etsCostUsd: NonNeg,
    fuelEuCostUsd: NonNeg,
    voyageCostUsd: NonNeg,
    bunkerFuelCostUsd: NonNeg,
    bargeFeeUsd: NonNeg,
    totalCostUsd: NonNeg,
    qtyMt: Positive,
    hazardIds: z.array(z.string()),
    /** Highest wave height sampled along the plan (m). */
    maxWaveHeightM: NonNeg,
    /** The whole call; null when the vessel has no stores data or the port no terms. */
    portCall: PortCallResult.nullable(),
    feasible: z.boolean(),
    reasons: z.array(StopPlanReason),
    /** The stop plan's security plan, over its own walk; absent when the input has no security data. */
    security: SecurityPlanResult.optional(),
  })
  .strict();
export type StopPlanResult = z.infer<typeof StopPlanResult>;

export const RecommendedPlan = z
  .object({
    kind: z.enum(["route", "stop"]),
    /** A candidate id ("route") or a stop plan's option id ("stop"). */
    optionId: z.string().min(1),
    /** Plan hours − the fuel-blind best's hours. */
    addedHours: z.number(),
    /** Plan voyage cost + barge fee − the fuel-blind best's total cost. */
    addedUsd: z.number(),
    next: z
      .object({ optionId: z.string(), totalCostUsd: NonNeg, marginUsd: NonNeg })
      .strict()
      .nullable(),
  })
  .strict();
export type RecommendedPlan = z.infer<typeof RecommendedPlan>;

export const RouteSpeedResult = z
  .object({
    /** One entry per candidate, at that candidate's best speed, in candidate order. */
    options: z.array(RouteOptionResult),
    baseline: RouteOptionResult,
    bestCandidateId: z.string().min(1),
    savingVsBaselineUsd: z.number(),
    fuelSavingVsBaselineMt: z.number(),
    /** One per stop candidate, in input order, each at its cheapest feasible speed. */
    stopPlans: z.array(StopPlanResult),
    /** The recommended feasible plan; null when the input has no fuel or nothing is feasible. */
    plan: RecommendedPlan.nullable(),
  })
  .strict();
export type RouteSpeedResult = z.infer<typeof RouteSpeedResult>;

export const CongestionInput = z
  .object({
    port: LatLon,
    radiusNm: Positive,
    hoursPerAnchoredVessel: NonNeg,
    maxWaitingHours: NonNeg,
    vessels: z.array(
      z
        .object({
          lat: LatLon.shape.lat,
          lon: LatLon.shape.lon,
          sogKn: NonNeg.nullable(),
          navStatus: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type CongestionInput = z.infer<typeof CongestionInput>;

export const CongestionResult = z
  .object({
    anchoredCount: z.number().int().nonnegative(),
    inRangeCount: z.number().int().nonnegative(),
    waitingHours: NonNeg,
  })
  .strict();
export type CongestionResult = z.infer<typeof CongestionResult>;
