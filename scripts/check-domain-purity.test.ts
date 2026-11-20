import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { checkSource } from "./check-domain-purity.mjs";

type Violation = { line: number; rule: string; snippet: string };
const rules = (src: string) =>
  (checkSource("packages/domain/src/x.ts", src) as Violation[]).map((v) => v.rule);

describe("checkSource", () => {
  it.each([
    ["const r = await fetch(url);", "network"],
    ["const x = Math.random();", "randomness"],
    ["const t = Date.now();", "hidden-clock"],
    ["const d = new Date();", "hidden-clock"],
    ["const t = performance.now();", "hidden-clock"],
    ["const k = process.env.KEY;", "env"],
    ['import Anthropic from "@anthropic-ai/sdk";', "forbidden-import"],
    ['import http from "node:http";', "forbidden-import"],
    ['import { readFileSync } from "fs";', "forbidden-import"],
    ['const m = await import("postgres");', "forbidden-import"],
  ])("flags %s", (src, rule) => {
    expect(rules(src)).toContain(rule);
  });

  it.each([
    'const d = new Date("2026-01-01T00:00:00Z");',
    "const d = new Date(isoString);",
    "prefetchPlan();",
    "// fetch(url) and Math.random() inside a comment are fine",
    "/* Date.now() in a block comment */ const a = 1;",
    'import { z } from "zod";',
    'import { LlmMode } from "@pharos/shared";',
    'import distance from "@turf/distance";',
    'import { leg } from "./legs.js";',
    'const label = "process.env is not read here";',
  ])("allows %s", (src) => {
    expect(rules(src)).toEqual([]);
  });

  it("reports the line number", () => {
    const v = checkSource("x.ts", "const a = 1;\nconst b = Math.random();") as Violation[];
    expect(v[0]?.line).toBe(2);
  });
});
