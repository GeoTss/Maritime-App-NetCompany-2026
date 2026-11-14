import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdf-text.js";

const fixture = join(import.meta.dirname, "../../../../fixtures/smoke/sample-quote.pdf");

describe("extractPdfText", () => {
  it("returns the text layer of a quote PDF", async () => {
    const text = await extractPdfText(new Uint8Array(readFileSync(fixture)));
    expect(text).toContain("LSMGO");
    expect(text).toContain("420 mt");
    expect(text).toContain("742.50");
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(extractPdfText(new TextEncoder().encode("not a pdf"))).rejects.toThrow();
  });
});
