import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("web test project", () => {
  it("runs in a DOM environment and resolves the @ alias", () => {
    expect(typeof document.createElement).toBe("function");
    expect(cn("px-2", "px-3")).toBe("px-3");
  });
});
