/**
 * Vessel and voyage views built from a world, shared by the database source (the stored world,
 * `loadWorld`) and the fixture source (`generateWorld`). Every number comes from the world rows or
 * a `packages/domain` calculator.
 */
import {
  currentPlanFuel,
  currentVoyage,
  fobProjectionInput,
  voyageState,
  type World,
} from "@pharos/db";
import { legsForRoute, projectFuelOnBoard } from "@pharos/domain";
import type {
  FobProjection,
  LatLon,
  PortView,
  Vessel,
  VesselDetail,
  VesselFacts,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
  WeatherGrid,
} from "@pharos/shared";
import { vesselRowFacts } from "../facts/vessel.js";

export const LSMGO_ALERT = "lsmgo_below_margin_for_eca";
/** LSMGO runs out before arrival on the current plan (a stronger form of LSMGO_ALERT). */
export const LSMGO_RUNS_OUT = "lsmgo_runs_out";

export function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`world has no ${what}`);
  return v;
}

/** The facts behind the panel readouts: the tool's own, from the one builder. */
function vesselFacts(world: World, vessel: Vessel, now: Date): VesselFacts {
  const { robMt, voyageNo, nextPort, nextPortEta } = vesselRowFacts(world, vessel, now);
  return { robMt, voyageNo, nextPort, nextPortEta };
}

/**
 * Fleet views. The LSMGO alert comes from the one fuel calculation on the current plan
 * (`currentPlanFuel`, on `weather` when there is a snapshot, else calm water).
 */
export function buildVessels(world: World, now: Date, weather: WeatherGrid | null = null) {
  const latest = <T extends { vesselId: number }>(
    rows: T[],
    vesselId: number,
    ts: (r: T) => Date,
  ) =>
    rows
      .filter((r) => r.vesselId === vesselId)
      .sort((a, b) => ts(b).getTime() - ts(a).getTime())[0];

  return world.vessels.map((vessel): { summary: VesselSummary; detail: VesselDetail } => {
    const report = must(
      latest(world.noonReports, vessel.id, (r) => r.ts),
      `noon report for ${vessel.name}`,
    );
    const position = latest(world.vesselPositions, vessel.id, (p) => p.ts);
    const voyage = currentVoyage(world, vessel.id);

    // The panel's per-leg chart still draws the leg-by-leg projection (a follow-up moves it to the
    // track); the alert below comes from the one fuel calculation, as get_vessel_status's facts do.
    const fob: FobProjection | null = voyage
      ? projectFuelOnBoard(
          fobProjectionInput(world, voyage.id, voyageState(world, voyage.id).remainingLegs),
        )
      : null;
    const lsmgo = voyage ? currentPlanFuel(world, voyage.id, weather).grades.LSMGO : null;
    const alerts =
      lsmgo?.runsDryAt != null
        ? [LSMGO_RUNS_OUT]
        : lsmgo?.belowMarginAt != null
          ? [LSMGO_ALERT]
          : [];
    const summary: VesselSummary = {
      id: vessel.id,
      name: vessel.name,
      imo: vessel.imo,
      mmsi: vessel.mmsi,
      shipType: vessel.shipType,
      position: position ? { lat: position.lat, lon: position.lon } : null,
      positionAt: position ? position.ts.toISOString() : null,
      voyageId: voyage?.id ?? null,
      robMt: report.robMt,
      alerts,
    };
    const detail: VesselDetail = {
      ...summary,
      dwt: vessel.dwt,
      tankCapacityMt: vessel.tankCapacityMt,
      consumptionCurve: vessel.consumptionCurve,
      fobProjection: fob,
      facts: vesselFacts(world, vessel, now),
    };
    return { summary, detail };
  });
}

export function buildPorts(world: World): PortView[] {
  return world.ports.map((p) => ({
    id: p.id,
    name: p.name,
    unlocode: p.unlocode,
    position: { lat: p.lat, lon: p.lon },
    isEu: p.isEu,
  }));
}

/**
 * The legs' waypoints joined in order. Each leg starts where the previous one ended, so a later
 * leg's first point is that joint again and is dropped. No number is computed here.
 */
export function plannedTrack(legs: { waypoints: LatLon[] }[]): LatLon[] {
  return legs.flatMap((l, i) =>
    (i === 0 ? l.waypoints : l.waypoints.slice(1)).map((w) => ({ lat: w.lat, lon: w.lon })),
  );
}

export function buildVoyages(world: World) {
  const portName = (id: number) =>
    must(
      world.ports.find((p) => p.id === id),
      `port ${id}`,
    ).name;

  return world.voyages.map((voyage): { summary: VoyageSummary; detail: VoyageDetail } => {
    const legs = legsForRoute(voyage.plannedRoute, world.routeLegs);
    const calls = world.portCalls
      .filter((c) => c.voyageId === voyage.id)
      .sort((a, b) => a.sequence - b.sequence);
    const upcoming = calls
      .map((c) => c.eta)
      .filter((eta) => eta.getTime() >= world.meta.anchor.getTime())
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const summary: VoyageSummary = {
      id: voyage.id,
      voyageNo: voyage.voyageNo,
      vesselId: voyage.vesselId,
      vesselName: must(
        world.vessels.find((v) => v.id === voyage.vesselId),
        `vessel ${voyage.vesselId}`,
      ).name,
      status: voyage.status,
      originPortId: voyage.originPortId,
      destinationPortId: voyage.destinationPortId,
      plannedSpeedKn: voyage.plannedSpeedKn,
      nextEta: upcoming ? upcoming.toISOString() : null,
    };
    const detail: VoyageDetail = {
      ...summary,
      portCalls: calls.map((c) => ({
        id: c.id,
        portId: c.portId,
        portName: portName(c.portId),
        sequence: c.sequence,
        purpose: c.purpose,
        eta: c.eta.toISOString(),
        berthWindowStart: c.berthWindowStart?.toISOString() ?? null,
        berthWindowEnd: c.berthWindowEnd?.toISOString() ?? null,
      })),
      plannedTrack: plannedTrack(legs),
      legs: legs.map((l) => ({
        fromPortId: l.fromPortId,
        toPortId: l.toPortId,
        distanceNm: l.distanceNm,
        requiredGrade: l.requiredGrade,
        etsCoverage: l.etsCoverage,
      })),
    };
    return { summary, detail };
  });
}
