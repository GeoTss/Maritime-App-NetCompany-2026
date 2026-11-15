/**
 * Route-and-speed optimiser inputs from the loaded world: a fleet voyage from its latest noon
 * report, or a public AIS ship with a reference vessel profile. Pure: no clock, network or
 * randomness; the graph and the weather snapshot are passed in.
 */
import {
  candidateRoutes,
  clampSpeed,
  type DraughtCondition,
  draughtLoad,
  etsCoverage,
  REFERENCE_VESSEL_PROFILES,
  RouteError,
  remainingRoutePoints,
  routeHazardIds,
  SHIP_EU_COVERAGE,
  sailedNmAt,
  withLoad,
} from "@pharos/domain";
import {
  type AisTraffic,
  FUEL_GRADES,
  type GradeAmounts,
  type HazardZone,
  type Id,
  type LatLon,
  type Port,
  type RouteCandidate,
  type RouteGraph,
  type RouteSpeedInput,
  type ShipType,
  type WeatherGrid,
} from "@pharos/shared";
import { voyageState } from "./seed/demo-plan.js";
import type { World } from "./seed/types.js";

export type RoutePlan = {
  input: RouteSpeedInput;
  /** Vessel name (or `MMSI …` for an unnamed AIS ship). */
  subject: string;
  destination: Port;
  /** "own" for a fleet vessel's curve, else the reference profile used. */
  profile: "own" | ShipType;
  /** Ids of the hazard zones the unconstrained shortest sea route passes through, sorted: those the plan goes round. */
  avoidedHazardIds: string[];
  /**
   * For an AIS ship, the load read from its reported draught ("assumed_laden" when none is
   * reported); null for a fleet vessel, whose load comes from the voyage's cargo and ballast.
   */
  loadCondition: DraughtCondition | null;
};

/** Speed grid step (kn) and the longest sub-step (nm) the optimiser walks. */
const SPEED_STEP_KN = 0.5;
const STEP_NM = 20;

/** Zones the shortest sea route, searched without `avoid`, passes through; [] when there is none. */
function avoidedBy(graph: RouteGraph, start: LatLon, end: LatLon, hazards: HazardZone[]): string[] {
  if (hazards.length === 0) return [];
  try {
    const [shortest] = candidateRoutes(graph, start, end, { max: 1 });
    return shortest ? routeHazardIds(shortest.points, STEP_NM, hazards) : [];
  } catch (e) {
    if (e instanceof RouteError) return [];
    throw e;
  }
}

const latLon = (p: { lat: number; lon: number }): LatLon => ({ lat: p.lat, lon: p.lon });

/** The port's latest index price per grade (latest `asOf`; a tie goes to the higher id). */
function latestPrices(world: World, port: Port): GradeAmounts {
  const out: GradeAmounts = { LSMGO: 0, VLSFO: 0, HSFO: 0 };
  for (const grade of FUEL_GRADES) {
    const row = world.portFuelPrices
      .filter((r) => r.portId === port.id && r.grade === grade)
      .sort((a, b) => b.asOf.getTime() - a.asOf.getTime() || b.id - a.id)[0];
    if (!row) throw new Error(`world has no ${grade} price at ${port.unlocode}`);
    out[grade] = row.priceUsdPerMt;
  }
  return out;
}

/** EUA and EUR/USD reference rates and the world's anchor year, as `get_emissions` takes them. */
function market(world: World): RouteSpeedInput["market"] {
  const rate = (key: string): number => {
    const r = world.referenceRates.find((x) => x.key === key);
    if (!r) throw new Error(`world has no ${key} reference rate`);
    return r.value;
  };
  return {
    euaPriceEur: rate("EUA"),
    eurUsd: rate("EURUSD"),
    year: world.meta.anchor.getUTCFullYear(),
  };
}

/**
 * A fleet voyage from its latest noon report: "A" is the rest of the planned route; up to two sea
 * routes from the graph follow as "B" (shortest) and "C" (alternative). When the graph cannot
 * route the voyage, only "A" remains. The baseline is "A" at the planned speed; the berth window
 * of the discharge call bounds the arrival; the planned speed is rounded to 0.5 kn and clamped to
 * the curve. `hazards` are routed round in B and C (A is the planned route, kept as it is).
 */
export function fleetRoutePlan(
  world: World,
  voyageId: Id,
  graph: RouteGraph,
  weather: WeatherGrid | null,
  hazards: HazardZone[] = [],
): RoutePlan {
  const { vessel, voyage, path, report } = voyageState(world, voyageId);
  const planned = remainingRoutePoints(path, sailedNmAt(path, report.ts));
  const position = planned[0] as LatLon;
  const destination = path.destination;

  let sea: RouteCandidate[] = [];
  try {
    sea = candidateRoutes(graph, position, latLon(destination), { max: 2, avoid: hazards });
  } catch (e) {
    if (!(e instanceof RouteError)) throw e;
  }
  const seaIds = ["B", "C"] as const;
  const seaLabels = ["Shortest sea route", "Alternative sea route"] as const;
  const candidates: RouteCandidate[] = [
    { id: "A", label: "Planned route", points: planned },
    ...sea.map((c, i) => ({
      id: seaIds[i] as string,
      label: seaLabels[i] as string,
      points: c.points,
    })),
  ];

  const discharge = world.portCalls.find(
    (c) => c.voyageId === voyage.id && c.purpose === "discharge",
  );
  return {
    input: {
      startAt: report.ts.toISOString(),
      candidates,
      baseline: {
        candidateId: "A",
        speedKn: clampSpeed(path.curve, voyage.plannedSpeedKn, SPEED_STEP_KN),
      },
      curve: path.curve,
      speedStepKn: SPEED_STEP_KN,
      stepNm: STEP_NM,
      arriveBy: discharge?.berthWindowEnd?.toISOString() ?? null,
      notBefore: discharge?.berthWindowStart?.toISOString() ?? null,
      dailyCostUsd: vessel.dailyCostUsd,
      fuelPriceUsdPerMt: latestPrices(world, destination),
      etsCoverage: etsCoverage(path.origin.isEu, destination.isEu),
      market: market(world),
      weather,
      hazards,
    },
    subject: vessel.name,
    destination,
    profile: "own",
    avoidedHazardIds: avoidedBy(graph, position, latLon(destination), hazards),
    loadCondition: null,
  };
}

/**
 * A public AIS ship to `destination`: the graph's candidate routes from its position (a
 * `RouteError` propagates), the tanker or bulk carrier reference profile with the load its AIS
 * draught implies (`draughtLoad`; assumed laden when unknown), and its reported speed
 * as the baseline (rounded to 0.5 kn and clamped to the curve; the reference speed when unknown
 * or below the curve's minimum). No berth window is known.
 */
export function shipRoutePlan(
  world: World,
  ship: AisTraffic,
  destination: Port,
  graph: RouteGraph,
  weather: WeatherGrid | null,
  hazards: HazardZone[] = [],
): RoutePlan {
  const profile: ShipType = ship.shipType === "tanker" ? "tanker" : "bulk_carrier";
  const reference = REFERENCE_VESSEL_PROFILES[profile];
  const { curve, dailyCostUsd } = reference;
  const { condition, load } = draughtLoad(reference, ship.draughtM);
  const candidates = candidateRoutes(graph, latLon(ship), latLon(destination), { avoid: hazards });
  const sog = ship.sogKn;
  const speedKn =
    sog === null || sog < curve.minSpeedKn
      ? curve.refSpeedKn
      : clampSpeed(curve, sog, SPEED_STEP_KN);
  return {
    input: {
      startAt: ship.updatedAt.toISOString(),
      candidates,
      baseline: { candidateId: "A", speedKn },
      curve: withLoad(curve, load),
      speedStepKn: SPEED_STEP_KN,
      stepNm: STEP_NM,
      arriveBy: null,
      notBefore: null,
      dailyCostUsd,
      fuelPriceUsdPerMt: latestPrices(world, destination),
      etsCoverage: destination.isEu ? SHIP_EU_COVERAGE : 0,
      market: market(world),
      weather,
      hazards,
    },
    subject: ship.name?.trim() || `MMSI ${ship.mmsi}`,
    destination,
    profile,
    avoidedHazardIds: avoidedBy(graph, latLon(ship), latLon(destination), hazards),
    loadCondition: condition,
  };
}
