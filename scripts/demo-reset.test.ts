import { describe, expect, it } from "vitest";
import { composeEnv, missing, type Snapshot } from "./demo-reset.js";

const ready: Snapshot = {
  health: { status: "ok" },
  clock: { pinned: true },
  sources: {
    items: [
      { source: "ais", mode: "recorded" },
      { source: "weather", mode: "recorded" },
    ],
  },
  traffic: { items: [{ mmsi: "1" }] },
  webUp: true,
};

describe("composeEnv", () => {
  it("pins the demo world and defaults to replay", () => {
    const env = composeEnv({ PATH: "/bin" });
    expect(env).toMatchObject({
      DEMO_ANCHOR: "2026-11-14T08:00:00Z",
      SEED_ON_BOOT: "reset",
      LLM_MODE: "replay",
      AIS_MODE: "replay",
      WEATHER_MODE: "recorded",
      DEMO_HAZARDS: "on",
      PATH: "/bin",
    });
  });

  it("honours an LLM_MODE set by the caller and overrides the world settings", () => {
    const env = composeEnv({ LLM_MODE: "record", AIS_MODE: "live", DEMO_HAZARDS: "off" });
    expect(env.LLM_MODE).toBe("record");
    expect(env.AIS_MODE).toBe("replay");
    expect(env.DEMO_HAZARDS).toBe("on");
  });

  it("treats an empty LLM_MODE as unset", () => {
    expect(composeEnv({ LLM_MODE: "" }).LLM_MODE).toBe("replay");
  });
});

describe("missing", () => {
  it("is empty for a ready stack", () => {
    expect(missing(ready)).toEqual([]);
  });

  it("names everything missing from a stack that is not up", () => {
    const m = missing({ health: null, clock: null, sources: null, traffic: null, webUp: false });
    expect(m).toHaveLength(6);
    expect(m.join("|")).toMatch(/health.*clock.*ais.*weather.*traffic.*web/);
  });

  it("flags a degraded api, an unpinned clock, a live source and empty traffic", () => {
    const m = missing({
      ...ready,
      health: { status: "degraded" },
      clock: { pinned: false },
      sources: {
        items: [
          { source: "ais", mode: "live" },
          { source: "weather", mode: "recorded" },
        ],
      },
      traffic: { items: [] },
    });
    expect(m).toEqual([
      "api /api/health is not ok",
      "api /api/clock is not pinned",
      "api /api/sources ais is not recorded",
      "api /api/traffic has no items",
    ]);
  });

  it("flags a missing source row and a web that is not answering", () => {
    const m = missing({
      ...ready,
      sources: { items: [{ source: "ais", mode: "recorded" }] },
      webUp: false,
    });
    expect(m).toEqual([
      "api /api/sources weather is not recorded",
      "web is not answering on http://localhost:5173",
    ]);
  });
});
