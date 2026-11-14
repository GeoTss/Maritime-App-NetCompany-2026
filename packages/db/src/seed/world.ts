/**
 * generateWorld: the deterministic synthetic world. Pure: same (seed, anchor) gives a
 * byte-identical JSON.stringify; every timestamp is anchor ± an integer number of ms.
 * Routes come from the committed routes.generated.json, never from the library at runtime.
 */
import {
  bearingDeg,
  cumulativeNm,
  etaAfter,
  etsCoverage,
  fuelBetween,
  imoWithCheckDigit,
  legsForRoute,
  polylineNm,
  positionAt,
  sailedNmAt,
  totalNm,
  type VoyagePath,
} from "@pharos/domain";
import type {
  FuelGrade,
  NoonReport,
  Port,
  PortCall,
  RouteLeg,
  Vessel,
  VesselPosition,
  Voyage,
} from "@pharos/shared";
import { createPrng } from "./prng.js";
import routesJson from "./routes.generated.json" with { type: "json" };
import { PORTS, SEED_VERSION, VESSELS } from "./scenario.js";
import { RoutesFile, type World } from "./types.js";
import { buildCommercial } from "./world-commercial.js";

export const ROUTES: RoutesFile = RoutesFile.parse(routesJson);

const HOUR_MS = 3_600_000;
const NOON_REPORTS = 5;
const POSITION_HOURS = 24;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Timestamp `offsetMs` from the anchor, rounded to a whole millisecond. */
export const atOffset = (anchor: Date, offsetMs: number): Date =>
  new Date(anchor.getTime() + Math.round(offsetMs));

function buildPorts(): Port[] {
  return PORTS.map((p, i) => {
    const c = ROUTES.ports[p.unlocode];
    if (!c) throw new Error(`routes.generated.json has no coordinates for ${p.unlocode}`);
    return { id: i + 1, ...p, lat: c.lat, lon: c.lon };
  });
}

/** LSMGO if any part of the real route lies in an ECA or either end port is in one, else VLSFO. */
export function requiredGradeFor(ecaFraction: number, from: Port, to: Port): FuelGrade {
  return ecaFraction > 0 || from.inEca || to.inEca ? "LSMGO" : "VLSFO";
}

function buildLegs(ports: Port[]): RouteLeg[] {
  const byCode = new Map(ports.map((p) => [p.unlocode, p]));
  return ROUTES.legs.map((l, i) => {
    const from = byCode.get(l.from);
    const to = byCode.get(l.to);
    if (!from || !to) throw new Error(`leg ${l.from}-${l.to} has an unknown port`);
    return {
      id: i + 1,
      fromPortId: from.id,
      toPortId: to.id,
      distanceNm: r1(polylineNm(l.waypoints)),
      requiredGrade: requiredGradeFor(l.ecaFraction, from, to),
      etsCoverage: etsCoverage(from.isEu, to.isEu),
      waypoints: l.waypoints,
    };
  });
}

interface Fleet {
  vessels: Vessel[];
  voyages: Voyage[];
  portCalls: PortCall[];
  noonReports: NoonReport[];
  vesselPositions: VesselPosition[];
}

function buildFleet(anchor: Date, ports: Port[], legs: RouteLeg[]): Fleet {
  const byCode = new Map(ports.map((p) => [p.unlocode, p]));
  const portOf = (code: string): Port => {
    const p = byCode.get(code);
    if (!p) throw new Error(`unknown port ${code}`);
    return p;
  };
  const out: Fleet = {
    vessels: [],
    voyages: [],
    portCalls: [],
    noonReports: [],
    vesselPositions: [],
  };

  VESSELS.forEach((s, i) => {
    const vessel: Vessel = {
      id: i + 1,
      imo: imoWithCheckDigit(s.imoBase),
      mmsi: String(999_000_001 + i),
      name: s.name,
      shipType: s.shipType,
      dwt: s.dwt,
      trackingSource: "simulator",
      tankCapacityMt: { ...s.tankCapacityMt },
      consumptionCurve: { ...s.consumptionCurve },
      dailyCostUsd: s.dailyCostUsd,
    };
    out.vessels.push(vessel);

    const route = s.voyage.route.map((c) => portOf(c).id);
    const underway = s.voyage.departedHoursAgo !== null;
    const departAt = atOffset(anchor, -(s.voyage.departedHoursAgo ?? 0) * HOUR_MS);
    const voyage: Voyage = {
      id: i + 1,
      vesselId: vessel.id,
      voyageNo: s.voyage.voyageNo,
      originPortId: portOf(s.voyage.route[0] ?? "").id,
      destinationPortId: portOf(s.voyage.route[s.voyage.route.length - 1] ?? "").id,
      plannedSpeedKn: s.voyage.plannedSpeedKn,
      plannedRoute: route,
      status: underway ? "underway" : "planned",
      departedAt: underway ? departAt : null,
    };
    out.voyages.push(voyage);

    const path: VoyagePath = {
      voyage,
      legs: legsForRoute(route, legs),
      origin: portOf(s.voyage.route[0] ?? ""),
      destination: portOf(s.voyage.route[s.voyage.route.length - 1] ?? ""),
      curve: vessel.consumptionCurve,
      departAt,
    };
    if (sailedNmAt(path, anchor) >= totalNm(path)) {
      throw new Error(`${s.name} would have arrived before the anchor; shorten departedHoursAgo`);
    }

    // Port calls: origin (load), intermediate (passage), destination (discharge, berth window).
    const sailedNow = sailedNmAt(path, anchor);
    const cum = cumulativeNm(path);
    route.forEach((portId, seq) => {
      const at = cum[seq] ?? 0;
      const eta =
        seq === 0
          ? departAt
          : at > sailedNow
            ? etaAfter(anchor, at - sailedNow, voyage.plannedSpeedKn)
            : etaAfter(departAt, at, voyage.plannedSpeedKn);
      const last = seq === route.length - 1;
      out.portCalls.push({
        id: out.portCalls.length + 1,
        voyageId: voyage.id,
        portId,
        sequence: seq,
        purpose: seq === 0 ? "load" : last ? "discharge" : "passage",
        eta,
        berthWindowStart: last ? atOffset(eta, -6 * HOUR_MS) : null,
        berthWindowEnd: last ? atOffset(eta, 48 * HOUR_MS) : null,
      });
    });

    // Noon reports k = 4..0 (oldest first), built backwards from the current ROB.
    const reports: Omit<NoonReport, "id">[] = [];
    let rob = { ...s.currentRobMt };
    for (let k = 0; k < NOON_REPORTS; k++) {
      const ts = atOffset(anchor, -k * 24 * HOUR_MS);
      const prev = atOffset(anchor, -(k + 1) * 24 * HOUR_MS);
      const raw = fuelBetween(path, prev, ts);
      const consumedMt = { LSMGO: r2(raw.LSMGO), VLSFO: r2(raw.VLSFO), HSFO: r2(raw.HSFO) };
      const nm = sailedNmAt(path, ts);
      const dist = nm - sailedNmAt(path, prev);
      const pos = positionAt(path, nm);
      reports.unshift({
        vesselId: vessel.id,
        voyageId: voyage.id,
        ts,
        lat: r4(pos.lat),
        lon: r4(pos.lon),
        speedKn: r2(dist / 24),
        distanceSinceLastNm: r1(dist),
        robMt: rob,
        consumedMt,
      });
      rob = {
        LSMGO: r2(rob.LSMGO + consumedMt.LSMGO),
        VLSFO: r2(rob.VLSFO + consumedMt.VLSFO),
        HSFO: r2(rob.HSFO + consumedMt.HSFO),
      };
    }
    for (const r of reports) out.noonReports.push({ id: out.noonReports.length + 1, ...r });

    // Positions: hourly over the last 24 h when underway, one when in port (oldest first).
    const hours = underway ? POSITION_HOURS : 1;
    for (let h = hours - 1; h >= 0; h--) {
      const ts = atOffset(anchor, -h * HOUR_MS);
      const nm = sailedNmAt(path, ts);
      const moving = nm > 0 && nm < totalNm(path) && ts.getTime() > departAt.getTime();
      const pos = positionAt(path, nm);
      const ahead = positionAt(path, nm + 1);
      out.vesselPositions.push({
        id: out.vesselPositions.length + 1,
        vesselId: vessel.id,
        ts,
        lat: r4(pos.lat),
        lon: r4(pos.lon),
        sogKn: moving ? voyage.plannedSpeedKn : 0,
        cog: moving ? r1(bearingDeg(pos, ahead)) % 360 : 0,
        navStatus: moving ? "under way using engine" : "moored",
        source: "simulator",
      });
    }
  });
  return out;
}

export function generateWorld(opts: { seed: number; anchor: Date }): World {
  const { seed, anchor } = opts;
  if (Number.isNaN(anchor.getTime())) throw new RangeError("anchor must be a valid Date");
  const prng = createPrng(seed);
  const ports = buildPorts();
  const routeLegs = buildLegs(ports);
  const fleet = buildFleet(anchor, ports, routeLegs);
  const commercial = buildCommercial(anchor, prng, ports, fleet.voyages);
  return {
    meta: { seed, anchor: new Date(anchor.getTime()), seedVersion: SEED_VERSION },
    ports,
    routeLegs,
    suppliers: commercial.suppliers,
    vessels: fleet.vessels,
    voyages: fleet.voyages,
    portCalls: fleet.portCalls,
    noonReports: fleet.noonReports,
    vesselPositions: fleet.vesselPositions,
    portFuelPrices: commercial.portFuelPrices,
    portCongestion: commercial.portCongestion,
    bunkerRequirements: commercial.bunkerRequirements,
    quotes: commercial.quotes,
    quoteLines: commercial.quoteLines,
    purchaseOrders: commercial.purchaseOrders,
    orderLines: commercial.orderLines,
    referenceRates: commercial.referenceRates,
  };
}
