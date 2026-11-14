/** Assembles the Aegean Pioneer bunker-planner input from world rows and DEMO_SCENARIO. */
import { etsCoverage, projectFuelOnBoard } from "@pharos/domain";
import type { BunkerPlanInput, FobLeg, FobProjection, Port } from "@pharos/shared";
import { DEMO_SCENARIO, SUPPLIERS } from "./scenario.js";
import type { World } from "./types.js";
import { legsForRoute, remainingFobLegs, sailedNmAt, type VoyagePath } from "./voyage-path.js";

const HOUR_MS = 3_600_000;

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`world has no ${what}`);
  return v;
}

/** The demo voyage as a path, with the vessel, its latest noon report and remaining legs. */
export function demoVoyageState(world: World) {
  const vessel = must(
    world.vessels.find((v) => v.imo === DEMO_SCENARIO.vesselImo),
    "demo vessel",
  );
  const voyage = must(
    world.voyages.find((v) => v.voyageNo === DEMO_SCENARIO.voyageNo && v.vesselId === vessel.id),
    "demo voyage",
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
    "noon report for the demo vessel",
  );
  const sailedNm = sailedNmAt(path, report.ts);
  return { vessel, voyage, path, report, remainingLegs: remainingFobLegs(path, sailedNm) };
}

export function projectDemo(world: World, legs: FobLeg[]): FobProjection {
  const { vessel, voyage, report } = demoVoyageState(world);
  return projectFuelOnBoard({
    robMt: report.robMt,
    legs,
    speedKn: voyage.plannedSpeedKn,
    curve: vessel.consumptionCurve,
    safetyMarginDays: DEMO_SCENARIO.safetyMarginDays,
  });
}

export function buildDemoBunkerPlanInput(world: World): BunkerPlanInput {
  const { vessel, voyage, path, report, remainingLegs } = demoVoyageState(world);
  const grade = DEMO_SCENARIO.requirement.grade;
  const fob = projectDemo(world, remainingLegs);

  const requirement = must(
    world.bunkerRequirements.find(
      (r) => r.voyageId === voyage.id && r.grade === grade && r.status === "open",
    ),
    "open demo requirement",
  );
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
    tankFreeMt: vessel.tankCapacityMt[grade] - report.robMt[grade],
    speedKn: voyage.plannedSpeedKn,
    curve: vessel.consumptionCurve,
    dailyCostUsd: vessel.dailyCostUsd,
    voyageEtsCoverage: etsCoverage(path.origin.isEu, path.destination.isEu),
    berthWindowSlackHours: (windowEnd.getTime() - discharge.eta.getTime()) / HOUR_MS,
    market: {
      fxToUsd: { USD: 1, EUR: rate("EURUSD") },
      euaPriceEur: rate("EUA"),
      year: world.meta.anchor.getUTCFullYear(),
    },
    options: DEMO_SCENARIO.options.map((o) => {
      const port = byCode(o.portLocode);
      const legs = legsTo(o.portLocode);
      const arrival =
        projectDemo(world, legs).legs.at(-1)?.robAfterMt[grade] ?? report.robMt[grade];
      const price = must(
        world.portFuelPrices.find((p) => p.portId === port.id && p.grade === grade),
        `${grade} price at ${o.portLocode}`,
      );
      const congestion = must(
        world.portCongestion
          .filter((c) => c.portId === port.id)
          .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0],
        `congestion at ${o.portLocode}`,
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
        portIsEu: port.isEu,
        currency: o.currency,
        pricePerMt: o.pricePerMt,
        bargeFee: o.bargeFee,
        offeredQtyMt: o.qtyMt,
        deviationNm: o.deviationNm,
        deviationGrade: grade,
        deviationFuelPriceUsdPerMt: price.priceUsdPerMt,
        waitingHours: congestion.waitingHours,
        bunkeringHours: o.bunkeringHours,
        weatherDelayHours: 0,
        robAtArrivalMt: arrival,
        safetyMarginMt: fob.safetyMarginMt[grade],
      };
    }),
  };
}
