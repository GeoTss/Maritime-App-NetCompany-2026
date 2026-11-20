import type { BunkerOptionInput, BunkerPlanInput } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { planBunkers } from "./bunker-planner.js";

const C = { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 8, maxSpeedKn: 16 };

// Option A: EU port, USD 700/mt, barge 2000, 13 nm deviation at 13 kn.
const A: BunkerOptionInput = {
  optionId: "A",
  quoteId: null,
  supplierId: 1,
  portId: 1,
  portIsEu: true,
  currency: "USD",
  pricePerMt: 700,
  bargeFee: 2000,
  offeredQtyMt: 300,
  deviationNm: 13,
  deviationGrade: "LSMGO",
  deviationFuelPriceUsdPerMt: 800,
  waitingHours: 5,
  bunkeringHours: 6,
  weatherDelayHours: 0,
  robAtArrivalMt: 120,
  safetyMarginMt: 65,
};
// Option B: non-EU, cheapest headline, no deviation but a 30 h wait.
const B: BunkerOptionInput = {
  ...A,
  optionId: "B",
  supplierId: 2,
  portId: 2,
  portIsEu: false,
  pricePerMt: 690,
  bargeFee: 6000,
  deviationNm: 0,
  waitingHours: 30,
};

function input(overrides: Partial<BunkerPlanInput> = {}): BunkerPlanInput {
  return {
    grade: "LSMGO",
    requiredQtyMt: 300,
    minQtyMt: 50,
    tankFreeMt: 400,
    speedKn: 13,
    curve: C,
    dailyCostUsd: 16000,
    voyageEtsCoverage: 0.5,
    berthWindowSlackHours: 48,
    market: { fxToUsd: { USD: 1, EUR: 1.1 }, euaPriceEur: 80, year: 2026 },
    options: [A, B],
    ...overrides,
  };
}

function opt(plan: ReturnType<typeof planBunkers>, id: string) {
  const o = plan.options.find((x) => x.optionId === id);
  if (!o) throw new Error(`missing option ${id}`);
  return o;
}

describe("planBunkers", () => {
  it("option A: hand-computed cost lines", () => {
    // 13 nm / 13 kn = 1 h; daily 30 + 2.5 = 32.5 mt/day -> deviation fuel 32.5/24 = 1.354167 mt
    // port stay 5 + 6 + 0 = 11 h * 2.5 / 24 = 1.145833 mt
    // deviation cost (1.354167 + 1.145833) * 800 = 2 000
    // delay 1 + 11 = 12 h -> 12/24 * 16000 = 8 000; fuel 300 * 700 = 210 000; barge 2 000
    // CO2 = (1.354167 + 1.145833) * 3.206 = 8.015
    // ETS = (1.354167*3.206*0.5 + 1.145833*3.206*1) * 80 * 1.1 = 514.2958
    // total before FuelEU = 210000 + 2000 + 2000 + 8000 + 514.2958 = 222 514.2958
    // FuelEU 78.9982 (next test) → total 222 593.2940
    const a = opt(planBunkers(input()), "A");
    expect(a.feasible).toBe(true);
    expect(a.reasons).toEqual([]);
    expect(a.qtyMt).toBe(300);
    expect(a.headlinePriceUsdPerMt).toBe(700);
    expect(a.fuelCostUsd).toBeCloseTo(210000, 6);
    expect(a.bargeFeeUsd).toBeCloseTo(2000, 6);
    expect(a.deviationFuelMt).toBeCloseTo(1.354167, 6);
    expect(a.portStayFuelMt).toBeCloseTo(1.145833, 6);
    expect(a.deviationCostUsd).toBeCloseTo(2000, 6);
    expect(a.delayHours).toBeCloseTo(12, 9);
    expect(a.delayCostUsd).toBeCloseTo(8000, 6);
    expect(a.co2T).toBeCloseTo(8.015, 6);
    expect(a.etsCostUsd).toBeCloseTo(514.2958, 3);
    expect(a.totalCostUsd - a.fuelEuCostUsd).toBeCloseTo(222514.2958, 3);
    expect(a.totalCostUsd).toBeCloseTo(222593.294, 3);
    expect(a.effectivePriceUsdPerMt).toBeCloseTo(222593.294 / 300, 6);
  });

  it("option A: FuelEU exposure of the extra LSMGO burn, inside the total", () => {
    // MGO WtW intensity I = 14.4 + 3.26089 / 0.0427 = 90.767447; 2026 limit T = 89.3368
    // per mt MGO in scope: E = 42 700 MJ; |CB| = (I − T) × 42 700 g; penalty = |CB| / (I × 41 000) × 2 400
    //   = 1.430647 × 42 700 / 3 721 465.3 × 2 400 = 39.396507 EUR/mt
    // deviation 1.354167 mt × coverage 0.5 × 39.396507 = 26.674 EUR
    // stay (EU port) 1.145833 mt × coverage 1 × 39.396507 = 45.142 EUR
    // (26.674 + 45.142) = 71.81655 EUR × 1.1 = 78.9982 USD
    // total = 222 514.2958 (Phase 1 lines) + 78.9982 = 222 593.2940
    const a = opt(planBunkers(input()), "A");
    expect(a.fuelEuCostUsd).toBeCloseTo(78.9982, 3);
    expect(a.totalCostUsd).toBeCloseTo(222593.294, 3);
    expect(a.totalCostUsd - a.fuelEuCostUsd).toBeCloseTo(222514.2958, 3);
    expect(a.effectivePriceUsdPerMt).toBeCloseTo(222593.294 / 300, 6);
  });

  it("FuelEU follows the ETS scope: nothing for a non-EU stop with no deviation, stay only at coverage 0", () => {
    expect(opt(planBunkers(input()), "B").fuelEuCostUsd).toBe(0);
    // coverage 0: only the EU stay, 1.145833 × 39.396507 × 1.1 = 49.6560 USD
    expect(opt(planBunkers(input({ voyageEtsCoverage: 0 })), "A").fuelEuCostUsd).toBeCloseTo(
      49.656,
      3,
    );
    // before 2025 FuelEU does not apply
    const y2024 = input({ market: { fxToUsd: { USD: 1, EUR: 1.1 }, euaPriceEur: 80, year: 2024 } });
    expect(opt(planBunkers(y2024), "A").fuelEuCostUsd).toBe(0);
  });

  it("a load condition scales the deviation burn's main engine only", () => {
    // load factor 0.64: deviation daily 30 × 0.64 + 2.5 = 21.7 mt/day → 1 h → 0.904167 mt; stay unchanged
    const curve = { ...C, load: { displacementMt: 36_864, refDisplacementMt: 72_000 } };
    const a = opt(planBunkers(input({ curve })), "A");
    expect(a.deviationFuelMt).toBeCloseTo(21.7 / 24, 9);
    expect(a.portStayFuelMt).toBeCloseTo(1.145833, 6);
  });

  it("option B: zero deviation, non-EU stop", () => {
    // port stay 30 + 6 = 36 h * 2.5 / 24 = 3.75 mt -> 3 000; delay 36 h -> 24 000
    // fuel 300 * 690 = 207 000; barge 6 000; ETS 0 and FuelEU 0 (no deviation, non-EU port)
    // total = 207000 + 6000 + 3000 + 24000 = 240 000
    const b = opt(planBunkers(input()), "B");
    expect(b.deviationFuelMt).toBe(0);
    expect(b.portStayFuelMt).toBeCloseTo(3.75, 9);
    expect(b.deviationCostUsd).toBeCloseTo(3000, 6);
    expect(b.delayHours).toBeCloseTo(36, 9);
    expect(b.delayCostUsd).toBeCloseTo(24000, 6);
    expect(b.etsCostUsd).toBe(0);
    expect(b.totalCostUsd).toBeCloseTo(240000, 6);
  });

  it("ranks A first although B has the cheapest headline price", () => {
    const plan = planBunkers(input());
    expect(plan.options.map((o) => [o.optionId, o.rank])).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
    expect(plan.bestOptionId).toBe("A");
    expect(plan.cheapestHeadlineOptionId).toBe("B");
    // 240000 - 222593.2940 (A's total with its FuelEU 78.9982; B has none)
    expect(plan.savingVsCheapestHeadlineUsd).toBeCloseTo(17406.706, 3);
  });

  it("converts an EUR quote at the market rate", () => {
    // 690 EUR * 1.1 = 759 USD/mt; 300 * 759 = 227 700
    const plan = planBunkers(input({ options: [{ ...B, currency: "EUR" }] }));
    const b = opt(plan, "B");
    expect(b.headlinePriceUsdPerMt).toBeCloseTo(759, 9);
    expect(b.fuelCostUsd).toBeCloseTo(227700, 6);
    expect(b.bargeFeeUsd).toBeCloseTo(6600, 6);
  });

  it("flags insufficient quantity", () => {
    const o = opt(planBunkers(input({ options: [{ ...A, offeredQtyMt: 250 }] })), "A");
    expect(o.feasible).toBe(false);
    expect(o.reasons).toEqual(["insufficient_quantity"]);
  });

  it("flags unreachable with margin", () => {
    const o = opt(planBunkers(input({ options: [{ ...A, robAtArrivalMt: 60 }] })), "A");
    expect(o.reasons).toEqual(["unreachable_with_margin"]);
  });

  it("flags a missed berth window", () => {
    const o = opt(planBunkers(input({ options: [{ ...A, waitingHours: 60 }] })), "A");
    expect(o.reasons).toEqual(["misses_berth_window"]);
  });

  it("tank too small makes every option infeasible but still returns them", () => {
    const plan = planBunkers(input({ tankFreeMt: 200 }));
    expect(plan.options).toHaveLength(2);
    for (const o of plan.options) expect(o.reasons).toContain("exceeds_tank_capacity");
    expect(plan.bestOptionId).toBeNull();
    expect(plan.cheapestHeadlineOptionId).toBe("B");
    expect(plan.savingVsCheapestHeadlineUsd).toBeNull();
  });

  it("feasible options rank before infeasible ones even when dearer", () => {
    const plan = planBunkers(input({ options: [{ ...A, offeredQtyMt: 100 }, B] }));
    expect(plan.options.map((o) => o.optionId)).toEqual(["B", "A"]);
    expect(plan.bestOptionId).toBe("B");
  });

  it("ties rank by optionId", () => {
    const plan = planBunkers(
      input({
        options: [
          { ...B, optionId: "Z" },
          { ...B, optionId: "M" },
        ],
      }),
    );
    expect(plan.options.map((o) => o.optionId)).toEqual(["M", "Z"]);
    expect(plan.cheapestHeadlineOptionId).toBe("M");
  });

  it("rejects duplicate optionIds", () => {
    expect(() => planBunkers(input({ options: [A, { ...B, optionId: "A" }] }))).toThrow(
      /duplicate optionId/,
    );
  });

  it("empty options", () => {
    const plan = planBunkers(input({ options: [] }));
    expect(plan).toEqual({
      options: [],
      bestOptionId: null,
      cheapestHeadlineOptionId: null,
      savingVsCheapestHeadlineUsd: null,
    });
  });

  it("requiredQtyMt below minQtyMt throws RangeError", () => {
    expect(() => planBunkers(input({ requiredQtyMt: 40 }))).toThrow(RangeError);
  });

  it("is deterministic and independent of option order", () => {
    const one = JSON.stringify(planBunkers(input()));
    expect(JSON.stringify(planBunkers(input()))).toBe(one);
    expect(JSON.stringify(planBunkers(input({ options: [B, A] })))).toBe(one);
  });

  it("adds weather delay to the stop, the delay and the port-stay emissions", () => {
    // A with 12 h weather delay: stay 5+6+12 = 23 h → port-stay 2.5×23/24 = 2.395833 mt
    // deviation cost (1.354167 + 2.395833) × 800 = 3000; delay 1+23 = 24 h → 16000
    // ETS (1.354167×3.206×0.5 + 2.395833×3.206×1) × 80 × 1.1 = 866.9558
    // total before FuelEU 210000 + 2000 + 3000 + 16000 + 866.9558 = 231866.9558
    // FuelEU (1.354167 × 0.5 + 2.395833 × 1) × 39.396507 EUR × 1.1 = 133.1684 → 232 000.1242
    const a = opt(planBunkers(input({ options: [{ ...A, weatherDelayHours: 12 }] })), "A");
    expect(a.portStayFuelMt).toBeCloseTo(2.395833, 5);
    expect(a.deviationCostUsd).toBeCloseTo(3000, 4);
    expect(a.delayHours).toBeCloseTo(24, 9);
    expect(a.delayCostUsd).toBeCloseTo(16000, 4);
    expect(a.etsCostUsd).toBeCloseTo(866.9558, 3);
    expect(a.fuelEuCostUsd).toBeCloseTo(133.1684, 3);
    expect(a.totalCostUsd - a.fuelEuCostUsd).toBeCloseTo(231866.9558, 3);
    expect(a.totalCostUsd).toBeCloseTo(232000.1242, 3);
  });

  it("reports every failed check, in a fixed order", () => {
    const bad = { ...A, offeredQtyMt: 250, robAtArrivalMt: 60, waitingHours: 60 };
    const a = opt(planBunkers(input({ tankFreeMt: 200, options: [bad] })), "A");
    expect(a.reasons).toEqual([
      "insufficient_quantity",
      "exceeds_tank_capacity",
      "unreachable_with_margin",
      "misses_berth_window",
    ]);
  });

  it("with voyage ETS coverage 0 only the EU port stay is charged", () => {
    // 1.145833 mt × 3.206 × 1 × 80 × 1.1 = 323.2717
    const a = opt(planBunkers(input({ voyageEtsCoverage: 0 })), "A");
    expect(a.etsCostUsd).toBeCloseTo(323.2717, 3);
  });

  it("saving vs the cheapest headline is negative when that option is infeasible but cheaper", () => {
    // B with no wait: stay 6 h → 0.625 mt → 500; delay 6 h → 4000; total 207000+6000+500+4000 = 217500.
    // B is unreachable (ROB 60 < 65), so best = A (222593.2940 with FuelEU); saving = 217500 − 222593.2940.
    const b = { ...B, waitingHours: 0, robAtArrivalMt: 60 };
    const plan = planBunkers(input({ options: [A, b] }));
    expect(plan.bestOptionId).toBe("A");
    expect(plan.cheapestHeadlineOptionId).toBe("B");
    expect(plan.savingVsCheapestHeadlineUsd).toBeCloseTo(-5093.294, 3);
  });
});
