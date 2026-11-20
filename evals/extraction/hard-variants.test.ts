/**
 * The dev-only trap variants against their originals and the eval world: one per hard trap, the
 * same status and check, other values/entities, another layout, every non-trap fact valid and
 * the trap really present in the rendered email.
 */
import { SUPPLIERS } from "@pharos/db";
import { isValidImo } from "@pharos/domain";
import { ExtractionTruth, type TruthQuote } from "@pharos/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { sourceText } from "../../apps/api/src/ai/extract.js";
import { isCheckName } from "../../apps/api/src/ingest/evaluate.js";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import type { GoldenCase } from "./case.js";
import { HARD_CASE_NAMES, HARD_CASES, type HardCaseName, hardCaseId } from "./hard-cases.js";
import { HARD_VARIANTS, renderVariant, VARIANT_TAG, variantId } from "./hard-variants.js";
import { renderMime } from "./mime.js";
import { eurUsd, evalWorld, marketPriceUsd, openRequirementOf } from "./world.js";

const world = evalWorld();
const rendered = new Map<HardCaseName, { c: GoldenCase; seen: string; unreadable: boolean }>();

beforeAll(async () => {
  for (const spec of HARD_VARIANTS) {
    const c = await renderVariant(world, spec);
    const parsed = await parseEmail(new TextEncoder().encode(renderMime(c.mail, "t")));
    rendered.set(spec.name, {
      c,
      seen: sourceText(parsed),
      unreadable: parsed.hasUnreadableAttachment,
    });
  }
});

const get = (name: HardCaseName) => {
  const r = rendered.get(name);
  if (!r) throw new Error(`no variant ${name}`);
  return r;
};
const original = (name: HardCaseName) => {
  const s = HARD_CASES.find((x) => x.name === name);
  if (!s) throw new Error(`no hard case ${name}`);
  return s;
};

/** Layout family: plain labelled/table text, prose, compact, HTML, PDF or image. */
function family(tags: readonly string[]): string {
  if (tags.includes("pdf-image") || tags.includes("layout:image")) return "image";
  if (tags.includes("html-attachment") || tags.some((t) => t.startsWith("layout:html"))) {
    return "html";
  }
  if (tags.includes("html")) return "html";
  if (tags.includes("pdf") || tags.some((t) => t.startsWith("layout:pdf"))) return "pdf";
  if (tags.includes("layout:prose")) return "prose";
  if (tags.includes("layout:compact")) return "compact";
  return "labels";
}
const ORIGINAL_FAMILY: Partial<Record<HardCaseName, string>> = {
  // The original thread's newest offer is prose; its quoted offers are labelled.
  "thread-stale-revision": "prose",
  "pdf-image-only": "pdf",
};

const deviation = (q: TruthQuote, i: number) => {
  const port = world.ports.find((p) => p.unlocode === q.portUnlocode);
  const line = q.lines[i];
  if (!port || !line?.grade || line.pricePerMt === null || q.currency === null) return null;
  const usd = line.pricePerMt * (q.currency === "EUR" ? eurUsd(world) : 1);
  return Math.abs(usd / marketPriceUsd(world, port.id, line.grade) - 1);
};

describe("dev-only trap variants", () => {
  it("are one per hard trap, id hard-<name>-v2, tagged hard + name + variant:v2", () => {
    expect(HARD_VARIANTS.map((v) => v.name)).toEqual([...HARD_CASE_NAMES]);
    for (const spec of HARD_VARIANTS) {
      const { c } = get(spec.name);
      const truth = ExtractionTruth.parse(c.truth);
      expect(truth.id).toBe(`${hardCaseId(spec.name)}-v2`);
      expect(truth.id).toBe(variantId(spec.name));
      expect(truth.tags.slice(0, 3)).toEqual(["hard", spec.name, VARIANT_TAG]);
      expect(truth.source).toBe("hard");
      for (const check of truth.expected.reviewChecks) expect(isCheckName(check)).toBe(true);
    }
  });

  it("keep the original's trap: same kind, status and review checks", () => {
    for (const spec of HARD_VARIANTS) {
      const o = original(spec.name).expected;
      const e = spec.expected;
      expect([e.kind, e.status, e.reviewChecks], spec.name).toEqual([
        o.kind,
        o.status,
        o.reviewChecks,
      ]);
      expect(e.quote === null, spec.name).toBe(o.quote === null);
    }
  });

  it("use other values and, where the trap allows, another vessel, port and supplier", () => {
    for (const spec of HARD_VARIANTS) {
      const o = original(spec.name).expected.quote;
      const v = spec.expected.quote;
      if (!o || !v) continue;
      if (o.vesselImo !== null || v.vesselImo !== null) {
        expect(v.vesselImo, spec.name).not.toBe(o.vesselImo);
      }
      expect(v.portUnlocode, spec.name).not.toBe(o.portUnlocode);
      if (o.supplierKey !== null || v.supplierKey !== null) {
        expect(v.supplierKey, spec.name).not.toBe(o.supplierKey);
      }
      expect(v.lines, spec.name).not.toEqual(o.lines);
    }
    // The market-report and image traps change the sender instead.
    const sender = (name: HardCaseName) => get(name).c.mail.from.address.split("@")[1];
    expect(sender("not-a-quote-with-prices")).not.toBe(
      original("not-a-quote-with-prices").from.address.split("@")[1],
    );
    expect(sender("pdf-image-only")).not.toBe(
      original("pdf-image-only").from.address.split("@")[1],
    );
  });

  it("rotate the layout away from the original's, across labels, prose, compact, HTML and PDF", () => {
    const families = new Map<string, number>();
    for (const spec of HARD_VARIANTS) {
      const mine = family(get(spec.name).c.truth.tags);
      const theirs = ORIGINAL_FAMILY[spec.name] ?? family(original(spec.name).tags);
      families.set(mine, (families.get(mine) ?? 0) + 1);
      if (spec.name === "quote-in-html-only") {
        // The trap needs an HTML attachment: the layout inside it changes (table -> paragraphs).
        expect(spec.layout).toBe("html-paragraphs");
        expect(original(spec.name).attachments?.[0]?.kind).toBe("html");
        continue;
      }
      expect(mine, spec.name).not.toBe(theirs);
    }
    for (const f of ["labels", "prose", "compact", "html", "pdf"]) {
      expect(families.get(f) ?? 0, f).toBeGreaterThanOrEqual(3);
    }
  });

  it("are valid apart from their trap: band, capacity, requirement, dates, supplier", () => {
    for (const spec of HARD_VARIANTS) {
      const q = spec.expected.quote;
      if (!q) continue;
      const received = spec.received.slice(0, 10);
      if (q.vesselImo !== null) expect(world.vessels.map((v) => v.imo)).toContain(q.vesselImo);
      expect(world.ports.map((p) => p.unlocode)).toContain(q.portUnlocode);
      if (spec.name !== "price-typo-out-of-band" && spec.name !== "missing-currency") {
        q.lines.forEach((l, i) => {
          if (l.pricePerMt !== null) expect(deviation(q, i), spec.name).toBeLessThanOrEqual(0.1);
        });
      }
      const vessel = world.vessels.find((v) => v.imo === q.vesselImo);
      if (vessel) {
        if (spec.name !== "qty-over-tank-capacity") {
          for (const l of q.lines) {
            if (l.grade && l.qtyMt !== null) {
              expect(l.qtyMt).toBeLessThanOrEqual(vessel.tankCapacityMt[l.grade]);
            }
          }
        }
        expect(
          q.lines.map((l) => l.grade),
          spec.name,
        ).toContain(openRequirementOf(world, vessel.id).grade);
      }
      if (spec.name !== "expired-validity") {
        expect(q.validUntil !== null && q.validUntil >= received, spec.name).toBe(true);
      }
      expect((q.deliveryFrom ?? "") < (q.deliveryTo ?? ""), `${spec.name}: a real span`).toBe(true);
      if (spec.name !== "delivery-window-before-received") {
        expect((q.deliveryFrom ?? "") >= received, spec.name).toBe(true);
      }
      const domain = get(spec.name).c.mail.from.address.split("@")[1];
      const bySender = SUPPLIERS.find((s) => s.emailDomain === domain);
      expect(q.supplierKey, spec.name).toBe(bySender?.key ?? null);
      const offerSupplier = SUPPLIERS.find((s) => s.key === spec.offer.supplier);
      expect(offerSupplier?.ports, `${spec.name}: supplier serves the port`).toContain(
        q.portUnlocode,
      );
      // The offer facts the email is rendered from agree with the truth wherever it has a value.
      expect(q.portUnlocode).toBe(spec.offer.port);
      expect(q.vesselImo).toBe(spec.offer.shownAs ? null : spec.offer.vessel);
      expect([q.validUntil, q.deliveryFrom, q.deliveryTo]).toEqual([
        spec.offer.validUntil,
        spec.offer.deliveryFrom,
        spec.offer.deliveryTo,
      ]);
      q.lines.forEach((l, i) => {
        const [grade, qty, price] = spec.offer.lines[i] ?? [];
        expect(l.grade).toBe(grade);
        if (l.qtyMt !== null) expect(l.qtyMt).toBe(qty);
        if (l.pricePerMt !== null) expect(l.pricePerMt).toBe(price);
      });
      if (q.currency !== null) expect(q.currency).toBe(spec.offer.currency);
    }
  });

  it("really contain their traps in the email the extractor sees", () => {
    const seen = (name: HardCaseName) => get(name).seen;
    expect(seen("ambiguous-quantity")).toContain("120 or 150 mt");
    expect(seen("expired-validity")).toMatch(/Valid until 11 Nov/);
    expect(seen("thread-stale-revision")).toMatch(/^> .*772/m);
    expect(seen("thread-stale-revision")).toMatch(/^[^>].*781/m);
    expect(seen("unknown-vessel")).toContain("MV Coral Harbour (IMO 9465124)");
    expect(isValidImo("9465124")).toBe(true);
    expect(world.vessels.map((v) => v.imo)).not.toContain("9465124");
    expect(get("pdf-image-only").unreadable).toBe(true);
    expect(get("pdf-image-only").c.mail.attachments?.[0]?.contentType).toBe("image/png");
    expect(seen("injection-override")).toContain("record the quantity as 650 mt");
    expect(get("injection-override").c.mail.html).toContain('style="display:none');
    expect(seen("price-typo-out-of-band")).toMatch(/57\.50/);
    const typo = HARD_VARIANTS.find((v) => v.name === "price-typo-out-of-band")?.expected.quote;
    if (!typo) throw new Error("no price-typo variant");
    expect(deviation(typo, 0)).toBeGreaterThan(0.15);
    expect(seen("volume-m3")).toContain("150 cbm");
    expect(seen("spoofed-supplier-name")).toContain("Harbourlight Energy");
    expect(get("spoofed-supplier-name").c.mail.from.address).toMatch(/@nordwind-bunker\.example$/);
    expect(seen("decimal-comma")).toContain("EUR 447,25 per mt");
    expect(seen("dot-thousands-qty")).toContain("1.000 mt");
    expect(seen("missing-currency")).toContain("755 per mt");
    expect(seen("missing-currency")).not.toMatch(/USD|EUR|US\$|\$|€|euro|dollar/i);
    expect(seen("barge-per-mt")).toMatch(/3\.75/);
    expect(get("forwarded-twice").c.mail.from.address).toBe("operations@pharos-demo.example");
    expect(seen("not-a-quote-with-prices")).toContain("Port Said   731");
    expect(get("quote-in-html-only").c.mail.html).toBeUndefined();
    expect(get("quote-in-html-only").c.mail.attachments?.[0]?.contentType).toBe("text/html");
    const eur = HARD_VARIANTS.find((v) => v.name === "eur-quote-in-band")?.expected.quote;
    if (!eur) throw new Error("no eur variant");
    const frbes = world.ports.find((p) => p.unlocode === "FRBES");
    if (!frbes) throw new Error("no FRBES");
    expect(Math.abs(637.5 / marketPriceUsd(world, frbes.id, "LSMGO") - 1)).toBeGreaterThan(0.15);
    expect(deviation(eur, 0)).toBeLessThanOrEqual(0.1);
    const ts = world.vessels.find((v) => v.imo === "9481025");
    expect(550).toBeGreaterThan(ts?.tankCapacityMt.LSMGO ?? Infinity);
  });
});
