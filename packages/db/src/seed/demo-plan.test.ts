import { createHash } from "node:crypto";
import { planBunkers } from "@pharos/domain";
import { describe, expect, it } from "vitest";
import {
  type BunkerOffer,
  buildBunkerPlanInput,
  buildDemoBunkerPlanInput,
  DEFAULT_BUNKERING_HOURS,
  demoVoyageState,
  optionIdFor,
} from "./demo-plan.js";
import { DEMO_SCENARIO, SUPPLIERS } from "./scenario.js";
import { generateWorld } from "./world.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00.000Z") });
const byCode = (code: string) => {
  const p = world.ports.find((x) => x.unlocode === code);
  if (!p) throw new Error(`no port ${code}`);
  return p;
};
const supplierByKey = (key: string) => {
  const name = SUPPLIERS.find((s) => s.key === key)?.name;
  const s = world.suppliers.find((x) => x.name === name);
  if (!s) throw new Error(`no supplier ${key}`);
  return s;
};

const demoOffers = (): BunkerOffer[] =>
  DEMO_SCENARIO.options.map((o) => ({
    optionId: o.optionId,
    quoteId: null,
    supplierId: supplierByKey(o.supplierKey).id,
    portId: byCode(o.portLocode).id,
    currency: o.currency,
    pricePerMt: o.pricePerMt,
    bargeFee: o.bargeFee,
    qtyMt: o.qtyMt,
  }));

describe("buildBunkerPlanInput", () => {
  const { voyage } = demoVoyageState(world);

  it("offers equal to the demo options give the same planBunkers result as the demo input", () => {
    const fromOffers = buildBunkerPlanInput(world, voyage.id, demoOffers());
    const demo = buildDemoBunkerPlanInput(world);
    expect(JSON.stringify(fromOffers)).toBe(JSON.stringify(demo));
    expect(JSON.stringify(planBunkers(fromOffers))).toBe(JSON.stringify(planBunkers(demo)));
  });

  it("a later AIS congestion row leaves the plan input unchanged", () => {
    const gib = byCode("GIGIB").id;
    const before = buildBunkerPlanInput(world, voyage.id, demoOffers());
    const withAis = {
      ...world,
      portCongestion: [
        ...world.portCongestion,
        {
          id: 9999,
          portId: gib,
          observedAt: new Date("2026-11-15T00:00:00.000Z"),
          anchoredCount: 40,
          waitingHours: 60,
          source: "ais" as const,
        },
      ],
    };
    expect(buildBunkerPlanInput(withAis, voyage.id, demoOffers())).toEqual(before);
  });

  it("demo plan matches the output pinned in Phase 6 task 2 (load condition + FuelEU)", () => {
    // Re-pinned for the joint route-and-bunker planner (seed joint-plan-v1, LSMGO 203 t): totals
    // are unchanged; at the planned 12.5 kn Algeciras and Gibraltar are now reached below the
    // LSMGO margin (unreachable_with_margin), so Marsaxlokk is the only feasible stop.
    // Re-pinned in the commit "Phase 6 task 2: db and seed …" (base 67cc481): the demo voyage now
    // sails laden (54 000 t cargo, load factor 0.9610) and every total carries the FuelEU
    // exposure. Values taken by running this code on seed 20261114 / anchor 2026-11-14T08:00:00Z.
    // The Phase 1 pin (5da5fe9: 67d3caa3…, totals 233 914.449 / 239 202.823 / 250 085.992) is
    // kept as the legacy test below: with no load, total − FuelEU is unchanged.
    const plan = planBunkers(buildDemoBunkerPlanInput(world));
    expect(createHash("sha256").update(JSON.stringify(plan)).digest("hex")).toBe(
      "9925123c42b0d15acfc95c1ae4d2e371e350f092bdc23a52ff541b3605e0f822",
    );
    expect(plan.bestOptionId).toBe("MTMLA-kestrel");
    expect(plan.cheapestHeadlineOptionId).toBe("GIGIB-straitline");
    expect(plan.savingVsCheapestHeadlineUsd).toBeCloseTo(16138.452312674606, 6);
    expect(plan.options.map((o) => [o.optionId, o.rank, o.feasible, o.totalCostUsd])).toEqual([
      ["MTMLA-kestrel", 1, true, 233942.91134964247],
      ["ESALG-nordwind", 2, false, 239253.2780543905],
      ["GIGIB-straitline", 3, false, 250081.36366231708],
    ]);
  });

  it("legacy input: with no load, total − FuelEU equals the Phase 1 totals (old maths intact)", () => {
    // The demo input with the load taken off the curve: every Phase 1 cost line is unchanged and
    // the only difference in the total is the new FuelEU term.
    const input = buildDemoBunkerPlanInput(world);
    const { load: _load, ...curve } = input.curve;
    const plan = planBunkers({ ...input, curve });
    expect(plan.options.map((o) => [o.optionId, o.totalCostUsd - o.fuelEuCostUsd])).toEqual([
      ["MTMLA-kestrel", expect.closeTo(233914.44900287892, 6)],
      ["ESALG-nordwind", expect.closeTo(239202.82313363682, 6)],
      ["GIGIB-straitline", expect.closeTo(250085.99188110302, 6)],
    ]);
    for (const o of plan.options) expect(o.fuelEuCostUsd).toBeGreaterThan(0);
  });

  it("the demo input carries the demo voyage's load on the curve", () => {
    const { vessel, voyage: v } = demoVoyageState(world);
    expect(buildDemoBunkerPlanInput(world).curve).toEqual({
      ...vessel.consumptionCurve,
      load: {
        displacementMt: vessel.lightshipMt + v.cargoMt + v.ballastMt,
        refDisplacementMt: vessel.lightshipMt + vessel.dwt,
      },
    });
  });

  it("rejects an offer from a supplier that is not in the world", () => {
    const offers = demoOffers().map((o, i) => (i === 0 ? { ...o, supplierId: 987_654 } : o));
    expect(() => buildBunkerPlanInput(world, voyage.id, offers)).toThrow(/supplier 987654/);
  });

  it("is deterministic", () => {
    const a = buildBunkerPlanInput(world, voyage.id, demoOffers());
    const b = buildBunkerPlanInput(world, voyage.id, demoOffers());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("every demo port's approachNm equals its demo deviationNm", () => {
    for (const o of DEMO_SCENARIO.options) {
      expect(byCode(o.portLocode).approachNm, o.optionId).toBe(o.deviationNm);
    }
  });

  it("every demo option uses the default bunkering hours", () => {
    for (const o of DEMO_SCENARIO.options) expect(o.bunkeringHours).toBe(DEFAULT_BUNKERING_HOURS);
    expect(DEFAULT_BUNKERING_HOURS).toBe(6);
  });

  it("carries live quote ids and takes deviation from the port", () => {
    const offers = demoOffers().map((o, i) => ({ ...o, quoteId: 100 + i }));
    const input = buildBunkerPlanInput(world, voyage.id, offers);
    expect(input.options.map((o) => o.quoteId)).toEqual([100, 101, 102]);
    expect(input.options.map((o) => o.deviationNm)).toEqual([14, 12, 4]);
  });

  it("accepts an empty offer list and rejects an unknown voyage", () => {
    expect(buildBunkerPlanInput(world, voyage.id, []).options).toEqual([]);
    expect(() => buildBunkerPlanInput(world, 999_999, [])).toThrow(/voyage 999999/);
  });
});

describe("optionIdFor", () => {
  it("matches the demo option ids", () => {
    for (const o of DEMO_SCENARIO.options) {
      expect(optionIdFor(byCode(o.portLocode), supplierByKey(o.supplierKey))).toBe(o.optionId);
    }
  });

  it("throws for a supplier that is not in the scenario", () => {
    expect(() =>
      optionIdFor(byCode("MTMLA"), { ...supplierByKey("kestrel"), name: "Nobody" }),
    ).toThrow(/no scenario key/);
  });
});
