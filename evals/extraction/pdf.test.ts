import { describe, expect, it } from "vitest";
import { extractPdfText } from "../../apps/api/src/ingest/pdf-text.js";
import { buildImageOnlyPdf, buildTextPdf } from "./pdf.js";

describe("golden PDFs", () => {
  it("a text PDF is byte-stable and its cells on one row read as one line", async () => {
    const rows = [
      { text: "KESTREL MARINE FUELS", bold: true, size: 15 },
      { gap: 6 },
      {
        cells: [
          { text: "LSMGO 0.1%", x: 0 },
          { text: "300 mt", x: 170 },
          { text: "€683.50/mt", x: 290 },
        ],
      },
    ];
    const a = await buildTextPdf(rows);
    expect(Buffer.from(await buildTextPdf(rows)).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(a).toString("latin1")).not.toMatch(/CreationDate|ModDate|Producer/);
    expect(await extractPdfText(a)).toBe("KESTREL MARINE FUELS\nLSMGO 0.1% 300 mt €683.50/mt");
  });

  it("the image-only PDF is byte-stable, holds an image and has no text layer", async () => {
    const a = await buildImageOnlyPdf();
    expect(Buffer.from(await buildImageOnlyPdf()).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(a).toString("latin1")).toContain("/Subtype /Image");
    expect((await extractPdfText(a)).trim()).toBe("");
  });
});
