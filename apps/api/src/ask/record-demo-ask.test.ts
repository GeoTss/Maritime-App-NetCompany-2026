import { describe, expect, it } from "vitest";
import { ledgerableCostUsd } from "./record-demo-ask.js";

describe("ledgerableCostUsd", () => {
  it("counts only calls that reached the model, not recordings reused in record mode", () => {
    expect(
      ledgerableCostUsd([
        { mode: "record", cost_usd: 0.002 },
        { mode: "replay", cost_usd: 0.01 },
        { mode: "record", cost_usd: 0.003 },
      ]),
    ).toBeCloseTo(0.005, 9);
    expect(ledgerableCostUsd([{ mode: "replay", cost_usd: 0.01 }])).toBe(0);
  });
});
