import { describe, expect, it } from "vitest";
import { RecommendationType } from "./entities.js";
import { SecurityArea, SecurityPlanResult, SecurityQuoteCandidate } from "./security.js";

describe("security contracts", () => {
  it("parses a cited danger area and a quote candidate", () => {
    expect(
      SecurityArea.parse({
        id: "gulf-of-aden",
        name: "Gulf of Aden",
        level: "SUBSTANTIAL",
        policy: "guards",
        boxes: [{ minLat: 11, maxLat: 15, minLon: 43, maxLon: 51.5 }],
        asOf: "2026-11-09",
        source: "Maritime Security Report 2nd-9th November 2026, Palaemon Maritime",
        note: "JMIC SUBSTANTIAL (secondary)",
      }).policy,
    ).toBe("guards");
    expect(
      SecurityQuoteCandidate.parse({
        quoteId: 1,
        providerId: 2,
        embark: { portId: 3, position: { lat: 25.1, lon: 56.4 } },
        disembark: { portId: 4, position: { lat: 29.9, lon: 32.5 } },
        teamSize: 4,
        dayRateUsd: 1400,
        fixedFeesUsd: 6000,
        minDays: 5,
        validUntil: null,
      }).teamSize,
    ).toBe(4);
  });

  it("parses an empty security plan and knows the security order", () => {
    expect(
      SecurityPlanResult.parse({
        spans: [],
        needsTeam: false,
        quoteId: null,
        embarkPortId: null,
        disembarkPortId: null,
        embarkAt: null,
        disembarkAt: null,
        teamDays: 0,
        costLines: [],
        extraCostUsd: 0,
        convoyWaitHours: 0,
      }).needsTeam,
    ).toBe(false);
    expect(RecommendationType.parse("security_order")).toBe("security_order");
  });
});
