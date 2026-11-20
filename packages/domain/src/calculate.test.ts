import { describe, expect, it } from "vitest";
import { CalcError, calculate } from "./index.js";

const usd = (value: number) => ({ value, unit: "USD/mt" });
const catchErr = (fn: () => unknown): CalcError => {
  try {
    fn();
  } catch (e) {
    return e as CalcError;
  }
  throw new Error("expected throw");
};

describe("calculate", () => {
  it("subtract: 738 - 712 = 26 USD/mt", () => {
    expect(calculate("subtract", [usd(738), usd(712)])).toEqual({ value: 26, unit: "USD/mt" });
  });
  it("percent_change: (738 - 712) / 712 * 100 = 26 / 712 * 100 = 3.65169...", () => {
    const r = calculate("percent_change", [usd(712), usd(738)]);
    expect(r.value).toBeCloseTo(3.6517, 4);
    expect(r.unit).toBe("%");
  });
  it("percent_change needs identical units and a non-zero base", () => {
    expect(
      catchErr(() => calculate("percent_change", [usd(1), { value: 2, unit: "EUR" }])).code,
    ).toBe("unit_mismatch");
    expect(catchErr(() => calculate("percent_change", [usd(0), usd(2)])).code).toBe(
      "divide_by_zero",
    );
  });
  it("add of USD and EUR throws unit_mismatch; case-folded units match", () => {
    const e = catchErr(() =>
      calculate("add", [
        { value: 1, unit: "USD" },
        { value: 1, unit: "EUR" },
      ]),
    );
    expect(e).toBeInstanceOf(CalcError);
    expect(e.code).toBe("unit_mismatch");
    expect(
      calculate("add", [
        { value: 1, unit: "usd" },
        { value: 2, unit: "USD" },
      ]).value,
    ).toBe(3);
    expect(catchErr(() => calculate("add", [{ value: 1, unit: null }, usd(1)])).code).toBe(
      "unit_mismatch",
    );
  });
  it("divide by 0 throws; same unit gives a null-unit ratio; else a/b", () => {
    expect(catchErr(() => calculate("divide", [usd(1), usd(0)])).code).toBe("divide_by_zero");
    expect(calculate("divide", [usd(10), usd(4)])).toEqual({ value: 2.5, unit: null });
    expect(
      calculate("divide", [
        { value: 10, unit: "mt" },
        { value: 2, unit: "day" },
      ]),
    ).toEqual({
      value: 5,
      unit: "mt/day",
    });
  });
  it("multiply: unit a·b, or a when one is null", () => {
    expect(
      calculate("multiply", [
        { value: 3, unit: "mt" },
        { value: 4, unit: "USD/mt" },
      ]),
    ).toEqual({ value: 12, unit: "mt·USD/mt" });
    expect(
      calculate("multiply", [
        { value: 3, unit: "mt" },
        { value: 2, unit: null },
      ]),
    ).toEqual({
      value: 6,
      unit: "mt",
    });
  });
  it("sum of 3 operands: 1 + 2 + 3 = 6", () => {
    expect(calculate("sum", [usd(1), usd(2), usd(3)])).toEqual({ value: 6, unit: "USD/mt" });
  });
  it("min / max / difference", () => {
    expect(calculate("min", [usd(5), usd(2), usd(9)]).value).toBe(2);
    expect(calculate("max", [usd(5), usd(2), usd(9)]).value).toBe(9);
    expect(calculate("difference", [usd(2), usd(9)]).value).toBe(7);
  });
  it("arity: empty, >10, and binary ops need exactly 2", () => {
    expect(catchErr(() => calculate("sum", [])).code).toBe("arity");
    expect(catchErr(() => calculate("sum", Array(11).fill(usd(1)))).code).toBe("arity");
    expect(catchErr(() => calculate("subtract", [usd(1)])).code).toBe("arity");
    expect(catchErr(() => calculate("divide", [usd(1), usd(1), usd(1)])).code).toBe("arity");
  });
  it("non_finite: NaN/Infinity operands and overflowing results throw", () => {
    expect(catchErr(() => calculate("add", [usd(Number.NaN), usd(1)])).code).toBe("non_finite");
    expect(catchErr(() => calculate("add", [usd(Number.POSITIVE_INFINITY), usd(1)])).code).toBe(
      "non_finite",
    );
    expect(catchErr(() => calculate("multiply", [usd(1e308), usd(10)])).code).toBe("non_finite");
  });
  it("is deterministic", () => {
    const ops = [usd(738), usd(712)];
    expect(calculate("percent_change", ops)).toEqual(calculate("percent_change", ops));
  });
});
