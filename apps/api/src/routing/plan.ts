/**
 * The route-planning service behind `plan_route_speed` and `POST /api/route-plan`: resolves the
 * subject (a fleet vessel, or a ship seen on AIS), builds the optimiser input from the loaded
 * world, the latest weather snapshot and the active hazards, runs `optimiseRouteSpeed`, and stores
 * the result as a `route_speed` calculation. All maths is in `packages/domain`.
 */
import {
  type BunkerOffer,
  type CongestionMode,
  currentVoyage,
  fleetRoutePlan,
  latestOffers,
  loadWorld,
  offersFromQuotes,
  openRequirements,
  type RoutePlan,
  type Sql,
  shipRoutePlan,
  type World,
} from "@pharos/db";
import { activeHazardZones, buildRouteGraph, optimiseRouteSpeed, RouteError } from "@pharos/domain";
import { latestWeatherSnapshot, loadSeaNetwork } from "@pharos/integrations";
import type {
  AisTraffic,
  Id,
  NavHazard,
  PlanRouteSpeedInput,
  RouteCandidate,
  RouteGraph,
  RoutePlanResponse,
  RouteSpeedResult,
  StopCandidate,
  Vessel,
} from "@pharos/shared";
import { findVessel, insertCalculation } from "../ai/tools/common.js";
import { approvedOrderFor } from "../approvals/orders.js";
import { resolvePort } from "../ingest/resolve.js";
import { routeCalculationLoad } from "./facts.js";

/**
 * The route candidates a plan view draws: the optimiser's routes, then each bunker stop's route
 * through its port (id = the stop plan's option id), so the map can draw the recommended plan.
 * Stops the sea graph could not route are left out.
 */
export function viewCandidates(
  candidates: RouteCandidate[],
  stops: readonly StopCandidate[],
): RouteCandidate[] {
  return [
    ...candidates,
    ...stops
      .filter((s) => s.routeError === null)
      .map((s) => ({
        id: s.optionId,
        label: `Through ${s.unlocode} for bunkers`,
        points: s.points,
      })),
  ];
}

/** A request the planner cannot serve; the message is plain text meant for the operator. */
export class RoutePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutePlanError";
  }
}

export interface RoutePlanDeps {
  sql: Sql;
  now: () => Date;
  /** Port waits: "seed" on the pinned demo clock (the default), else the latest AIS reading. */
  congestion?: CongestionMode;
}

/** The route-plan response before its facts are attached (`routePlanFacts` builds them). */
export type RoutePlanCore = Omit<RoutePlanResponse, "facts">;

export interface PlannedRoute {
  response: RoutePlanCore;
  plan: RoutePlan;
  snapshot: { id: Id; modelRun: Date } | null;
  /** The active hazard rows the plan was built with (labels are untrusted text). */
  hazards: NavHazard[];
  /** Set when the subject is a fleet vessel. */
  vesselId: Id | null;
  /** Set when the subject is an AIS ship, not a fleet vessel. */
  mmsi: string | null;
  /** The AIS ship's reported speed over ground (kn) when it reports one; null for a fleet vessel. */
  sogKn: number | null;
  /** The AIS position row the plan read (its draught and report time); null for a fleet vessel. */
  ship: Pick<AisTraffic, "draughtM" | "updatedAt"> | null;
}

let graph: RouteGraph | undefined;
/** The sea-route graph, built once per process from the committed network. */
const seaGraph = (): RouteGraph => {
  graph ??= buildRouteGraph(loadSeaNetwork().segments);
  return graph;
};

export type TrafficRow = {
  mmsi: string;
  name: string | null;
  ship_type: string | null;
  lat: number;
  lon: number;
  sog_kn: number | null;
  nav_status: string | null;
  destination: string | null;
  draught_m: number | null;
  cog_deg: number | null;
  updated_at: string | Date;
};

export const toTraffic = (r: TrafficRow): AisTraffic => ({
  mmsi: r.mmsi,
  name: r.name,
  shipType: r.ship_type,
  lat: r.lat,
  lon: r.lon,
  sogKn: r.sog_kn,
  navStatus: r.nav_status,
  destination: r.destination,
  draughtM: r.draught_m,
  cogDeg: r.cog_deg,
  updatedAt: new Date(r.updated_at),
});

/** The fleet vessel the text names, or null when none matches (the caller then tries AIS). */
function fleetVessel(world: World, text: string): Vessel | null {
  try {
    return findVessel(world, text);
  } catch {
    return null;
  }
}

/** The AIS ship with this 9-digit MMSI, or this name (case-insensitive, exact). */
async function findShip(sql: Sql, text: string): Promise<AisTraffic> {
  const rows = /^\d{9}$/.test(text)
    ? await sql<TrafficRow[]>`select * from ais_traffic where mmsi = ${text}`
    : await sql<TrafficRow[]>`
        select * from ais_traffic where lower(btrim(name)) = lower(${text}) order by mmsi`;
  const [only, second] = rows;
  if (!only) throw new RoutePlanError(`No fleet vessel or ship seen on AIS matches "${text}".`);
  if (second) {
    throw new RoutePlanError(
      `More than one ship seen on AIS is named "${text}"; give its 9-digit MMSI.`,
    );
  }
  return toTraffic(only);
}

type HazardRow = {
  id: string;
  kind: NavHazard["kind"];
  source: NavHazard["source"];
  mmsi: string | null;
  lat: number;
  lon: number;
  label: string;
  radius_nm: number | null;
  observed_at: string | Date;
};

/** Every row of `nav_hazards`, ordered by id (active or not: `activeHazardZones` filters). */
export async function loadHazards(sql: Sql): Promise<NavHazard[]> {
  const rows = await sql<HazardRow[]>`
    select id, kind, source, mmsi, lat, lon, label, radius_nm, observed_at
    from nav_hazards order by id`;
  return rows.map((h) => ({
    id: h.id,
    kind: h.kind,
    source: h.source,
    mmsi: h.mmsi,
    lat: h.lat,
    lon: h.lon,
    label: h.label,
    radiusNm: h.radius_nm,
    observedAt: new Date(h.observed_at),
  }));
}

function destinationFor(world: World, ship: AisTraffic, written: string | undefined) {
  const text = written ?? ship.destination?.trim();
  if (!text) {
    throw new RoutePlanError(
      `MMSI ${ship.mmsi} is not in the fleet and reports no destination; give a destination port.`,
    );
  }
  const { port, detail } = resolvePort(world, text);
  if (!port) {
    // The AIS destination is untrusted text: do not echo it back.
    throw new RoutePlanError(
      written
        ? (detail ?? `No known port is called "${written}".`)
        : `The destination reported by MMSI ${ship.mmsi} does not match a known port; give a destination port.`,
    );
  }
  return port;
}

/** Plans route and speed for a vessel and stores the calculation; see the module comment. */
export async function planRouteSpeed(
  deps: RoutePlanDeps,
  input: PlanRouteSpeedInput,
): Promise<PlannedRoute> {
  const world = await loadWorld(deps.sql);
  const snapshotRow = await latestWeatherSnapshot(deps.sql);
  const hazards = await loadHazards(deps.sql);
  const zones = activeHazardZones(hazards, deps.now());
  const weather = snapshotRow?.grid ?? null;
  // computeMs times the whole plan: the graph, resolving the subject, the candidates, the optimiser.
  const started = performance.now();
  const g = seaGraph();

  let plan: RoutePlan;
  let voyageId: Id | null = null;
  let vesselId: Id | null = null;
  let mmsi: string | null = null;
  let sogKn: number | null = null;
  let ship: AisTraffic | null = null;
  try {
    const vessel = fleetVessel(world, input.vessel);
    if (vessel) {
      const voyage = currentVoyage(world, vessel.id);
      if (!voyage) throw new RoutePlanError(`${vessel.name} has no current voyage to plan.`);
      voyageId = voyage.id;
      vesselId = vessel.id;
      // The stop candidates: an approved order fixes the stop to its quote; otherwise every valid
      // quote for the open requirement is one.
      const order = await approvedOrderFor(deps.sql, voyage.id);
      const requirement = openRequirements(world, voyage.id)[0];
      let offers: BunkerOffer[] = [];
      const ordered = order?.quoteId ? world.quotes.find((q) => q.id === order.quoteId) : undefined;
      const orderedGrade = ordered
        ? world.quoteLines.find((l) => l.quoteId === ordered.id)?.grade
        : undefined;
      if (ordered && orderedGrade) {
        offers = offersFromQuotes(world, [ordered], requirement?.grade ?? orderedGrade, false);
      } else if (requirement) {
        offers = latestOffers(world, voyage.id, requirement.grade, deps.now(), false);
      }
      plan = fleetRoutePlan(world, voyage.id, g, weather, zones, {
        congestion: deps.congestion ?? "seed",
        offers,
        fixedOrder: order && ordered ? order : null,
      });
    } else {
      ship = await findShip(deps.sql, input.vessel);
      mmsi = ship.mmsi;
      sogKn = ship.sogKn;
      const destination = destinationFor(world, ship, input.destination);
      plan = shipRoutePlan(world, ship, destination, g, weather, zones);
    }
  } catch (e) {
    if (e instanceof RouteError) throw new RoutePlanError(e.message);
    throw e;
  }

  let result: RouteSpeedResult;
  try {
    result = optimiseRouteSpeed(plan.input);
  } catch (e) {
    if (e instanceof RouteError) throw new RoutePlanError(e.message);
    throw e;
  }
  const computeMs = performance.now() - started;

  const snapshot = snapshotRow ? { id: snapshotRow.id, modelRun: snapshotRow.modelRun } : null;
  const calculationId = await insertCalculation(deps, {
    kind: "route_speed",
    inputs: {
      subject: plan.subject,
      mmsi,
      destination: plan.destination.name,
      profile: plan.profile,
      avoidedHazardIds: plan.avoidedHazardIds,
      // The load facts resolve here (the displacement is on the optimiser's curve).
      ...routeCalculationLoad(plan),
      optimiser: plan.input,
    },
    outputs: result,
    voyageId,
    weatherSnapshotId: snapshot?.id ?? null,
  });

  return {
    response: {
      calculationId,
      weatherSnapshotId: snapshot?.id ?? null,
      subject: plan.subject,
      destination: plan.destination.name,
      candidates: viewCandidates(plan.input.candidates, plan.input.stops),
      result,
      computeMs,
    },
    plan,
    snapshot,
    hazards,
    vesselId,
    mmsi,
    sogKn,
    ship: ship ? { draughtM: ship.draughtM, updatedAt: ship.updatedAt } : null,
  };
}
