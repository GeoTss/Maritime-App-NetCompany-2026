import { inSulphurEca } from "@pharos/domain";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD_SEED } from "./demo-clock.js";
import { generateWorld } from "./seed/world.js";

const world = generateWorld({
  seed: DEFAULT_WORLD_SEED,
  anchor: new Date("2026-11-14T08:00:00Z"),
});

describe("world invariants", () => {
  // Three readers look a fuel price up differently (seed/demo-plan.ts takes the first row,
  // route-plan.ts the latest asOf, ingest/resolve.ts filters). They agree only while there is
  // exactly one row per port and grade, so this pins it.
  it("one price row per port and grade", () => {
    const seen = new Map<string, number>();
    for (const r of world.portFuelPrices) {
      const key = `${r.portId}|${r.grade}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(seen.size).toBeGreaterThan(0);
    const dupes = [...seen].filter(([, n]) => n !== 1).map(([k]) => k);
    expect(dupes).toEqual([]);
  });

  // The hand-set Port.inEca (seed/scenario.ts) and the optimiser's inSulphurEca (domain/eca.ts)
  // are two notions of the same fact; nothing else checks they agree.
  it("Port.inEca agrees with inSulphurEca for every port", () => {
    expect(world.ports.length).toBeGreaterThan(0);
    const disagree = world.ports
      .filter((port) => port.inEca !== inSulphurEca({ lat: port.lat, lon: port.lon }))
      .map((port) => `${port.unlocode}: inEca=${port.inEca} inSulphurEca=${!port.inEca}`);
    expect(disagree).toEqual([]);
  });
});
