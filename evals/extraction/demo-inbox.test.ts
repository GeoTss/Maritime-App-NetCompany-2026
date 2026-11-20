import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateExtraction } from "../../apps/api/src/ingest/evaluate.js";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import { DEMO_INBOX_DIR, demoWorld, renderDemoInbox } from "./demo-inbox.js";
import { buildOracle } from "./oracle.js";

const world = demoWorld();
const rendered = renderDemoInbox(world);

describe("demo inbox: Track 3 security emails 04-06", () => {
  it("are byte-stable: the generator reproduces the committed files", () => {
    for (const r of rendered) {
      expect(readFileSync(join(DEMO_INBOX_DIR, r.spec.file), "utf8"), r.spec.file).toBe(r.eml);
    }
  });

  it("are delivered after 01-03, in order (Deliver next email sends files in name order)", () => {
    const names = readdirSync(DEMO_INBOX_DIR)
      .filter((f) => f.endsWith(".eml"))
      .sort();
    expect(names).toEqual([
      "01-kestrel-marsaxlokk.eml",
      "02-straitline-gibraltar.eml",
      "03-nordwind-algeciras.eml",
      "04-tridentis-djibouti.eml",
      "05-harbourline-durban.eml",
      "06-aegis-suez.eml",
    ]);
    // The generator writes only the security emails, never 01-03.
    expect(rendered.map((r) => r.spec.file)).toEqual(names.slice(3));
  });

  it("carry the spec's values, and Atlantic Meridian is IMO 9485069 in the demo world", () => {
    const am = world.vessels.find((v) => v.name === "MT Atlantic Meridian");
    expect(am?.imo).toBe("9485069");
    expect(rendered.map((r) => r.truth.expected.security)).toEqual([
      {
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
      },
      {
        provider: "Harbourline Security Services",
        vesselImo: "9485069",
        embarkUnlocode: "AEFJR",
        disembarkUnlocode: "ZADUR",
        teamSize: 3,
        dayRate: 1100,
        currency: "USD",
        fixedFees: 5000,
        minDays: 5,
        validUntil: "2026-11-21",
      },
      {
        provider: "Aegis Watch Maritime",
        vesselImo: "9485069",
        embarkUnlocode: "AEFJR",
        disembarkUnlocode: "EGSUZ",
        teamSize: null,
        dayRate: 1450,
        currency: "USD",
        fixedFees: 7000,
        minDays: 4,
        validUntil: null,
      },
    ]);
    const text = rendered.map((r) => r.eml);
    expect(text[1]).toContain("a team of 3 guards");
    expect(text[2]).toContain("4/6 guards");
    // Received on the demo morning, before the pinned anchor, after 03 (05:00 UTC).
    for (const r of rendered) {
      expect(r.eml).toMatch(/Date: Sat, 14 Nov 2026 06:\d{2}:00 \+0000/);
    }
  });

  it("a perfect transcription through the pipeline gives 04 and 05 stored, 06 held for review", async () => {
    for (const r of rendered) {
      const parsed = await parseEmail(new TextEncoder().encode(r.eml));
      const doc = { sender: parsed.sender, subject: parsed.subject, bodyText: parsed.bodyText };
      const oracle = buildOracle(r.transcription, doc);
      if (!parsed.receivedAt) throw new Error(`${r.spec.file} has no Date header`);
      const ev = evaluateExtraction(world, doc, oracle, {
        receivedAt: parsed.receivedAt,
        hasUnreadableAttachment: parsed.hasUnreadableAttachment,
      });
      const failed = ev.checks.filter((c) => !c.passed).map((c) => c.check);
      expect(ev.status, `${r.spec.file} (failed: ${failed.join(", ")})`).toBe(
        r.truth.expected.status,
      );
      if (ev.status === "extracted") {
        const sq = ev.securityQuote;
        expect(sq, r.spec.file).not.toBeNull();
        const t = r.truth.expected.security;
        expect({
          provider: world.securityProviders.find((p) => p.id === sq?.providerId)?.name,
          vesselImo: sq?.vesselImo,
          embarkUnlocode: world.ports.find((p) => p.id === sq?.embarkPortId)?.unlocode,
          disembarkUnlocode: world.ports.find((p) => p.id === sq?.disembarkPortId)?.unlocode,
          teamSize: sq?.teamSize,
          dayRate: sq?.dayRate,
          currency: sq?.currency,
          fixedFees: sq?.fixedFees,
          minDays: sq?.minDays,
          validUntil: sq?.validUntil,
        }).toEqual(t);
      } else {
        expect(failed).toEqual(["team_size_unambiguous"]);
      }
    }
  });
});
