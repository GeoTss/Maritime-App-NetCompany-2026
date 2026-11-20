import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CRITICAL_FIELDS,
  ExtractionTruth,
  SECURITY_CRITICAL_FIELDS,
  type TruthSecurityQuote,
} from "./extraction-truth.js";

const GOLDEN = resolve(import.meta.dirname, "../../../../evals/golden/extraction");

const security: TruthSecurityQuote = {
  provider: "Tridentis Marine Protection",
  vesselImo: "9485069",
  embarkUnlocode: "AEFJR",
  disembarkUnlocode: "DJJIB",
  teamSize: 4,
  dayRate: 1250,
  currency: "USD",
  fixedFees: 6000,
  minDays: 4,
  validUntil: "2026-11-20",
};

const securityTruth = (expected: Record<string, unknown>) => ({
  id: "security-plain-001",
  tags: ["security-plain"],
  source: "generated",
  expected: {
    kind: "security_quote",
    status: "extracted",
    reviewChecks: [],
    quote: null,
    security,
    ...expected,
  },
});

describe("ExtractionTruth: security quotes (Track 3)", () => {
  it("parses an extracted security truth and a needs_review one with a null team size", () => {
    expect(ExtractionTruth.safeParse(securityTruth({})).success).toBe(true);
    const review = securityTruth({
      status: "needs_review",
      reviewChecks: ["team_size_unambiguous"],
      security: { ...security, teamSize: null },
    });
    expect(ExtractionTruth.safeParse(review).success).toBe(true);
  });

  it("requires a security record, a null quote and a quote-like status", () => {
    const { security: _, ...noSecurity } = securityTruth({}).expected;
    expect(ExtractionTruth.safeParse({ ...securityTruth({}), expected: noSecurity }).success).toBe(
      false,
    );
    expect(ExtractionTruth.safeParse(securityTruth({ security: null })).success).toBe(false);
    expect(
      ExtractionTruth.safeParse(
        securityTruth({ security: null, status: "needs_review", reviewChecks: ["x"] }),
      ).success,
    ).toBe(true);
    expect(ExtractionTruth.safeParse(securityTruth({ status: "not_a_quote" })).success).toBe(false);
    const withFuel = securityTruth({
      quote: {
        vesselImo: null,
        portUnlocode: null,
        supplierKey: null,
        currency: null,
        validUntil: null,
        deliveryFrom: null,
        deliveryTo: null,
        bargeFee: null,
        lines: [{ grade: null, qtyMt: null, pricePerMt: null }],
      },
    });
    expect(ExtractionTruth.safeParse(withFuel).success).toBe(false);
  });

  it("rejects a security record on a fuel or not-a-quote truth, and a fractional team", () => {
    const naq = securityTruth({ kind: "not_a_quote", status: "not_a_quote" });
    expect(ExtractionTruth.safeParse(naq).success).toBe(false);
    const half = securityTruth({ security: { ...security, teamSize: 3.5 } });
    expect(ExtractionTruth.safeParse(half).success).toBe(false);
    const extra = securityTruth({ security: { ...security, guards: 4 } });
    expect(ExtractionTruth.safeParse(extra).success).toBe(false);
  });

  it("names the security critical fields beside the fuel ones", () => {
    expect(SECURITY_CRITICAL_FIELDS).toEqual([
      "vessel",
      "embarkPort",
      "disembarkPort",
      "teamSize",
      "dayRate",
      "currency",
      "fixedFees",
      "minDays",
      "validUntil",
    ]);
    expect(CRITICAL_FIELDS).toHaveLength(9);
  });

  it("every truth on disk parses, and a fuel truth round-trips without a security key", async () => {
    const files = (await readdir(GOLDEN)).filter((f) => f.endsWith(".truth.json"));
    expect(files.length).toBeGreaterThanOrEqual(240);
    for (const f of files) {
      const raw = JSON.parse(await readFile(join(GOLDEN, f), "utf8"));
      const parsed = ExtractionTruth.parse(raw);
      if (parsed.expected.kind !== "security_quote") {
        expect("security" in parsed.expected, f).toBe(false);
        expect(parsed, f).toEqual(raw);
      }
    }
  });
});
