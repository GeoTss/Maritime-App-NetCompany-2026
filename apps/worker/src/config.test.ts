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
});
