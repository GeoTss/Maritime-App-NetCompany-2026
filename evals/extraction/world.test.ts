import { currentVoyage, generateWorld, openRequirements } from "@pharos/db";
import { describe, expect, it } from "vitest";
import {
  EVAL_ANCHOR,
  EVAL_SEED,
  evalExtraRequirements,
  evalWorld,
  freeSpace,
  openRequirementOf,
} from "./world.js";

describe("eval world (ruling R1)", () => {
  const base = generateWorld({ seed: EVAL_SEED, anchor: EVAL_ANCHOR });
  const extra = evalExtraRequirements(base);
  const world = evalWorld();

  it("uses the Phase 3 seed and anchor", () => {
    expect(EVAL_SEED).toBe(20261114);
    expect(EVAL_ANCHOR.toISOString()).toBe("2026-11-14T08:00:00.000Z");
  });

  it("adds one open requirement for exactly the vessels whose current voyage had none", () => {
    const lacking = base.vessels.filter((v) => {
      const voyage = currentVoyage(base, v.id);
      return voyage !== null && openRequirements(base, voyage.id).length === 0;
    });
    expect(lacking.length).toBeGreaterThan(0);
    expect(extra.map((r) => r.voyageId)).toEqual(lacking.map((v) => currentVoyage(base, v.id)?.id));
    for (const v of world.vessels) {
      const voyage = currentVoyage(world, v.id);
      expect(voyage && openRequirements(world, voyage.id)).toHaveLength(1);
      expect(openRequirementOf(world, v.id).status).toBe("open");
    }
  });

  it("each added requirement has a grade with tank capacity and a qty that fits", () => {
    for (const r of extra) {
      const voyage = world.voyages.find((x) => x.id === r.voyageId);
      const vessel = world.vessels.find((x) => x.id === voyage?.vesselId);
      if (!vessel) throw new Error("no vessel");
      expect(vessel.tankCapacityMt[r.grade]).toBeGreaterThan(0);
      expect(r.qtyMt).toBeGreaterThan(0);
      expect(r.qtyMt).toBeLessThanOrEqual(vessel.tankCapacityMt[r.grade]);
      expect(r.qtyMt).toBeLessThanOrEqual(freeSpace(world, vessel.id)[r.grade]);
      expect(r.qtyMt % 25).toBe(0);
      expect(r.createdAt.toISOString()).toBe(EVAL_ANCHOR.toISOString());
    }
  });

  it("continues ids after the seed's highest requirement id and is deterministic", () => {
    const maxBase = Math.max(...base.bunkerRequirements.map((r) => r.id));
    expect(extra.map((r) => r.id)).toEqual(extra.map((_, i) => maxBase + 1 + i));
    expect(evalExtraRequirements(generateWorld({ seed: EVAL_SEED, anchor: EVAL_ANCHOR }))).toEqual(
      extra,
    );
    expect(world.bunkerRequirements).toEqual([...base.bunkerRequirements, ...extra]);
  });

  it("leaves the rest of the seed world untouched", () => {
    const { bunkerRequirements: _a, ...rest } = world;
    const { bunkerRequirements: _b, ...baseRest } = base;
    expect(rest).toEqual(baseRest);
  });
});
