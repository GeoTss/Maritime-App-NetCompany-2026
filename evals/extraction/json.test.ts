import { describe, expect, it } from "vitest";
import { stableJson } from "./json.js";

describe("stableJson", () => {
  it("expands objects, keeps short primitive arrays inline and ends with a newline", () => {
    expect(stableJson({ id: "a", tags: ["x", "y"], n: null, e: [], o: {} })).toBe(
      '{\n  "id": "a",\n  "tags": ["x", "y"],\n  "n": null,\n  "e": [],\n  "o": {}\n}\n',
    );
  });

  it("breaks a primitive array that would pass 100 columns, one item per line", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `plain-${String(i).padStart(3, "0")}`);
    const out = stableJson({ dev: ids });
    expect(out.split("\n").every((l) => l.length <= 100)).toBe(true);
    expect(out).toContain('"dev": [\n    "plain-000",\n    "plain-001",');
  });

  it("puts every object of an array on its own lines", () => {
    expect(stableJson({ lines: [{ a: 1 }] })).toBe(
      '{\n  "lines": [\n    {\n      "a": 1\n    }\n  ]\n}\n',
    );
  });

  it("keeps the given key order and drops undefined members", () => {
    expect(stableJson({ b: 1, a: 2, c: undefined })).toBe('{\n  "b": 1,\n  "a": 2\n}\n');
  });

  it("refuses values JSON cannot hold", () => {
    expect(() => stableJson({ x: Number.NaN })).toThrow(TypeError);
  });
});
