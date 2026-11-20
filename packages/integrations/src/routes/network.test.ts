import { execFileSync } from "node:child_process";
import { SeaNetwork } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { buildSeaNetwork, serialiseNetwork } from "./build-network.js";
import { loadSeaNetwork } from "./network.js";

describe("sea network", () => {
  it("the committed file parses as a SeaNetwork with usable segments", () => {
    const n = loadSeaNetwork();
    expect(SeaNetwork.safeParse(n).success).toBe(true);
    expect(n.segments.length).toBeGreaterThan(2000);
    expect(n.segments.every((s) => s.length >= 2)).toBe(true);
    expect(loadSeaNetwork()).toBe(n);
  });

  it("regeneration is byte-identical to the committed file (--check)", () => {
    const out = execFileSync(
      "npx",
      ["tsx", new URL("./build-network.ts", import.meta.url).pathname, "--check"],
      { encoding: "utf8" },
    );
    expect(out).toContain("up to date");
    expect(serialiseNetwork(buildSeaNetwork())).toBe(serialiseNetwork(loadSeaNetwork()));
  });
});
