// @vitest-environment node
/**
 * Lint-style checks over the console's source: rules a type checker cannot see.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

describe("console source rules", () => {
  it("MetricNumber is not used inside FactChip", () => {
    for (const name of ["components/fact-chip.tsx", "components/fact-text.tsx"]) {
      const file = files.find((f) => f.path === name);
      expect(file, `${name} exists`).toBeDefined();
      expect(file?.text).not.toMatch(/metric-number|MetricNumber|@number-flow/);
    }
  });

  it("dangerouslySetInnerHTML appears only in components/ui/chart.tsx", () => {
    const offenders = files
      .filter((f) => f.text.includes("dangerouslySetInnerHTML"))
      .map((f) => f.path);
    expect(offenders).toEqual(["components/ui/chart.tsx"]);
  });

  it("NumberFlow is used only through MetricNumber", () => {
    const offenders = files
      .filter(
        (f) => f.text.includes("@number-flow/react") && f.path !== "components/metric-number.tsx",
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no component carries a raw hex colour", () => {
    const offenders = files
      .filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(f.text.replace(/&#\d+;/g, "")))
      .filter((f) => !f.path.startsWith("components/ui/"))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the console calls the network only through lib/api.ts and lib/sse.ts", () => {
    const offenders = files
      .filter((f) => /\bfetch\(/.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== "lib/api.ts" && p !== "lib/sse.ts");
    expect(offenders).toEqual([]);
  });
});
