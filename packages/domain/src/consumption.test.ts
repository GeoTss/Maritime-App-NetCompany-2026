import { describe, expect, it } from "vitest";
import { dailyConsumptionMt, legFuel, mainEngineMtPerDay, portStayFuelMt } from "./consumption.js";

const C = { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 8, maxSpeedKn: 16 };

describe("consumption", () => {
  it("main engine at 11.7 kn = 30 * 0.9^3 = 21.87", () => {
    expect(mainEngineMtPerDay(C, 11.7)).toBeCloseTo(21.87, 9);
  });
  it("10% slower burns 19% less per mile (0.9^2 = 0.81)", () => {
    const perMile = (v: number) => mainEngineMtPerDay(C, v) / (v * 24);
    expect(perMile(11.7) / perMile(13)).toBeCloseTo(0.81, 9);
  });
  it("daily = main + aux = 21.87 + 2.5 = 24.37", () => {
    expect(dailyConsumptionMt(C, 11.7)).toBeCloseTo(24.37, 9);
  });
  it("legFuel: 280.8 nm / 11.7 kn = 24 h; 24 h * 24.37 mt/day = 24.37 mt", () => {
    const r = legFuel(C, 280.8, 11.7);
    expect(r.hours).toBeCloseTo(24, 9);
    expect(r.fuelMt).toBeCloseTo(24.37, 9);
  });
  it("legFuel zero distance", () => {
    expect(legFuel(C, 0, 12)).toEqual({ hours: 0, fuelMt: 0 });
  });
  it("speed outside the curve or non-positive throws RangeError", () => {
    expect(() => legFuel(C, 100, 7)).toThrow(RangeError);
    expect(() => legFuel(C, 100, 17)).toThrow(RangeError);
    expect(() => mainEngineMtPerDay(C, 0)).toThrow(RangeError);
    expect(() => dailyConsumptionMt(C, -3)).toThrow(RangeError);
  });
  it("negative distance or hours throws RangeError", () => {
    expect(() => legFuel(C, -1, 12)).toThrow(RangeError);
    expect(() => portStayFuelMt(C, -1)).toThrow(RangeError);
  });
  it("port stay: 2.5 * 12 / 24 = 1.25", () => {
    expect(portStayFuelMt(C, 12)).toBeCloseTo(1.25, 9);
    expect(portStayFuelMt(C, 0)).toBe(0);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(legFuel(C, 123.4, 12.3))).toBe(JSON.stringify(legFuel(C, 123.4, 12.3)));
  });
});
