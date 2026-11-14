import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("loadConfig", () => {
  it("refuses live mode without an API key and names the variable", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "live" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, LLM_MODE: "live" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("refuses record mode without an API key", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "record", ANTHROPIC_API_KEY: "  " })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("boots in replay mode without a key", () => {
    const c = loadConfig({ ...base, LLM_MODE: "replay" });
    expect(c.llmMode).toBe("replay");
    expect(c.anthropicApiKey).toBeUndefined();
    expect(c.port).toBe(4000);
  });

  it("defaults to live mode", () => {
    expect(() => loadConfig({ ...base })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("rejects an unknown LLM_MODE", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "offline" })).toThrow(/LLM_MODE/);
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({ LLM_MODE: "replay" })).toThrow(/DATABASE_URL/);
  });

  it("never includes the key value in error messages", () => {
    try {
      loadConfig({ LLM_MODE: "nope", ANTHROPIC_API_KEY: "sk-secret-value" });
    } catch (e) {
      expect(String(e)).not.toContain("sk-secret-value");
    }
  });

  it("defaults SEED_ON_BOOT to if-empty and WORLD_SEED to 20261114", () => {
    const c = loadConfig({ ...base, LLM_MODE: "replay" });
    expect(c.seedOnBoot).toBe("if-empty");
    expect(c.worldSeed).toBe(20261114);
  });

  it("accepts SEED_ON_BOOT=reset and a custom WORLD_SEED", () => {
    const c = loadConfig({ ...base, LLM_MODE: "replay", SEED_ON_BOOT: "reset", WORLD_SEED: "7" });
    expect(c.seedOnBoot).toBe("reset");
    expect(c.worldSeed).toBe(7);
  });

  it("rejects an unknown SEED_ON_BOOT and names the variable", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "replay", SEED_ON_BOOT: "bogus" })).toThrow(
      /SEED_ON_BOOT/,
    );
  });

  it("requires WORLD_SEED to be an integer", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "replay", WORLD_SEED: "1.5" })).toThrow(
      /WORLD_SEED/,
    );
  });
});
