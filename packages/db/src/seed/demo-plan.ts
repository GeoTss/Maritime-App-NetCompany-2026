/**
 * Assembles a bunker-planner input from world rows and a list of supplier offers (live quotes or
 * the demo scenario). Pure: no clock, network or randomness.
 */
import {
  etsCoverage,
  hoursBetween,
  legsForRoute,
  projectFuelOnBoard,
  remainingFobLegs,
  sailedNmAt,
  tankFreeMt,
  type VoyagePath,
} from "@pharos/domain";
import type {
  BunkerPlanInput,
  Currency,
  FobLeg,
  FobProjection,
  FobProjectionInput,
  FuelGrade,
  Id,
  Port,
  Supplier,
} from "@pharos/shared";
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

/** A voyage as a path, with its vessel, latest noon report and remaining legs. */
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
    curve: vessel.consumptionCurve,
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
  const { vessel, voyage, report } = voyageState(world, voyageId);
  return {
    robMt: report.robMt,
    legs,
    speedKn: voyage.plannedSpeedKn,
    curve: vessel.consumptionCurve,
    safetyMarginDays: SAFETY_MARGIN_DAYS,
  };
}

function projectVoyage(world: World, voyageId: Id, legs: FobLeg[]): FobProjection {
  return projectFuelOnBoard(fobProjectionInput(world, voyageId, legs));
}

export function projectDemo(world: World, legs: FobLeg[]): FobProjection {
  return projectVoyage(world, demoVoyageState(world).voyage.id, legs);
}

/**
 * Planner input for a voyage's open requirement against the given offers. The deviation distance
 * is the port's approach distance; bunkering takes DEFAULT_BUNKERING_HOURS; waits come from the
 * latest seeded congestion reading (AIS-derived rows are ignored so the demo plan stays pinned). Off-route ports are reached via Gibraltar. The requirement is the
 * lowest-id open one, of `requirementGrade` when given, of any grade otherwise.
 */
export function buildBunkerPlanInput(
  world: World,
  voyageId: Id,
  offers: BunkerOffer[],
  requirementGrade?: FuelGrade,
): BunkerPlanInput {
  const { vessel, voyage, path, report, remainingLegs } = voyageState(world, voyageId);
  const requirement = must(
    openRequirements(world, voyage.id, requirementGrade)[0],
    `open requirement for voyage ${voyage.id}`,
  );
  const grade = requirement.grade;
  const fob = projectVoyage(world, voyage.id, remainingLegs);
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

  const byCode = (code: string): Port =>
    must(
      world.ports.find((p) => p.unlocode === code),
      `port ${code}`,
    );
  const routeCodes = voyage.plannedRoute.map(
    (id) =>
      must(
        world.ports.find((p) => p.id === id),
        `port ${id}`,
      ).unlocode,
  );
  const gibraltar = byCode("GIGIB");

  /** Remaining legs up to arriving at `code`; off-route ports go via Gibraltar. */
  const legsTo = (code: string): FobLeg[] => {
    const idx = routeCodes.indexOf(code);
    if (idx > 0)
      return remainingLegs.slice(0, remainingLegs.length - (routeCodes.length - 1 - idx));
    const target = byCode(code);
    const spur = must(
      world.routeLegs.find((l) => l.fromPortId === gibraltar.id && l.toPortId === target.id),
      `leg GIGIB-${code}`,
    );
    return [...legsTo("GIGIB"), { distanceNm: spur.distanceNm, grade: spur.requiredGrade }];
  };

  return {
    grade,
    requiredQtyMt: requirement.qtyMt,
    minQtyMt: fob.shortfallMt[grade],
    tankFreeMt: tankFreeMt(vessel.tankCapacityMt[grade], report.robMt[grade]),
    speedKn: voyage.plannedSpeedKn,
    curve: vessel.consumptionCurve,
    dailyCostUsd: vessel.dailyCostUsd,
    voyageEtsCoverage: etsCoverage(path.origin.isEu, path.destination.isEu),
    berthWindowSlackHours: hoursBetween(discharge.eta, windowEnd),
    market: {
      fxToUsd: { USD: 1, EUR: rate("EURUSD") },
      euaPriceEur: rate("EUA"),
      year: world.meta.anchor.getUTCFullYear(),
    },
    options: offers.map((o) => {
      must(
        world.suppliers.find((s) => s.id === o.supplierId),
        `supplier ${o.supplierId}`,
      );
      const port = must(
        world.ports.find((p) => p.id === o.portId),
        `port ${o.portId}`,
      );
      const legs = legsTo(port.unlocode);
      const arrival =
        projectVoyage(world, voyage.id, legs).legs.at(-1)?.robAfterMt[grade] ?? report.robMt[grade];
      const price = must(
        world.portFuelPrices.find((p) => p.portId === port.id && p.grade === grade),
        `${grade} price at ${port.unlocode}`,
      );
      const congestion = must(
        world.portCongestion
          .filter((c) => c.portId === port.id && c.source === "seed")
          .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0],
        `congestion at ${port.unlocode}`,
      );
      return {
        optionId: o.optionId,
        quoteId: o.quoteId,
        supplierId: o.supplierId,
        portId: port.id,
        portIsEu: port.isEu,
        currency: o.currency,
        pricePerMt: o.pricePerMt,
        bargeFee: o.bargeFee,
        offeredQtyMt: o.qtyMt,
        deviationNm: port.approachNm,
        deviationGrade: grade,
        deviationFuelPriceUsdPerMt: price.priceUsdPerMt,
        waitingHours: congestion.waitingHours,
        bunkeringHours: DEFAULT_BUNKERING_HOURS,
        weatherDelayHours: 0,
        robAtArrivalMt: arrival,
        safetyMarginMt: fob.safetyMarginMt[grade],
      };
    }),
  };
}

/** The Phase 1 demo input: DEMO_SCENARIO options as offers on the demo voyage. */
export function buildDemoBunkerPlanInput(world: World): BunkerPlanInput {
  const { voyage } = demoVoyageState(world);
  const offers: BunkerOffer[] = DEMO_SCENARIO.options.map((o) => {
    const port = must(
      world.ports.find((p) => p.unlocode === o.portLocode),
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
      portId: port.id,
      currency: o.currency,
      pricePerMt: o.pricePerMt,
      bargeFee: o.bargeFee,
      qtyMt: o.qtyMt,
    };
  });
  return buildBunkerPlanInput(world, voyage.id, offers);
}
