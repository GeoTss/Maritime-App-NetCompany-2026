import {
  type BunkerOptionInput,
  type BunkerOptionResult,
  type BunkerPlan,
  BunkerPlanInput,
  type InfeasibleReason,
} from "@pharos/shared";
import { CO2_FACTOR_T_PER_T } from "./constants.js";
import { legFuel, portStayFuelMt } from "./consumption.js";
import { etsCost } from "./emissions.js";

type Unranked = Omit<BunkerOptionResult, "rank">;

function byOptionId(a: { optionId: string }, b: { optionId: string }): number {
  return a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0;
}

function evaluate(input: BunkerPlanInput, o: BunkerOptionInput): Unranked {
  const { curve, speedKn, market } = input;
  const fx = market.fxToUsd[o.currency];
  const qtyMt = input.requiredQtyMt;

  const fuelCostUsd = qtyMt * o.pricePerMt * fx;
  const bargeFeeUsd = o.bargeFee * fx;

  const deviationFuelMt = legFuel(curve, o.deviationNm, speedKn).fuelMt;
  const stayHours = o.waitingHours + o.bunkeringHours + o.weatherDelayHours;
  const stayFuelMt = portStayFuelMt(curve, stayHours);
  const deviationCostUsd = (deviationFuelMt + stayFuelMt) * o.deviationFuelPriceUsdPerMt;

  const delayHours = o.deviationNm / speedKn + stayHours;
  const delayCostUsd = (delayHours / 24) * input.dailyCostUsd;

  // CO2 of the extra burn, in the grade actually burned on the deviation and at the stop.
  const cf = CO2_FACTOR_T_PER_T[o.deviationGrade];
  const deviationCo2T = deviationFuelMt * cf;
  const stayCo2T = stayFuelMt * cf;
  const etsArgs = {
    year: market.year,
    euaPriceEur: market.euaPriceEur,
    eurUsd: market.fxToUsd.EUR,
  };
  const etsCostUsd =
    etsCost({ ...etsArgs, co2T: deviationCo2T, coverage: input.voyageEtsCoverage }).costUsd +
    etsCost({ ...etsArgs, co2T: stayCo2T, coverage: o.portIsEu ? 1 : 0 }).costUsd;

  const totalCostUsd = fuelCostUsd + bargeFeeUsd + deviationCostUsd + delayCostUsd + etsCostUsd;

  const reasons: InfeasibleReason[] = [];
  if (o.offeredQtyMt < input.requiredQtyMt) reasons.push("insufficient_quantity");
  if (input.requiredQtyMt > input.tankFreeMt) reasons.push("exceeds_tank_capacity");
  if (o.robAtArrivalMt < o.safetyMarginMt) reasons.push("unreachable_with_margin");
  if (delayHours > input.berthWindowSlackHours) reasons.push("misses_berth_window");

  return {
    optionId: o.optionId,
    feasible: reasons.length === 0,
    reasons,
    qtyMt,
    headlinePriceUsdPerMt: o.pricePerMt * fx,
    fuelCostUsd,
    bargeFeeUsd,
    deviationFuelMt,
    portStayFuelMt: stayFuelMt,
    deviationCostUsd,
    delayHours,
    delayCostUsd,
    co2T: deviationCo2T + stayCo2T,
    etsCostUsd,
    totalCostUsd,
    effectivePriceUsdPerMt: totalCostUsd / qtyMt,
  };
}

/**
 * Rank bunker options by total cost of ownership (fuel + barge + deviation + delay + ETS),
 * not by headline price. Infeasible options are kept, ranked after all feasible ones.
 */
export function planBunkers(rawInput: BunkerPlanInput): BunkerPlan {
  const input = BunkerPlanInput.parse(rawInput);
  if (input.requiredQtyMt < input.minQtyMt) {
    throw new RangeError(
      `requiredQtyMt ${input.requiredQtyMt} is below the minimum lot ${input.minQtyMt}`,
    );
  }

  const evaluated = input.options.map((o) => evaluate(input, o));
  const options: BunkerOptionResult[] = [...evaluated]
    .sort(
      (a, b) =>
        Number(b.feasible) - Number(a.feasible) ||
        a.totalCostUsd - b.totalCostUsd ||
        byOptionId(a, b),
    )
    .map((o, i) => ({ ...o, rank: i + 1 }));

  const best = options.find((o) => o.feasible) ?? null;
  const cheapest =
    [...options].sort(
      (a, b) => a.headlinePriceUsdPerMt - b.headlinePriceUsdPerMt || byOptionId(a, b),
    )[0] ?? null;

  return {
    options,
    bestOptionId: best?.optionId ?? null,
    cheapestHeadlineOptionId: cheapest?.optionId ?? null,
    savingVsCheapestHeadlineUsd:
      best && cheapest ? cheapest.totalCostUsd - best.totalCostUsd : null,
  };
}
