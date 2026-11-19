import { describe, expect, it } from "vitest";
import { DraftedMessage } from "./entities.js";
import {
  NauticalItem,
  PortCallResult,
  PortCallTerms,
  StormCell,
  VesselStores,
} from "./port-call.js";
import { StopPlanReason } from "./routing.js";

describe("port-call contracts", () => {
  it("parses the demo vessel's stores and Marsaxlokk's terms", () => {
    expect(
      VesselStores.parse({
        crew: 22,
        provisionsPersonDays: 264,
        sludgeM3: 11,
        sludgeCapacityM3: 14,
        sewageM3: 6,
        sewageCapacityM3: 15,
        onBoard: [{ itemId: "142", edition: "2023", editionDate: "2023-06-01" }],
      }).crew,
    ).toBe(22);
    expect(
      PortCallTerms.parse({
        portDuesUsd: 3200,
        clearanceHours: 2,
        stores: true,
        provisionsUsdPerPersonDay: 12,
        storesHours: 4,
        wasteReception: true,
        sludgeUsdPerM3: 180,
        sewageUsdPerM3: 60,
        wasteHours: 3,
        euWasteFeeUsd: 950,
      }).portDuesUsd,
    ).toBe(3200);
  });

  it("parses a catalogue item, a storm cell and an empty port call", () => {
    expect(
      NauticalItem.parse({
        itemId: "142",
        kind: "chart",
        title: "Strait of Gibraltar",
        edition: "2026",
        editionDate: "2026-04-30",
        priceUsd: 45,
        coverage: [{ minLat: 35.6, maxLat: 36.4, minLon: -6.2, maxLon: -4.8 }],
        source: "test",
      }).kind,
    ).toBe("chart");
    expect(
      StormCell.parse({
        id: "storm:44,-8",
        center: { lat: 44, lon: -8 },
        radiusNm: 80,
        maxWaveHeightM: 8.1,
        from: "2026-11-17T08:00:00.000Z",
        to: "2026-11-18T08:00:00.000Z",
      }).id,
    ).toBe("storm:44,-8");
    expect(
      PortCallResult.parse({
        jobs: [],
        costLines: [{ kind: "port_dues", usd: 3200 }],
        extraCostUsd: 3200,
        notices: [],
        outdated: [],
        provisionsDaysAtEta: 50,
        sludgeM3AtEta: 1,
        sewageM3AtEta: 6,
      }).extraCostUsd,
    ).toBe(3200);
  });

  it("knows the new reasons and draft kinds", () => {
    for (const r of [
      "provisions_unavailable",
      "waste_reception_unavailable",
      "notice_overdue",
      "heavy_weather",
    ])
      expect(StopPlanReason.parse(r)).toBe(r);
    expect(DraftedMessage.shape.kind.options).toEqual(
      expect.arrayContaining(["agent_request", "pre_arrival_notice"]),
    );
  });
});
