import { generateWorld } from "@pharos/db";
import type { SecurityQuoteExtraction } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { evaluateSecurityQuote } from "./evaluate-security.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
const body = [
  "Dear Desk,",
  "We can provide a team of 4 guards for MT Atlantic Meridian.",
  "Embarkation: Fujairah. Disembarkation: Djibouti.",
  "Rate: USD 1,250 per day for the team, minimum 4 days.",
  "Fixed fees: USD 6,000 lump sum (embarkation, disembarkation and arms storage).",
  "Offer valid until 20 November 2026.",
].join("\n");
const doc = {
  sender: "ops@tridentis-marine.example",
  subject: "Armed security quote",
  bodyText: body,
};
const t = (value: string | null, evidence: string | null) => ({ value, evidence });
const extraction = (team: {
  value: number | null;
  asWritten: string;
}): SecurityQuoteExtraction => ({
  kind: "security_quote",
  providerName: t(null, null),
  vesselName: t(
    "MT Atlantic Meridian",
    "We can provide a team of 4 guards for MT Atlantic Meridian.",
  ),
  vesselImo: t(null, null),
  embarkPort: t("Fujairah", "Embarkation: Fujairah. Disembarkation: Djibouti."),
  disembarkPort: t("Djibouti", "Embarkation: Fujairah. Disembarkation: Djibouti."),
  teamSize: {
    value: team.value,
    unit: "guards",
    asWritten: team.asWritten,
    evidence: "We can provide a team of 4 guards for MT Atlantic Meridian.",
  },
  dayRate: {
    value: 1250,
    currency: "USD",
    perUnit: "per day",
    asWritten: "USD 1,250 per day",
    evidence: "Rate: USD 1,250 per day for the team, minimum 4 days.",
  },
  fixedFees: {
    value: 6000,
    currency: "USD",
    perUnit: "lump sum",
    asWritten: "USD 6,000 lump sum",
    evidence: "Fixed fees: USD 6,000 lump sum (embarkation, disembarkation and arms storage).",
  },
  minDays: {
    value: 4,
    unit: "days",
    asWritten: "4 days",
    evidence: "Rate: USD 1,250 per day for the team, minimum 4 days.",
  },
  validUntil: { asWritten: "20 November 2026", evidence: "Offer valid until 20 November 2026." },
  notes: null,
});
const ctx = {
  receivedAt: new Date("2026-11-14T08:00:00Z"),
  hasUnreadableAttachment: false,
  validityWritten: true,
};

describe("evaluateSecurityQuote", () => {
  it("extracts a clean quote: provider by sender domain, both ports, team, rate, fees, days", () => {
    const r = evaluateSecurityQuote(
      world,
      doc,
      extraction({ value: 4, asWritten: "4 guards" }),
      ctx,
    );
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.status).toBe("extracted");
    const port = (u: string) => world.ports.find((p) => p.unlocode === u)?.id;
    expect(r.securityQuote).toMatchObject({
      providerId: world.securityProviders.find((p) => p.name === "Tridentis Marine Protection")?.id,
      embarkPortId: port("AEFJR"),
      disembarkPortId: port("DJJIB"),
      teamSize: 4,
      dayRate: 1250,
      fixedFees: 6000,
      minDays: 4,
      currency: "USD",
      validUntil: "2026-11-20",
    });
  });

  it("holds a team size written two ways for review, never guessed", () => {
    const r = evaluateSecurityQuote(
      world,
      doc,
      extraction({ value: null, asWritten: "4/6 guards" }),
      ctx,
    );
    expect(r.status).toBe("needs_review");
    expect(r.securityQuote).toBeNull();
    expect(r.checks.find((c) => c.check === "team_size_unambiguous")?.passed).toBe(false);
  });
  it("reads the team size from what was written, not from the value alone", () => {
    const r = evaluateSecurityQuote(
      world,
      doc,
      extraction({ value: 4, asWritten: "4/6 guards" }),
      ctx,
    );
    expect(r.status).toBe("needs_review");
    expect(r.checks.find((c) => c.check === "team_size_unambiguous")?.passed).toBe(false);
  });

  const failed = (r: ReturnType<typeof evaluateSecurityQuote>) =>
    r.checks.filter((c) => !c.passed).map((c) => c.check);
  const absent = { value: null, asWritten: null, evidence: null };

  it("holds a quote for review when its fees, minimum days or validity were not transcribed", () => {
    const base = extraction({ value: 4, asWritten: "4 guards" });
    const noFees = { ...base, fixedFees: { ...absent, currency: null, perUnit: null } };
    const noDays = { ...base, minDays: { ...absent, unit: null } };
    const noValidity = { ...base, validUntil: { asWritten: null, evidence: null } };
    for (const [q, check] of [
      [noFees, "amounts_parsed"],
      [noDays, "amounts_parsed"],
      [noValidity, "dates_parsed"],
    ] as const) {
      const r = evaluateSecurityQuote(world, doc, q, ctx);
      expect(r.status).toBe("needs_review");
      expect(r.securityQuote).toBeNull();
      expect(failed(r)).toContain(check);
    }
  });

  it("reads a team size written as one number word, and not two", () => {
    const one = evaluateSecurityQuote(
      world,
      doc,
      extraction({ value: 4, asWritten: "four guards" }),
      ctx,
    );
    expect(failed(one)).not.toContain("team_size_unambiguous");
    const two = evaluateSecurityQuote(
      world,
      doc,
      extraction({ value: 4, asWritten: "four or six guards" }),
      ctx,
    );
    expect(failed(two)).toContain("team_size_unambiguous");
  });

  it("reads minimum days written with their own word (\"minimum of 4 days\")", () => {
    const base = extraction({ value: 4, asWritten: "4 guards" });
    for (const asWritten of ["minimum of 4 days", "min. 4 days", "4 days minimum"]) {
      const q = { ...base, minDays: { ...base.minDays, asWritten } };
      const r = evaluateSecurityQuote(world, doc, q, ctx);
      expect(failed(r), asWritten).not.toContain("amounts_parsed");
    }
  });

  it("holds several separate fees (value left null) for review rather than storing the first", () => {
    const base = extraction({ value: 4, asWritten: "4 guards" });
    const q = { ...base, fixedFees: { ...base.fixedFees, value: null } };
    const r = evaluateSecurityQuote(world, doc, q, ctx);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toContain("amounts_parsed");
  });
});
