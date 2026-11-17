import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "globals.css"), "utf8");
const token = (name: string) =>
  css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("token contrast", () => {
  it("hint text (text-3) reads at 4.5:1 on every row and hover surface", () => {
    for (const surface of ["ink-900", "ink-850", "ink-800"]) {
      expect(contrast(token("text-3"), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
