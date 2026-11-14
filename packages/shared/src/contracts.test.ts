import { describe, expect, it } from "vitest";
import {
  ConsumptionCurve,
  ExtractionOutput,
  GradeAmounts,
  ProposedAction,
  Provenance,
  RouteLeg,
} from "./index.js";

const text = (value: string | null, evidence: string | null = value) => ({ value, evidence });
const date = (asWritten: string | null) => ({ asWritten, evidence: asWritten });
const money = (value: number | null, currency: string | null, perUnit: string | null) => ({
  value,
  currency,
  perUnit,
  asWritten: value === null ? null : `${currency}${value}`,
  evidence: value === null ? null : `Price ${currency}${value} ${perUnit}`,
});

const quote = {
  kind: "quote",
  supplierName: text("Nordwind Bunker Services"),
  vesselName: text("MV Aegean Pioneer"),
  vesselImo: text(null),
  port: text("Algeciras"),
  deliveryFrom: date("18 Nov"),
  deliveryTo: date(null),
  validUntil: date("valid until 16:00 CET today"),
  bargeFee: money(3000, "€", "lump sum"),
  lines: [
    {
      grade: text("LSMGO 0.1%S"),
      quantity: {
        value: null,
        unit: "mt",
        asWritten: "300/350 mt",
        evidence: "We can offer 300/350 mt LSMGO.",
      },
      price: money(690, "€", "pmt"),
    },
  ],
  notes: null,
};

describe("ExtractionOutput", () => {
  it("accepts a quote with null fields but valid shape", () => {
    const parsed = ExtractionOutput.parse(quote);
    expect(parsed.kind).toBe("quote");
    if (parsed.kind === "quote") {
      expect(parsed.lines[0]?.quantity.value).toBeNull();
      expect(parsed.bargeFee.currency).toBe("€");
    }
  });

  it("rejects a quote with no lines", () => {
    expect(ExtractionOutput.safeParse({ ...quote, lines: [] }).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(ExtractionOutput.safeParse({ ...quote, totalUsd: 207000 }).success).toBe(false);
  });

  it("rejects an omitted field instead of treating it as null", () => {
    const { notes: _notes, ...withoutNotes } = quote;
    expect(ExtractionOutput.safeParse(withoutNotes).success).toBe(false);
  });

  it("parses not_a_quote", () => {
    const parsed = ExtractionOutput.parse({
      kind: "not_a_quote",
      reason: "Port agent's arrival notice, no prices",
      evidence: "Please find attached the arrival notice.",
    });
    expect(parsed.kind).toBe("not_a_quote");
  });
});

describe("ProposedAction", () => {
  const action = {
    type: "purchase_order",
    calculationId: 1,
    optionId: "o1",
    factRefs: ["f_a"],
    rationale: "lowest total cost",
  };

  it("accepts a reference to a stored calculation", () => {
    expect(ProposedAction.parse(action).type).toBe("purchase_order");
  });

  it("rejects a model-typed quantity", () => {
    expect(ProposedAction.safeParse({ ...action, qtyMt: 300 }).success).toBe(false);
  });

  it("rejects a proposal with no cited facts", () => {
    expect(ProposedAction.safeParse({ ...action, factRefs: [] }).success).toBe(false);
  });
});

describe("Provenance", () => {
  it("discriminates on source", () => {
    expect(
      Provenance.parse({ source: "db", table: "noon_reports", rowId: 4, field: "robMt.LSMGO" })
        .source,
    ).toBe("db");
    expect(Provenance.safeParse({ source: "db", table: "noon_reports", rowId: 4 }).success).toBe(
      false,
    );
    expect(
      Provenance.safeParse({ source: "derived", operation: "subtract", operands: [] }).success,
    ).toBe(false);
    expect(
      Provenance.safeParse({ source: "derived", operation: "subtract", operands: ["f_a", "f_b"] })
        .success,
    ).toBe(true);
  });
});

describe("domain primitives", () => {
  it("GradeAmounts rejects negative mt", () => {
    expect(GradeAmounts.safeParse({ LSMGO: -1, VLSFO: 0, HSFO: 0 }).success).toBe(false);
  });

  it("RouteLeg rejects an ETS coverage that is not 0, 0.5 or 1", () => {
    const leg = {
      id: 1,
      fromPortId: 1,
      toPortId: 2,
      distanceNm: 100,
      requiredGrade: "LSMGO",
      etsCoverage: 0.5,
      waypoints: [
        { lat: 31.26, lon: 32.31 },
        { lat: 35.82, lon: 14.54 },
      ],
    };
    expect(RouteLeg.safeParse(leg).success).toBe(true);
    expect(RouteLeg.safeParse({ ...leg, etsCoverage: 0.7 }).success).toBe(false);
  });

  it("ConsumptionCurve rejects maxSpeedKn < minSpeedKn", () => {
    const curve = {
      refSpeedKn: 13,
      refMtPerDay: 30,
      auxMtPerDay: 2.5,
      minSpeedKn: 8,
      maxSpeedKn: 16,
    };
    expect(ConsumptionCurve.safeParse(curve).success).toBe(true);
    expect(ConsumptionCurve.safeParse({ ...curve, maxSpeedKn: 7 }).success).toBe(false);
  });
});
