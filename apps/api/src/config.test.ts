import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("defaults ERP_BASE_URL to the local ERP simulator", () => {
    expect(loadConfig({ ...base, LLM_MODE: "replay" }).erpBaseUrl).toBe("http://localhost:4100");
    expect(loadConfig({ ...base, LLM_MODE: "replay", ERP_BASE_URL: " " }).erpBaseUrl).toBe(
      "http://localhost:4100",
    );
  });

  it("accepts an http(s) ERP_BASE_URL and rejects anything else, naming the variable", () => {
    const c = loadConfig({ ...base, LLM_MODE: "replay", ERP_BASE_URL: "http://erp:4100" });
    expect(c.erpBaseUrl).toBe("http://erp:4100");
    for (const bad of ["erp:4100", "ftp://erp:4100", "not a url"]) {
      try {
        loadConfig({ ...base, LLM_MODE: "replay", ERP_BASE_URL: bad });
        expect.unreachable(`ERP_BASE_URL=${bad} must be rejected`);
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect(String(e)).toMatch(/ERP_BASE_URL/);
        expect(String(e)).not.toContain(bad);
      }
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

  it("accepts WORLD_SEED up to 2147483647 and rejects larger values without echoing them", () => {
    const c = loadConfig({ ...base, LLM_MODE: "replay", WORLD_SEED: "2147483647" });
    expect(c.worldSeed).toBe(2147483647);
    try {
      loadConfig({ ...base, LLM_MODE: "replay", WORLD_SEED: "2147483648" });
      expect.unreachable("WORLD_SEED above 2147483647 must be rejected");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect(String(e)).toMatch(/WORLD_SEED/);
      expect(String(e)).not.toContain("2147483648");
    }
  });

  describe("DEMO_ANCHOR", () => {
    const replay = { ...base, LLM_MODE: "replay" };

    it("is unset (null) by default and when blank, as Compose passes it", () => {
      expect(loadConfig(replay).demoAnchor).toBeNull();
      expect(loadConfig({ ...replay, DEMO_ANCHOR: "" }).demoAnchor).toBeNull();
      expect(loadConfig({ ...replay, DEMO_ANCHOR: "  " }).demoAnchor).toBeNull();
    });

    it("parses an ISO instant, with Z or an offset", () => {
      expect(
        loadConfig({ ...replay, DEMO_ANCHOR: "2026-11-14T08:00:00Z" }).demoAnchor?.toISOString(),
      ).toBe("2026-11-14T08:00:00.000Z");
      expect(
        loadConfig({
          ...replay,
          DEMO_ANCHOR: "2026-11-14T10:00:00+02:00",
        }).demoAnchor?.toISOString(),
      ).toBe("2026-11-14T08:00:00.000Z");
    });

    it("fails fast on anything that is not an ISO instant, naming the variable", () => {
      for (const bad of ["2026-11-14", "tomorrow", "2026-13-40T08:00:00Z", "2026-11-14T08:00:00"]) {
        try {
          loadConfig({ ...replay, DEMO_ANCHOR: bad });
          expect.unreachable(`DEMO_ANCHOR=${bad} must be rejected`);
        } catch (e) {
          expect(e).toBeInstanceOf(ConfigError);
          expect(String(e)).toMatch(/DEMO_ANCHOR/);
        }
      }
    });
  });

  it("requires WORLD_SEED to be an integer", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "replay", WORLD_SEED: "1.5" })).toThrow(
      /WORLD_SEED/,
    );
  });

  describe("LLM settings", () => {
    const replay = { ...base, LLM_MODE: "replay" };
    const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

    it("defaults both models to claude-haiku-5-5, effort to medium and fallbacks off", () => {
      const c = loadConfig(replay);
      expect(c.extractModel).toBe("claude-haiku-5-5");
      expect(c.agentModel).toBe("claude-haiku-5-5");
      expect(c.extractEffort).toBe("medium");
      expect(c.agentEffort).toBe("medium");
      expect(c.llmFallbacks).toBe(false);
    });

    it("treats blank values (as Compose passes them) as defaults", () => {
      const c = loadConfig({
        ...replay,
        EXTRACT_MODEL: "",
        AGENT_MODEL: " ",
        EXTRACT_EFFORT: "",
        AGENT_EFFORT: "",
        LLM_FALLBACKS: "",
        RECORDINGS_DIR: "",
      });
      expect(c.agentModel).toBe("claude-haiku-5-5");
      expect(c.agentEffort).toBe("medium");
      expect(c.llmFallbacks).toBe(false);
      expect(c.recordingsDir).toBe(join(repoRoot, "fixtures", "llm-recordings"));
    });

    it("switches a model and effort from env without code changes", () => {
      const c = loadConfig({
        ...replay,
        AGENT_MODEL: "claude-opus-5-5",
        AGENT_EFFORT: "high",
        EXTRACT_EFFORT: "low",
      });
      expect(c.agentModel).toBe("claude-opus-5-5");
      expect(c.extractModel).toBe("claude-haiku-5-5");
      expect(c.agentEffort).toBe("high");
      expect(c.extractEffort).toBe("low");
    });

    it("accepts every effort level and rejects others, naming the variable", () => {
      for (const level of ["low", "medium", "high", "xhigh", "max"]) {
        expect(loadConfig({ ...replay, EXTRACT_EFFORT: level }).extractEffort).toBe(level);
      }
      expect(() => loadConfig({ ...replay, AGENT_EFFORT: "extreme" })).toThrow(/AGENT_EFFORT/);
    });

    it("rejects a model with no pricing entry, naming the variable", () => {
      expect(() => loadConfig({ ...replay, EXTRACT_MODEL: "claude-sonnet-1" })).toThrow(
        /EXTRACT_MODEL/,
      );
    });

    it("parses LLM_FALLBACKS on/off", () => {
      expect(loadConfig({ ...replay, LLM_FALLBACKS: "off" }).llmFallbacks).toBe(false);
      expect(loadConfig({ ...replay, LLM_FALLBACKS: "on" }).llmFallbacks).toBe(true);
      expect(() => loadConfig({ ...replay, LLM_FALLBACKS: "maybe" })).toThrow(/LLM_FALLBACKS/);
    });

    it("defaults RECORDINGS_DIR to <repo>/fixtures/llm-recordings, independent of cwd", () => {
      const c = loadConfig(replay);
      expect(isAbsolute(c.recordingsDir)).toBe(true);
      expect(c.recordingsDir).toBe(join(repoRoot, "fixtures", "llm-recordings"));
    });

    it("resolves a relative RECORDINGS_DIR against the repo root and keeps an absolute one", () => {
      expect(loadConfig({ ...replay, RECORDINGS_DIR: "tmp/rec" }).recordingsDir).toBe(
        join(repoRoot, "tmp", "rec"),
      );
      expect(loadConfig({ ...replay, RECORDINGS_DIR: "/var/rec" }).recordingsDir).toBe("/var/rec");
    });
  });
});
