/** Route and speed optimiser, weather grid, sea network and congestion contracts (pure maths inputs/outputs). */
import { z } from "zod";
import { ConsumptionCurve } from "./calculators.js";
import { EtsCoverageFactor, GradeAmounts, IsoDateTime, LatLon } from "./primitives.js";

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
    timeCostUsd: NonNeg,
    totalCostUsd: NonNeg,
    maxWaveHeightM: NonNeg,
    weatherCoveragePct: z.number().min(0).max(100),
    feasible: z.boolean(),
    /** Ids of the hazard zones the route passes through, sorted. */
    hazardIds: z.array(z.string()),
    reasons: z.array(z.enum(["misses_arrive_by", "crosses_hazard"])),
  })
  .strict();
export type RouteOptionResult = z.infer<typeof RouteOptionResult>;

export const RouteSpeedResult = z
  .object({
    /** One entry per candidate, at that candidate's best speed, in candidate order. */
    options: z.array(RouteOptionResult),
    baseline: RouteOptionResult,
    bestCandidateId: z.string().min(1),
    savingVsBaselineUsd: z.number(),
    fuelSavingVsBaselineMt: z.number(),
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
