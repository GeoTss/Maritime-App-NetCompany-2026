import type { ConsumptionCurve } from "@pharos/shared";

function assertSpeed(curve: ConsumptionCurve, speedKn: number): void {
  if (!(speedKn > 0)) throw new RangeError("speedKn must be > 0");
  if (speedKn < curve.minSpeedKn || speedKn > curve.maxSpeedKn) {
    throw new RangeError(
      `speedKn ${speedKn} outside curve range [${curve.minSpeedKn}, ${curve.maxSpeedKn}]`,
    );
  }
}

/** Cubic law: refMtPerDay * (v / refSpeedKn)^3. */
export function mainEngineMtPerDay(curve: ConsumptionCurve, speedKn: number): number {
  assertSpeed(curve, speedKn);
  return curve.refMtPerDay * (speedKn / curve.refSpeedKn) ** 3;
}

/** Main engine plus constant auxiliary load, mt/day. */
export function dailyConsumptionMt(curve: ConsumptionCurve, speedKn: number): number {
  return mainEngineMtPerDay(curve, speedKn) + curve.auxMtPerDay;
}

/** Steaming time and fuel for one leg at constant speed. */
export function legFuel(
  curve: ConsumptionCurve,
  distanceNm: number,
  speedKn: number,
): { hours: number; fuelMt: number } {
  assertSpeed(curve, speedKn);
  if (!(distanceNm >= 0)) throw new RangeError("distanceNm must be >= 0");
  const hours = distanceNm / speedKn;
  return { hours, fuelMt: (dailyConsumptionMt(curve, speedKn) * hours) / 24 };
}

/** Auxiliary-only burn while stopped in port. */
export function portStayFuelMt(curve: ConsumptionCurve, hours: number): number {
  if (!(hours >= 0)) throw new RangeError("hours must be >= 0");
  return (curve.auxMtPerDay * hours) / 24;
}
