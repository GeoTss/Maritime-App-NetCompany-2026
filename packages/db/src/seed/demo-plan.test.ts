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
