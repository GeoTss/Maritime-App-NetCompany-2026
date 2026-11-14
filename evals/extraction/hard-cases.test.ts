/**
 * The hand-written hard cases checked against the eval world: every IMO, UN/LOCODE and supplier
 * exists, and every fact that is NOT the case's trap is valid (so only the intended check can
 * catch it), while the trap itself really is there.
 */
import { SUPPLIERS } from "@pharos/db";
import { isValidImo } from "@pharos/domain";
import { ExtractionTruth, type TruthQuote } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { isCheckName } from "../../apps/api/src/ingest/evaluate.js";
import { HARD_CASE_NAMES, HARD_CASES, type HardCaseName, renderHardCase } from "./hard-cases.js";
import { EVAL_ANCHOR, eurUsd, evalWorld, marketPriceUsd, openRequirementOf } from "./world.js";

const world = evalWorld();
const byName = new Map(HARD_CASES.map((c) => [c.name, c]));
const spec = (name: HardCaseName) => {
  const s = byName.get(name);
  if (!s) throw new Error(`no hard case ${name}`);
  return s;
};
const quoteOf = (name: HardCaseName): TruthQuote => {
  const q = spec(name).expected.quote;
  if (!q) throw new Error(`${name} has no quote`);
  return q;
};
const dayOf = (iso: string) => iso.slice(0, 10);
/** Everything a case writes: body text, HTML body, HTML attachments and PDF rows. */
const content = (name: HardCaseName): string => {
  const s = spec(name);
  const attached = (s.attachments ?? []).flatMap((a) =>
    a.kind === "html"
      ? [a.html]
      : a.kind === "pdf-text"
        ? a.rows.flatMap((r) =>
            "text" in r ? [r.text] : "cells" in r ? [r.cells.map((c) => c.text).join(" ")] : [],
          )
        : [],
  );
  return [s.text ?? "", s.html ?? "", ...attached].join("\n");
};
const deviation = (q: TruthQuote, i: number) => {
  const port = world.ports.find((p) => p.unlocode === q.portUnlocode);
  const line = q.lines[i];
  if (!port || !line?.grade || line.pricePerMt === null || q.currency === null) return null;
  const usd = line.pricePerMt * (q.currency === "EUR" ? eurUsd(world) : 1);
  return Math.abs(usd / marketPriceUsd(world, port.id, line.grade) - 1);
};

describe("hard cases", () => {
  it("are the 20 named cases, each tagged hard + its name, with known check names", async () => {
    expect(HARD_CASES.map((c) => c.name)).toEqual([...HARD_CASE_NAMES]);
    for (const s of HARD_CASES) {
      const c = await renderHardCase(s);
      const truth = ExtractionTruth.parse(c.truth);
      expect(truth.tags.slice(0, 2)).toEqual(["hard", s.name]);
      expect(truth.source).toBe("hard");
      for (const check of truth.expected.reviewChecks) expect(isCheckName(check), check).toBe(true);
      expect(new Date(s.received) < EVAL_ANCHOR).toBe(true);
    }
  });

  it("use only fleet IMOs, world UN/LOCODEs and known supplier keys", () => {
    for (const s of HARD_CASES) {
      const q = s.expected.quote;
      if (!q) continue;
      if (q.vesselImo !== null) expect(world.vessels.map((v) => v.imo)).toContain(q.vesselImo);
      if (q.portUnlocode !== null) {
        expect(world.ports.map((p) => p.unlocode)).toContain(q.portUnlocode);
      }
      if (q.supplierKey !== null) expect(SUPPLIERS.map((x) => x.key)).toContain(q.supplierKey);
    }
  });

  it("are valid apart from their trap: band, capacity, requirement, dates, supplier", () => {
    for (const s of HARD_CASES) {
      const q = s.expected.quote;
      if (!q) continue;
      const received = dayOf(s.received);
      const vessel = world.vessels.find((v) => v.imo === q.vesselImo);
      if (s.name !== "price-typo-out-of-band" && s.name !== "missing-currency") {
        q.lines.forEach((l, i) => {
          if (l.pricePerMt !== null) expect(deviation(q, i), s.name).toBeLessThanOrEqual(0.1);
        });
      }
      if (vessel && s.name !== "qty-over-tank-capacity") {
        for (const l of q.lines) {
          if (l.grade && l.qtyMt !== null) {
            expect(l.qtyMt).toBeLessThanOrEqual(vessel.tankCapacityMt[l.grade]);
          }
        }
        const req = openRequirementOf(world, vessel.id);
        expect(
          q.lines.map((l) => l.grade),
          s.name,
        ).toContain(req.grade);
      }
      if (s.name !== "expired-validity" && q.validUntil !== null) {
        expect(q.validUntil >= received, s.name).toBe(true);
      }
      if (q.deliveryFrom !== null && q.deliveryTo !== null) {
        expect(q.deliveryFrom < q.deliveryTo, `${s.name}: a real span`).toBe(true);
        if (s.name !== "delivery-window-before-received") {
          expect(q.deliveryFrom >= received, s.name).toBe(true);
        }
      }
      const senderDomain = s.from.address.split("@")[1];
      const bySender = SUPPLIERS.find((x) => x.emailDomain === senderDomain);
      expect(q.supplierKey, s.name).toBe(bySender?.key ?? null);
      if (bySender && q.portUnlocode) {
        expect(bySender.ports, `${s.name}: supplier serves the port`).toContain(q.portUnlocode);
      }
    }
  });

  it("really contain their traps", () => {
    expect(content("ambiguous-quantity")).toContain("280/320 mt");
    expect(content("price-typo-out-of-band")).toContain("USD 7380 per mt");
    expect(deviation(quoteOf("price-typo-out-of-band"), 0)).toBeGreaterThan(0.15);
    expect(content("decimal-comma")).toContain("738,50");
    expect(content("dot-thousands-qty")).toContain("9.000 mt");
    expect(content("volume-m3")).toContain("120 m3");
    expect(content("missing-currency")).not.toMatch(/USD|EUR|US\$|\$|€/);
    expect(content("expired-validity")).toContain("Offer valid until: 12 Nov 2026 17:00 LT");
    expect(quoteOf("expired-validity").validUntil).toBe("2026-11-12");
    expect(dayOf(spec("expired-validity").received)).toBe("2026-11-13");
    expect(quoteOf("delivery-window-before-received").deliveryTo).toBe("2026-11-11");

    const unknown = content("unknown-vessel").match(/IMO (\d{7})/)?.[1] ?? "";
    expect(isValidImo(unknown)).toBe(true);
    expect(world.vessels.map((v) => v.imo)).not.toContain(unknown);

    const se = world.vessels.find((v) => v.imo === quoteOf("qty-over-tank-capacity").vesselImo);
    expect(quoteOf("qty-over-tank-capacity").lines[0]?.qtyMt).toBeGreaterThan(
      se?.tankCapacityMt.LSMGO ?? Infinity,
    );

    // The injected price is inside the ±15 % band, so only ignoring it keeps the value right.
    const inj = quoteOf("injection-override");
    const grpir = world.ports.find((p) => p.unlocode === "GRPIR");
    if (!grpir) throw new Error("no GRPIR");
    expect(Math.abs(420 / marketPriceUsd(world, grpir.id, "HSFO") - 1)).toBeLessThan(0.15);
    expect(content("injection-override")).toContain("USD 420 per mt");
    expect(inj.lines[0]?.pricePerMt).toBe(462);

    // In band only after EUR -> USD: read as USD it would be outside the ±15 % band.
    const eur = quoteOf("eur-quote-in-band");
    const deham = world.ports.find((p) => p.unlocode === "DEHAM");
    if (!deham) throw new Error("no DEHAM");
    const market = marketPriceUsd(world, deham.id, "VLSFO");
    expect(eur.currency).toBe("EUR");
    expect(Math.abs(486 / market - 1)).toBeGreaterThan(0.15);
    expect(deviation(eur, 0)).toBeLessThanOrEqual(0.1);

    // Stale revisions are cheaper and still look valid at receipt.
    expect(content("thread-stale-revision")).toContain("Price: USD 729 per mt");
    expect(content("thread-stale-revision")).toContain("Validity: 15 Nov 2026 17:00 LT");
    expect(quoteOf("thread-stale-revision").lines[0]?.pricePerMt).toBe(741);

    // The spoofed name is another known supplier; the forwarder's domain is no supplier.
    expect(content("spoofed-supplier-name")).toContain("Kestrel Marine Fuels");
    expect(quoteOf("spoofed-supplier-name").supplierKey).toBe("straitline");
    expect(quoteOf("forwarded-twice").supplierKey).toBeNull();

    // Only the last of the three grades has an open requirement.
    const multi = quoteOf("multi-grade-unrequired-grade");
    const am = world.vessels.find((v) => v.imo === multi.vesselImo);
    if (!am) throw new Error("no vessel");
    expect(multi.lines.map((l) => l.grade)).toEqual(["LSMGO", "VLSFO", "HSFO"]);
    expect(openRequirementOf(world, am.id).grade).toBe("HSFO");

    expect(quoteOf("barge-per-mt").bargeFee).toBe(4.5 * 100);
    expect(spec("pdf-image-only").expected.quote).toBeNull();
  });

  it("put the traps in several layouts, not one shared labelled block (review minor 3)", () => {
    const layoutOf = (name: HardCaseName) =>
      spec(name).tags.find((t) => t.startsWith("layout:")) ?? "";
    const outsideBlock: HardCaseName[] = [
      "ambiguous-quantity",
      "decimal-comma",
      "expired-validity",
      "spoofed-supplier-name",
      "price-typo-out-of-band",
      "qty-over-tank-capacity",
    ];
    for (const name of outsideBlock) expect(layoutOf(name), name).not.toBe("layout:labels");
    expect(spec("ambiguous-quantity").tags).toContain("layout:prose");
    expect(spec("spoofed-supplier-name").tags).toContain("layout:compact");
    expect(spec("price-typo-out-of-band").html).toBeDefined();
    expect(spec("decimal-comma").html).toBeDefined();
    expect(spec("expired-validity").attachments?.[0]?.kind).toBe("pdf-text");
    expect(spec("qty-over-tank-capacity").attachments?.[0]?.kind).toBe("pdf-text");
    const labelled = HARD_CASES.filter((s) => s.tags.includes("layout:labels"));
    expect(labelled.length).toBeLessThanOrEqual(10);
    expect(spec("not-a-quote-with-prices").expected.kind).toBe("not_a_quote");
  });
});
