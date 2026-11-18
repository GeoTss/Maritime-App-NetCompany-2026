import type { NauticalItem, PortCallTerms, VesselStores } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import {
  outdatedItems,
  type PortCallArgs,
  portCallPlan,
  preArrivalNotices,
  provisionsDaysLeft,
  sewageGeneratedM3,
  sludgeGeneratedM3,
} from "./port-call.js";

const stores: VesselStores = {
  crew: 22,
  provisionsPersonDays: 264,
  sludgeM3: 11,
  sludgeCapacityM3: 14,
  sewageM3: 6,
  sewageCapacityM3: 15,
  onBoard: [{ itemId: "142", edition: "2023", editionDate: "2023-06-01" }],
};
const terms: PortCallTerms = {
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
};
const now = new Date("2026-11-14T08:00:00Z");
const args = (over: Partial<PortCallArgs> = {}): PortCallArgs => ({
  stores,
  terms,
  portIsEu: true,
  now,
  arriveAt: new Date("2026-11-16T00:00:00Z"),
  hoursToStop: 40,
  hoursToEta: 240,
  stayHours: 12,
  fuelToStopMt: { LSMGO: 0, VLSFO: 100, HSFO: 0 },
  fuelTotalMt: { LSMGO: 30, VLSFO: 300, HSFO: 0 },
  outdated: [],
  bunkeringHours: 6,
  ...over,
});
const job = (r: ReturnType<typeof portCallPlan>, kind: string) =>
  r.jobs.find((j) => j.kind === kind);

describe("projections", () => {
  it("counts provisions, sludge and sewage", () => {
    expect(provisionsDaysLeft(stores, 48)).toBeCloseTo(10, 9);
    expect(sludgeGeneratedM3({ VLSFO: 300, LSMGO: 30, HSFO: 0 })).toBeCloseTo(3.09, 9);
    expect(sewageGeneratedM3(22, 24)).toBeCloseTo(1.54, 9);
  });
});

describe("portCallPlan", () => {
  it("resupplies provisions when the voyage would end under the reserve", () => {
    const r = portCallPlan(args());
    const p = job(r, "provisions");
    expect(p?.needed && p.done).toBe(true);
    expect(p?.qty).toBeCloseTo(22 * 60 - (264 - (22 * 40) / 24), 9);
    expect(r.reasons).toEqual([]);
  });

  it("delivers sludge when the tank would pass 90 % before the destination", () => {
    const r = portCallPlan(args());
    const s = job(r, "sludge");
    expect(s?.needed && s.done).toBe(true);
    expect(s?.qty).toBeCloseTo(12, 9);
    expect(s?.costUsd).toBeCloseTo(12 * 180, 9);
    expect(r.sludgeM3AtEta).toBeCloseTo(2.09, 9);
  });

  it("is infeasible when the port cannot take the waste", () => {
    const r = portCallPlan(args({ terms: { ...terms, wasteReception: false } }));
    expect(r.reasons).toContain("waste_reception_unavailable");
    expect(job(r, "sludge")?.done).toBe(false);
  });

  it("costs the call and runs the jobs alongside bunkering", () => {
    const r = portCallPlan(args({ bunkeringHours: 2 }));
    expect(r.serviceHours).toBe(4);
    const kinds = r.costLines.map((c) => c.kind);
    expect(kinds).toEqual(["port_dues", "provisions", "sludge", "eu_waste_fee"]);
    expect(r.extraCostUsd).toBeCloseTo(
      r.costLines.reduce((a, c) => a + c.usd, 0),
      9,
    );
  });
});

describe("preArrivalNotices", () => {
  it("overdue notice: an arrival 10 h away makes the plan infeasible", () => {
    const r = portCallPlan(args({ arriveAt: new Date(now.getTime() + 10 * 3_600_000) }));
    expect(r.reasons).toContain("notice_overdue");
    expect(r.notices).toHaveLength(3);
  });

  it("non-EU stop has two notices and no EU waste fee", () => {
    const n = preArrivalNotices(new Date("2026-11-16T00:00:00Z"), false, now);
    expect(n.map((x) => x.kind)).toEqual(["agent_appointment", "security_pre_arrival"]);
    expect(n[0]?.dueAt).toBe("2026-11-15T00:00:00.000Z");
    const r = portCallPlan(args({ portIsEu: false }));
    expect(r.costLines.some((c) => c.kind === "eu_waste_fee")).toBe(false);
  });
});

describe("outdatedItems", () => {
  const chart: NauticalItem = {
    itemId: "142",
    kind: "chart",
    title: "Strait of Gibraltar",
    edition: "2026",
    editionDate: "2026-04-30",
    priceUsd: 45,
    coverage: [{ minLat: 35.6, maxLat: 36.4, minLon: -6.2, maxLon: -4.8 }],
    source: "test",
  };
  const passes = [{ areaId: "142", enterNm: 500 }];
  const at = (nm: number) => new Date(Date.UTC(2026, 10, 15) + nm * 60_000).toISOString();

  it("flags an older edition, in time when the stop comes first", () => {
    const r = outdatedItems(
      stores.onBoard,
      [chart],
      passes,
      { nm: 100, position: { lat: 40, lon: 0 } },
      at,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      itemId: "142",
      onBoardEdition: "2023",
      inTime: true,
      priceUsd: 45,
    });
    expect(r[0]?.neededAt).toBe(at(500));
  });

  it("is late after the area unless the stop lies inside it", () => {
    const late = outdatedItems(
      stores.onBoard,
      [chart],
      passes,
      { nm: 600, position: { lat: 40, lon: 0 } },
      at,
    );
    expect(late[0]?.inTime).toBe(false);
    const inside = outdatedItems(
      stores.onBoard,
      [chart],
      passes,
      { nm: 600, position: { lat: 36.1, lon: -5.35 } },
      at,
    );
    expect(inside[0]?.inTime).toBe(true);
  });

  it("ignores current editions and areas the route never enters", () => {
    const current = [{ itemId: "142", edition: "2026", editionDate: "2026-04-30" }];
    expect(
      outdatedItems(current, [chart], passes, { nm: 0, position: { lat: 0, lon: 0 } }, at),
    ).toEqual([]);
    expect(outdatedItems([], [chart], [], { nm: 0, position: { lat: 0, lon: 0 } }, at)).toEqual([]);
  });
});
