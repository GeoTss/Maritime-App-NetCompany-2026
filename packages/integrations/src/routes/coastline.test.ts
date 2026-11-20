import { buildCoastIndex, withinNmOfLand } from "@pharos/domain";
import { describe, expect, it } from "vitest";
import { loadCoastline } from "./coastline.js";

describe("loadCoastline", () => {
  it("knows Lisbon is on the coast and the open Ionian is not", () => {
    const index = buildCoastIndex(loadCoastline());
    expect(withinNmOfLand({ lat: 38.69, lon: -9.3 }, index, 12)).toBe(true);
    expect(withinNmOfLand({ lat: 36.5, lon: 18.5 }, index, 12)).toBe(false);
  });
});
