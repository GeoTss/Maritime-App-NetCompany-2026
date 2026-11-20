import { describe, expect, it } from "vitest";
import { costUsd, isPricedModel, promptTokensOf } from "./pricing.js";

const PRECISION = 12;

describe("costUsd (per-MTok figures from the pricing page, fetched 2026-11-14)", () => {
  it("Haiku 5.5: 1 000 input + 500 output = 0.0001 + 0.00025 = $0.00035", () => {
    const usage = { input_tokens: 1_000, output_tokens: 500 };
    expect(costUsd("claude-haiku-5-5", usage, promptTokensOf(usage))).toBeCloseTo(
      0.00035,
      PRECISION,
    );
  });

  it("Haiku 5.5 long-context tier: 90 000 input + 20 000 cache read + 1 000 output = $0.0485", () => {
    const usage = { input_tokens: 90_000, cache_read_input_tokens: 20_000, output_tokens: 1_000 };
    expect(promptTokensOf(usage)).toBe(110_000);
    // 0.045 + 0.001 + 0.0025
    expect(costUsd("claude-haiku-5-5", usage, 110_000)).toBeCloseTo(0.0485, PRECISION);
  });

  it("Haiku 5.5 at exactly 100 000 prompt tokens stays on the base tier", () => {
    const usage = { input_tokens: 100_000, output_tokens: 0 };
    expect(costUsd("claude-haiku-5-5", usage, 100_000)).toBeCloseTo(0.01, PRECISION);
  });

  it("Opus 5.5: 1 000 input + 500 output + 2 000 cache read = 0.004 + 0.010 + 0.0004 = $0.0144", () => {
    const usage = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 2_000 };
    expect(costUsd("claude-opus-5-5", usage, promptTokensOf(usage))).toBeCloseTo(0.0144, PRECISION);
  });

  it("Sonnet 5.5: 1 000 input + 500 output + 2 000 cache read + 400 5-min write = 0.002 + 0.005 + 0.0002 + 0.001 = $0.0082", () => {
    const usage = {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_read_input_tokens: 2_000,
      cache_creation_input_tokens: 400,
    };
    expect(costUsd("claude-sonnet-5-5", usage, promptTokensOf(usage))).toBeCloseTo(
      0.0082,
      PRECISION,
    );
  });

  it("Sonnet 5.5 has no long-context tier", () => {
    const usage = { input_tokens: 200_000, output_tokens: 0 };
    expect(costUsd("claude-sonnet-5-5", usage, 200_000)).toBeCloseTo(0.4, PRECISION);
  });

  it("Opus 5.5 has no long-context tier", () => {
    const usage = { input_tokens: 200_000, output_tokens: 0 };
    expect(costUsd("claude-opus-5-5", usage, 200_000)).toBeCloseTo(0.8, PRECISION);
  });

  it("prices the 5-minute / 1-hour cache-write split when present", () => {
    // Haiku base tier: 1 000 x $0.125 + 2 000 x $0.20 per MTok = 0.000125 + 0.0004
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 3_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 2_000 },
    };
    expect(costUsd("claude-haiku-5-5", usage, promptTokensOf(usage))).toBeCloseTo(
      0.000525,
      PRECISION,
    );
  });

  it("prices all cache writes as 5-minute when the split is absent", () => {
    // Opus: 1 000 x $5 per MTok
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000,
      cache_creation: null,
    };
    expect(costUsd("claude-opus-5-5", usage, 1_000)).toBeCloseTo(0.005, PRECISION);
  });

  it("treats null token counts as zero", () => {
    const usage = {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };
    expect(promptTokensOf(usage)).toBe(1_000);
    expect(costUsd("claude-haiku-5-5", usage, 1_000)).toBeCloseTo(0.00035, PRECISION);
  });

  it("matches a dated snapshot suffix of a known model", () => {
    const usage = { input_tokens: 1_000, output_tokens: 500 };
    expect(costUsd("claude-haiku-5-5-20261101", usage, 1_000)).toBeCloseTo(0.00035, PRECISION);
    expect(isPricedModel("claude-opus-5-5-20261001")).toBe(true);
  });

  it("throws on an unknown model and names it", () => {
    const usage = { input_tokens: 1, output_tokens: 1 };
    expect(() => costUsd("claude-sonnet-5", usage, 1)).toThrow(/claude-sonnet-5/);
    expect(() => costUsd("claude-haiku-5-5-extra", usage, 1)).toThrow();
    expect(isPricedModel("claude-haiku-5")).toBe(false);
  });
});
