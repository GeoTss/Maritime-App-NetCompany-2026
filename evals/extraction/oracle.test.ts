import { describe, expect, it } from "vitest";
import type { QuoteTranscription } from "./case.js";
import { buildOracle } from "./oracle.js";

const doc = {
  sender: "trader@kestrel-fuels.example",
  subject: "Offer 300 mt LSMGO",
  bodyText: [
    "Further to your enquiry for 300 mt:",
    "  Quantity: 300 mt  ",
    "Price: USD 738.50 per mt",
    "Kestrel Marine Fuels",
  ].join("\n"),
};

const t = (over: Partial<QuoteTranscription>): QuoteTranscription => ({
  kind: "quote",
  supplierName: { value: "Kestrel Marine Fuels" },
  vesselName: null,
  vesselImo: null,
  port: null,
  deliveryFrom: null,
  deliveryTo: null,
  validUntil: null,
  bargeFee: null,
  lines: [
    {
      grade: null,
      quantity: { value: 300, unit: "mt", asWritten: "300 mt", near: "Quantity" },
      price: { value: 738.5, currency: "USD", perUnit: "per mt", asWritten: "USD 738.50 per mt" },
    },
  ],
  ...over,
});

describe("buildOracle", () => {
  it("copies each evidence line from the text, trimmed, preferring the labelled line", () => {
    const out = buildOracle(t({}), doc);
    if (out.kind !== "quote") throw new Error("expected a quote");
    expect(out.supplierName).toEqual({
      value: "Kestrel Marine Fuels",
      evidence: "Kestrel Marine Fuels",
    });
    expect(out.lines[0]?.quantity.evidence).toBe("Quantity: 300 mt");
    expect(out.lines[0]?.price.evidence).toBe("Price: USD 738.50 per mt");
    expect(out.vesselName).toEqual({ value: null, evidence: null });
    expect(out.bargeFee).toEqual({
      value: null,
      currency: null,
      perUnit: null,
      asWritten: null,
      evidence: null,
    });
    expect(out.notes).toBeNull();
  });

  it("falls back to the Subject line when the body does not hold the value", () => {
    const out = buildOracle(t({ vesselName: { value: "LSMGO" } }), doc);
    if (out.kind !== "quote") throw new Error("expected a quote");
    expect(out.vesselName.evidence).toBe("Subject: Offer 300 mt LSMGO");
  });

  it("throws when no line holds the span on token boundaries (a template bug)", () => {
    const tooShort = t({
      lines: [
        {
          grade: null,
          quantity: { value: 30, unit: "mt", asWritten: "30 mt" },
          price: { value: 738, currency: "USD", perUnit: "per mt", asWritten: "USD 738" },
        },
      ],
    });
    expect(() => buildOracle(tooShort, doc)).toThrow(/30 mt/);
    expect(() => buildOracle(t({ port: { value: "Kestrel", near: "Port" } }), doc)).toThrow(
      /near "Port"/,
    );
  });

  it("builds a not-a-quote oracle from the identifying line", () => {
    expect(
      buildOracle(
        { kind: "not_a_quote", reason: "An enquiry.", evidence: { value: "Further to" } },
        doc,
      ),
    ).toEqual({
      kind: "not_a_quote",
      reason: "An enquiry.",
      evidence: "Further to your enquiry for 300 mt:",
    });
  });
});
