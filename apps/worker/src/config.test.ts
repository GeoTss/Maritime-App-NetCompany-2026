import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@h/db" };

describe("loadWorkerConfig", () => {
  it("defaults to replay and recorded", () => {
    expect(loadWorkerConfig(base)).toMatchObject({ aisMode: "replay", weatherMode: "recorded" });
  });

  it("loads the synthetic hazard in replay mode, and in live mode only with DEMO_HAZARDS=on", () => {
    const live = { ...base, AIS_MODE: "live", AISSTREAM_API_KEY: "k" };
    expect(loadWorkerConfig(base).loadSyntheticHazards).toBe(true);
    expect(loadWorkerConfig(live, () => {}).loadSyntheticHazards).toBe(false);
    expect(loadWorkerConfig({ ...live, DEMO_HAZARDS: "on" }, () => {}).loadSyntheticHazards).toBe(
      true,
    );
    expect(loadWorkerConfig({ ...base, AIS_MODE: "off" }).loadSyntheticHazards).toBe(false);
  });

  it("live without a key runs the replay and says which variable is missing", () => {
    const logs: string[] = [];
    const cfg = loadWorkerConfig({ ...base, AIS_MODE: "live", AISSTREAM_API_KEY: "" }, (l) =>
      logs.push(l),
    );
    expect(cfg.aisMode).toBe("replay");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("AISSTREAM_API_KEY");
  });

  it("a whitespace-only key counts as not set; a padded key is trimmed", () => {
    const logs: string[] = [];
    const blank = loadWorkerConfig({ ...base, AIS_MODE: "live", AISSTREAM_API_KEY: "  \n" }, (l) =>
      logs.push(l),
    );
    expect(blank).toMatchObject({ aisMode: "replay", aisApiKey: undefined });
    expect(logs[0]).toContain("AISSTREAM_API_KEY");
    const padded = loadWorkerConfig(
      { ...base, AIS_MODE: "live", AISSTREAM_API_KEY: " k\n" },
      () => {},
    );
    expect(padded).toMatchObject({ aisMode: "live", aisApiKey: "k" });
  });

  it("live with a key stays live", () => {
    const cfg = loadWorkerConfig({ ...base, AIS_MODE: "live", AISSTREAM_API_KEY: "k" }, () => {});
    expect(cfg.aisMode).toBe("live");
  });

  it("rejects a bad mode or a missing database URL naming the variable, not the value", () => {
    expect(() => loadWorkerConfig({ ...base, AIS_MODE: "bogus-value" })).toThrow(/AIS_MODE/);
    try {
      loadWorkerConfig({ ...base, AIS_MODE: "bogus-value" });
    } catch (e) {
      expect(String(e)).not.toContain("bogus-value");
    }
    expect(() => loadWorkerConfig({})).toThrow(/DATABASE_URL/);
  });

  it("DEMO_ANCHOR is optional, parsed to a Date, and a bad value fails naming the variable", () => {
    expect(loadWorkerConfig(base).demoAnchor).toBeUndefined();
    expect(loadWorkerConfig({ ...base, DEMO_ANCHOR: "" }).demoAnchor).toBeUndefined();
    expect(loadWorkerConfig({ ...base, DEMO_ANCHOR: "2026-11-16T08:00:00Z" }).demoAnchor).toEqual(
      new Date("2026-11-16T08:00:00.000Z"),
    );
    expect(() => loadWorkerConfig({ ...base, DEMO_ANCHOR: "tomorrow" })).toThrow(/DEMO_ANCHOR/);
  });
});
