import { describe, expect, it } from "vitest";
import { FALLBACK_BETA, usesFallbacks } from "./fallbacks.js";

describe("usesFallbacks", () => {
  it("is on only for an Opus model with LLM_FALLBACKS on", () => {
    expect(usesFallbacks("claude-opus-5-5", true)).toBe(true);
    expect(usesFallbacks("claude-opus-5-5", false)).toBe(false);
    expect(usesFallbacks("claude-haiku-5-5", true)).toBe(false);
    expect(usesFallbacks("claude-haiku-5-5", false)).toBe(false);
  });

  it("names the server-side fallback beta", () => {
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
  });
});
