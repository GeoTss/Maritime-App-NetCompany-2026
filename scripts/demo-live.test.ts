import { describe, expect, it } from "vitest";
import { type LiveSnapshot, liveEnv, missingLive } from "./demo-live.js";

const want = { llm: "live", ais: "live", weather: "live" };

const ready: LiveSnapshot = {
  health: { status: "ok", llmMode: "live" },
  clock: { pinned: false },
  sources: {
    items: [
      { source: "ais", mode: "live", detail: "connected, 40 msgs" },
      { source: "weather", mode: "live", detail: "open-meteo" },
    ],
  },
  traffic: {
    items: [
      { mmsi: "111111111", name: "FLEET ONE" },
      { mmsi: "999999999", name: "PUBLIC SHIP" },
    ],
  },
  vessels: { items: [{ mmsi: "111111111" }] },
  webUp: true,
};

describe("liveEnv", () => {
  it("unpins the clock, reseeds, turns hazards on and defaults the three modes to live", () => {
    const env = liveEnv({ PATH: "/bin" });
    expect(env).toMatchObject({
      DEMO_ANCHOR: "",
      SEED_ON_BOOT: "reset",
      DEMO_HAZARDS: "on",
      LLM_MODE: "live",
      AIS_MODE: "live",
      WEATHER_MODE: "live",
      PATH: "/bin",
    });
  });

  it("a caller's LLM_MODE, AIS_MODE or WEATHER_MODE wins", () => {
    const env = liveEnv({ LLM_MODE: "replay", AIS_MODE: "replay", WEATHER_MODE: "recorded" });
    expect(env).toMatchObject({ LLM_MODE: "replay", AIS_MODE: "replay", WEATHER_MODE: "recorded" });
    expect(liveEnv({ LLM_MODE: "" }).LLM_MODE).toBe("live");
  });
});

describe("missingLive", () => {
  it("is empty for a fully live stack", () => {
    expect(missingLive(ready, want)).toEqual([]);
  });

  it("is empty for the free rehearsal (replay model, live sources)", () => {
    const s = { ...ready, health: { status: "ok", llmMode: "replay" } };
    expect(missingLive(s, { ...want, llm: "replay" })).toEqual([]);
  });

  it("names ANTHROPIC_API_KEY, never a value, when the api is not healthy", () => {
    const m = missingLive({ ...ready, health: null }, want);
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("ANTHROPIC_API_KEY");
  });

  it("flags a wrong llmMode", () => {
    const m = missingLive({ ...ready, health: { status: "ok", llmMode: "replay" } }, want);
    expect(m).toEqual(['api /api/health llmMode is "replay", wanted "live"']);
  });

  it("flags a pinned clock", () => {
    expect(missingLive({ ...ready, clock: { pinned: true } }, want)).toEqual([
      "api /api/clock is pinned: DEMO_ANCHOR must be empty for a live stack",
    ]);
  });

  it("flags AIS not live and AIS socket down, naming AISSTREAM_API_KEY", () => {
    const sources = (ais: object) => ({
      items: [
        { source: "weather", mode: "live" },
        { source: "ais", ...ais },
      ],
    });
    const replay = missingLive({ ...ready, sources: sources({ mode: "replay" }) }, want);
    expect(replay.join("|")).toContain("AISSTREAM_API_KEY");
    const down = missingLive(
      { ...ready, sources: sources({ mode: "live", detail: "socket down, showing last data" }) },
      want,
    );
    expect(down.join("|")).toMatch(/socket down.*AISSTREAM_API_KEY/);
  });

  it("flags weather that is not live (fell back to recorded)", () => {
    const s = {
      ...ready,
      sources: {
        items: [
          { source: "ais", mode: "live", detail: "ok" },
          { source: "weather", mode: "recorded" },
        ],
      },
    };
    expect(missingLive(s, want)).toEqual([
      'api /api/sources weather is "recorded", wanted "live" (Open-Meteo may be down)',
    ]);
  });

  it("needs a named ship outside the fleet: fleet-only or unnamed traffic is not proof", () => {
    const fleetOnly = { ...ready, traffic: { items: [{ mmsi: "111111111", name: "FLEET ONE" }] } };
    expect(missingLive(fleetOnly, want).join("|")).toContain("outside the fleet");
    const unnamed = { ...ready, traffic: { items: [{ mmsi: "999999999", name: "" }] } };
    expect(missingLive(unnamed, want).join("|")).toContain("outside the fleet");
  });

  it("flags unreadable fleet vessels and a web that is down", () => {
    const m = missingLive({ ...ready, vessels: null, webUp: false }, want);
    expect(m.join("|")).toContain("/api/vessels");
    expect(m.join("|")).toContain("web is not answering");
  });
});
