/** The held-out passes file: which held-out cases a final live pass has already run. */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appendPass,
  assertNotRun,
  HELDOUT_PASSES_PATH,
  HeldoutRerunError,
  type PassRow,
  readPasses,
} from "./heldout-passes.js";

const tempPath = () => join(mkdtempSync(join(tmpdir(), "heldout-passes-")), "passes.jsonl");
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const row = (over: Partial<PassRow> = {}): PassRow => ({
  suite: "extraction",
  id: "case-001",
  run: 1,
  at: "2026-11-16T10:00:00.000Z",
  label: "p7-heldout",
  report: "20261116T100000Z-extraction-heldout-p7-heldout",
  outcome: "graded",
  ...over,
});

describe("readPasses", () => {
  it("a missing file reads as empty", () => {
    const path = tempPath();
    expect(existsSync(path)).toBe(false);
    expect(readPasses(path)).toEqual([]);
  });

  it("reads every row and names a bad line", () => {
    const path = tempPath();
    writeFileSync(path, `${JSON.stringify(row())}\n\n${JSON.stringify(row({ id: "b" }))}\n`);
    expect(readPasses(path).map((r) => r.id)).toEqual(["case-001", "b"]);
    writeFileSync(path, `${JSON.stringify(row())}\n{"suite":"qa"}\n`);
    expect(() => readPasses(path)).toThrow(/line 2/);
  });
});

describe("assertNotRun", () => {
  it("assertNotRun throws HeldoutRerunError naming an id already listed", () => {
    const path = tempPath();
    appendPass(row({ id: "case-007" }), path);
    appendPass(row({ id: "case-007", run: 2 }), path);
    appendPass(row({ suite: "qa", id: "lookup-09" }), path);
    let caught: unknown = null;
    try {
      assertNotRun("extraction", ["case-001", "case-007", "case-008"], path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HeldoutRerunError);
    expect((caught as Error).message).toMatch(/case-007/);
    expect((caught as Error).message).not.toMatch(/case-001|case-008/);
    // Ids with no row, a missing file, and another suite's rows do not refuse.
    expect(() => assertNotRun("extraction", ["case-001", "case-008"], path)).not.toThrow();
    expect(() => assertNotRun("extraction", ["case-007"], tempPath())).not.toThrow();
    expect(() => assertNotRun("extraction", ["lookup-09"], path)).not.toThrow();
    expect(() => assertNotRun("qa", ["lookup-09"], path)).toThrow(HeldoutRerunError);
  });
});

describe("appendPass", () => {
  it("appendPass writes one strict JSON line", () => {
    const path = tempPath();
    appendPass(row(), path);
    appendPass(row({ id: "case-002", outcome: "error:api_error" }), path);
    const lines = readFileSync(path, "utf8").split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0] ?? "")).toEqual(row());
    expect(readPasses(path)).toEqual([row(), row({ id: "case-002", outcome: "error:api_error" })]);

    // A row with an unknown key, a bad run or an empty field is refused and nothing is written.
    const before = readFileSync(path, "utf8");
    expect(() => appendPass({ ...row(), extra: 1 } as PassRow, path)).toThrow();
    expect(() => appendPass(row({ run: 0 }), path)).toThrow();
    expect(() => appendPass(row({ outcome: "" }), path)).toThrow();
    expect(() => appendPass(row({ at: "yesterday" }), path)).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("HELDOUT_PASSES_PATH", () => {
  it("is evals/heldout-passes.jsonl (only the CLI main() uses it)", () => {
    expect(relative(REPO_ROOT, HELDOUT_PASSES_PATH)).toBe(join("evals", "heldout-passes.jsonl"));
  });
});
