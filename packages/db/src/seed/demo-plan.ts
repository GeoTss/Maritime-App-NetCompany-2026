/**
 * Assembles a bunker-planner input from world rows and a list of supplier offers (live quotes or
 * the demo scenario). Pure: no clock, network or randomness.
 */
import {
  etsCoverage,
  hoursBetween,
  legFuel,
  legsForRoute,
  nearestAlongNm,
  projectFuelOnBoard,
  remainingFobLegs,
  remainingRoutePoints,
  sailedNmAt,
  tankFreeMt,
  type VoyagePath,
  voyageLoad,
  withLoad,
} from "@pharos/domain";
import type {
  BunkerPlanInput,
  ConsumptionCurve,
  Currency,
  FobLeg,
  FobProjection,
  FobProjectionInput,
  FuelGrade,
  Id,
  Port,
  Supplier,
  Vessel,
  Voyage,
  WeatherGrid,
} from "@pharos/shared";
import { type CongestionMode, currentPlanFuel, waitingHoursAt } from "../current-plan.js";
import { openRequirements } from "../world-rules.js";
import { DEMO_SCENARIO, SUPPLIERS } from "./scenario.js";
import type { World } from "./types.js";

/** Hours alongside while bunkering; same for every offer until a quote carries its own. */
export const DEFAULT_BUNKERING_HOURS = 6;

/** Days of consumption the vessel must still have on arrival at the bunker port. */
const SAFETY_MARGIN_DAYS = DEMO_SCENARIO.safetyMarginDays;

/** One supplier offer to evaluate: a live quote line, or a demo option (quoteId null). */
export interface BunkerOffer {
  optionId: string;
  quoteId: Id | null;
  supplierId: Id;
  portId: Id;
  currency: Currency;
  pricePerMt: number;
  bargeFee: number;
  qtyMt: number;
}

/** Stable option id shared by live quotes and demo options, e.g. `MTMLA-kestrel`. */
export function optionIdFor(port: Port, supplier: Supplier): string {
  const key = SUPPLIERS.find((s) => s.name === supplier.name)?.key;
  if (!key) throw new Error(`supplier "${supplier.name}" has no scenario key`);
  return `${port.unlocode}-${key}`;
}

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`world has no ${what}`);
  return v;
}

/** The vessel's curve with this voyage's load condition (cargo + ballast) on it. */
export function voyageCurve(vessel: Vessel, voyage: Voyage): ConsumptionCurve {
  return withLoad(vessel.consumptionCurve, voyageLoad(vessel, voyage));
}

/** A voyage as a path (on its loaded curve), with its vessel, latest noon report and remaining legs. */
export function voyageState(world: World, voyageId: Id) {
  const voyage = must(
    world.voyages.find((v) => v.id === voyageId),
    `voyage ${voyageId}`,
  );
  const vessel = must(
    world.vessels.find((v) => v.id === voyage.vesselId),
    `vessel ${voyage.vesselId}`,
  );
  const port = (id: number): Port =>
    must(
      world.ports.find((p) => p.id === id),
      `port ${id}`,
    );
  const path: VoyagePath = {
    voyage,
    legs: legsForRoute(voyage.plannedRoute, world.routeLegs),
    origin: port(voyage.originPortId),
    destination: port(voyage.destinationPortId),
    curve: voyageCurve(vessel, voyage),
    departAt: voyage.departedAt ?? world.meta.anchor,
  };
  const report = must(
    world.noonReports
      .filter((r) => r.vesselId === vessel.id)
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0],
    `noon report for vessel ${vessel.id}`,
  );
  const sailedNm = sailedNmAt(path, report.ts);
  return { vessel, voyage, path, report, remainingLegs: remainingFobLegs(path, sailedNm) };
}

/** The demo voyage (Aegean Pioneer, AP-2611). */
export function demoVoyageState(world: World) {
  const vessel = must(
    world.vessels.find((v) => v.imo === DEMO_SCENARIO.vesselImo),
    "demo vessel",
  );
  const voyage = must(
    world.voyages.find((v) => v.voyageNo === DEMO_SCENARIO.voyageNo && v.vesselId === vessel.id),
    "demo voyage",
  );
  return voyageState(world, voyage.id);
}

/** Fuel-on-board projection input for a voyage over `legs`, from its latest noon report. */
export function fobProjectionInput(world: World, voyageId: Id, legs: FobLeg[]): FobProjectionInput {
  const { voyage, path, report } = voyageState(world, voyageId);
  return {
    robMt: report.robMt,
    legs,
    speedKn: voyage.plannedSpeedKn,
    curve: path.curve,
    safetyMarginDays: SAFETY_MARGIN_DAYS,
  };
}

function projectVoyage(world: World, voyageId: Id, legs: FobLeg[]): FobProjection {
  return projectFuelOnBoard(fobProjectionInput(world, voyageId, legs));
}

export function projectDemo(world: World, legs: FobLeg[]): FobProjection {
  return projectVoyage(world, demoVoyageState(world).voyage.id, legs);
}

/** Ports further than this from the planned track are reached by a spur leg from a planned port. */
const OFF_TRACK_NM = 30;

/**
 * Planner input for a voyage's open requirement against the given offers. Fuel on board at each
 * port comes from the one fuel calculation (`currentPlanFuel`): the probe where the planned track
 * passes nearest the port, or, for a port more than OFF_TRACK_NM off it, at the planned port with
 * a spur leg to it less the spur's burn. The deviation distance is the port's approach distance;
 * bunkering takes DEFAULT_BUNKERING_HOURS; waits follow `opts.congestion`. The requirement is the
 * lowest-id open one, of `requirementGrade` when given, of any grade otherwise.
 */
export function buildBunkerPlanInput(
  world: World,
  voyageId: Id,
  offers: BunkerOffer[],
  requirementGrade?: FuelGrade,
  opts: { weather: WeatherGrid | null; congestion: CongestionMode } = {
    weather: null,
    congestion: "seed",
  },
): BunkerPlanInput {
  const { vessel, voyage, path, report } = voyageState(world, voyageId);
  const requirement = must(
    openRequirements(world, voyage.id, requirementGrade)[0],
    `open requirement for voyage ${voyage.id}`,
  );
  const grade = requirement.grade;
  const planned = remainingRoutePoints(path, sailedNmAt(path, report.ts));
  const discharge = must(
    world.portCalls.find((c) => c.voyageId === voyage.id && c.purpose === "discharge"),
    "discharge port call",
  );
  const windowEnd = must(discharge.berthWindowEnd ?? undefined, "berth window end");
  const rate = (key: string): number =>
    must(
      world.referenceRates.find((r) => r.key === key),
      `reference rate ${key}`,
    ).value;
  const port = (id: Id): Port =>
    must(
      world.ports.find((p) => p.id === id),
      `port ${id}`,
    );

  /** Where fuel on board is read for each option's port, and the spur burn to subtract after it. */
  const reach = offers.map((o) => {
    const target = port(o.portId);
    const near = nearestAlongNm(planned, target);
    if (near.offNm <= OFF_TRACK_NM) return { nm: near.nm, spurMt: 0 };
    const spurs = voyage.plannedRoute
      .map((id) => ({
        from: port(id),
        leg: world.routeLegs.find((l) => l.fromPortId === id && l.toPortId === target.id),
      }))
      .filter((x) => x.leg !== undefined);
    const spur = spurs.sort(
      (a, b) => nearestAlongNm(planned, a.from).offNm - nearestAlongNm(planned, b.from).offNm,
    )[0];
    if (!spur?.leg) {
      const burn = legFuel(path.curve, near.offNm, voyage.plannedSpeedKn).fuelMt;
      return { nm: near.nm, spurMt: burn };
    }
    const burn =
      spur.leg.requiredGrade === grade
        ? legFuel(path.curve, spur.leg.distanceNm, voyage.plannedSpeedKn).fuelMt
        : 0;
    return { nm: nearestAlongNm(planned, spur.from).nm, spurMt: burn };
  });
  const fuel = currentPlanFuel(
    world,
    voyage.id,
    opts.weather,
    reach.map((r) => r.nm),
  );

  return {
    grade,
    requiredQtyMt: requirement.qtyMt,
    minQtyMt: fuel.grades[grade].shortfallMt,
    tankFreeMt: tankFreeMt(vessel.tankCapacityMt[grade], report.robMt[grade]),
    speedKn: voyage.plannedSpeedKn,
    curve: path.curve,
    dailyCostUsd: vessel.dailyCostUsd,
    voyageEtsCoverage: etsCoverage(path.origin.isEu, path.destination.isEu),
    berthWindowSlackHours: hoursBetween(discharge.eta, windowEnd),
    market: {
      fxToUsd: { USD: 1, EUR: rate("EURUSD") },
      euaPriceEur: rate("EUA"),
      year: world.meta.anchor.getUTCFullYear(),
    },
    options: offers.map((o, i) => {
      must(
        world.suppliers.find((s) => s.id === o.supplierId),
        `supplier ${o.supplierId}`,
      );
      const p = port(o.portId);
      const probe = fuel.probes[i];
      const arrival = (probe?.robMt[grade] ?? report.robMt[grade]) - (reach[i]?.spurMt ?? 0);
      const price = must(
        world.portFuelPrices.find((x) => x.portId === p.id && x.grade === grade),
        `${grade} price at ${p.unlocode}`,
      );
      return {
        optionId: o.optionId,
        quoteId: o.quoteId,
        supplierId: o.supplierId,
        portId: p.id,
        portIsEu: p.isEu,
        currency: o.currency,
        pricePerMt: o.pricePerMt,
        bargeFee: o.bargeFee,
        offeredQtyMt: o.qtyMt,
        deviationNm: p.approachNm,
        deviationGrade: grade,
        deviationFuelPriceUsdPerMt: price.priceUsdPerMt,
        waitingHours: waitingHoursAt(world, p.id, opts.congestion),
        bunkeringHours: DEFAULT_BUNKERING_HOURS,
        weatherDelayHours: 0,
        robAtArrivalMt: arrival,
        safetyMarginMt: fuel.grades[grade].marginMt,
      };
    }),
  };
}

/** The DEMO_SCENARIO options as offers on the demo voyage (quoteId null). */
export function demoOffers(world: World): BunkerOffer[] {
  return DEMO_SCENARIO.options.map((o) => {
    const p = must(
      world.ports.find((x) => x.unlocode === o.portLocode),
      `port ${o.portLocode}`,
    );
    const name = SUPPLIERS.find((s) => s.key === o.supplierKey)?.name;
    const supplier = must(
      world.suppliers.find((s) => s.name === name),
      `supplier ${o.supplierKey}`,
    );
    return {
      optionId: o.optionId,
      quoteId: null,
      supplierId: supplier.id,
      portId: p.id,
      currency: o.currency,
      pricePerMt: o.pricePerMt,
      bargeFee: o.bargeFee,
      qtyMt: o.qtyMt,
    };
  });
}

/** The Phase 1 demo input: DEMO_SCENARIO options as offers on the demo voyage. */
export function buildDemoBunkerPlanInput(world: World): BunkerPlanInput {
  return buildBunkerPlanInput(world, demoVoyageState(world).voyage.id, demoOffers(world));
}
