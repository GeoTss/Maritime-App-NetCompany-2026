import { generateWorld } from "@pharos/db";
import { describe, expect, it } from "vitest";
import { vesselNeedsFacts } from "./vessel-needs.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });

describe("vesselNeedsFacts", () => {
  it("cites Aegean Pioneer's stores, waste and the four out-of-date items", () => {
    const ap = world.vessels.find((v) => v.name === "MV Aegean Pioneer");
    if (!ap) throw new Error("no Aegean Pioneer");
    const needs = vesselNeedsFacts(world, ap);
    expect(needs?.crew.value).toBe(22);
    expect(needs?.sludgeM3).toMatchObject({ value: 11.8, unit: "m3" });
    expect(needs?.outdated.map((o) => o.current.provenance)).toHaveLength(4);
    expect(needs?.outdated[0]?.onBoard?.value).toBe("2023");
  });

  it("is null for a vessel without stores data", () => {
    const ap = world.vessels[0];
    if (!ap) throw new Error("no vessel");
    expect(vesselNeedsFacts(world, { ...ap, stores: null })).toBeNull();
  });
});
