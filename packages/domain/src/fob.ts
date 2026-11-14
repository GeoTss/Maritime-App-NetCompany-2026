import {
  type FobProjection,
  FobProjectionInput,
  FUEL_GRADES,
  type FuelGrade,
} from "@pharos/shared";
import { dailyConsumptionMt, legFuel } from "./consumption.js";

type Amounts = Record<FuelGrade, number>;
const zero = (): Amounts => ({ LSMGO: 0, VLSFO: 0, HSFO: 0 });

/** Project fuel on board leg by leg at a constant speed; negative ROB is reported, not clamped. */
export function projectFuelOnBoard(rawInput: FobProjectionInput): FobProjection {
  const { robMt, legs, speedKn, curve, safetyMarginDays } = FobProjectionInput.parse(rawInput);
  const dailyMt = dailyConsumptionMt(curve, speedKn);

  const rob: Amounts = { ...robMt };
  const required = zero();
  const burned = { LSMGO: false, VLSFO: false, HSFO: false };
  const minRob: Amounts = { ...robMt };
  const outLegs: FobProjection["legs"] = [];

  legs.forEach((leg, index) => {
    const { hours, fuelMt } = legFuel(curve, leg.distanceNm, speedKn);
    required[leg.grade] += fuelMt;
    burned[leg.grade] = true;
    rob[leg.grade] -= fuelMt;
    for (const g of FUEL_GRADES) minRob[g] = Math.min(minRob[g], rob[g]);
    outLegs.push({ index, grade: leg.grade, hours, fuelMt, robAfterMt: { ...rob } });
  });

  const safetyMarginMt = zero();
  const shortfallMt = zero();
  const belowMarginAtLeg: Record<FuelGrade, number | null> = {
    LSMGO: null,
    VLSFO: null,
    HSFO: null,
  };
  for (const g of FUEL_GRADES) {
    safetyMarginMt[g] = burned[g] ? safetyMarginDays * dailyMt : 0;
    shortfallMt[g] = Math.max(0, required[g] + safetyMarginMt[g] - robMt[g]);
    const hit = outLegs.find((l) => l.robAfterMt[g] < safetyMarginMt[g]);
    belowMarginAtLeg[g] = hit ? hit.index : null;
  }

  return {
    legs: outLegs,
    requiredMt: required,
    safetyMarginMt,
    minRobMt: minRob,
    shortfallMt,
    belowMarginAtLeg,
  };
}
