import { DEMO_SCENARIO, generateWorld, type World } from "@pharos/db";
import type { BunkerRequirement, ExtractionOutput, QuoteExtraction } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import type { ExtractInput } from "../ai/extract.js";
import {
  CHECK_NAMES,
  type EvaluationContext,
  evaluateExtraction,
  isCheckName,
  normaliseExtraction,
} from "./evaluate.js";
import { latestMarketPrice } from "./resolve.js";

const world = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
const RECEIVED = new Date("2026-11-14T03:00:00Z");
const CTX: EvaluationContext = { receivedAt: RECEIVED, hasUnreadableAttachment: false };

const must = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new Error(`fixture: no ${what}`);
  return v;
};
const pioneer = must(
  world.vessels.find((v) => v.imo === DEMO_SCENARIO.vesselImo),
  "demo vessel",
);
const demoVoyage = must(
  world.voyages.find((v) => v.voyageNo === DEMO_SCENARIO.voyageNo),
  "demo voyage",
);
const marsaxlokk = must(
  world.ports.find((p) => p.unlocode === "MTMLA"),
  "Marsaxlokk",
);
const kestrel = must(
  world.suppliers.find((s) => s.emailDomain === "kestrel-fuels.example"),
  "Kestrel",
);
const lsmgoRequirement = must(
  world.bunkerRequirements.find(
    (r) => r.voyageId === demoVoyage.id && r.grade === "LSMGO" && r.status === "open",
  ),
  "open LSMGO requirement",
);

const BODY = [
  "Dear Bunker Desk,",
  "",
  "Please find our offer for MV Aegean Pioneer.",
  "Vessel: MV Aegean Pioneer (IMO 9480019)",
  "Port: Marsaxlokk",
  "Quantity: 300 mt LSMGO",
  "Price: USD 738 per mt",
  "Barge fee: USD 2,800 lump sum",
  "",
  "Best regards,",
  "Kestrel Marine Fuels trading desk",
].join("\n");

/** The Kestrel email, with body lines replaced (`[from, to]`) and extra lines appended. */
function email(
  opts: { replace?: [string, string][]; append?: string[]; sender?: string } = {},
): ExtractInput {
  let body = BODY;
  for (const [from, to] of opts.replace ?? []) {
    if (!body.includes(from)) throw new Error(`fixture: body has no "${from}"`);
    body = body.replace(from, to);
  }
  if (opts.append?.length) body = `${body}\n${opts.append.join("\n")}`;
  return {
    sender: opts.sender ?? "bunkers@kestrel-fuels.example",
    subject: "LSMGO offer - MV Aegean Pioneer - Marsaxlokk",
    bodyText: body,
  };
}

const NO_DATE = { asWritten: null, evidence: null };
const dateField = (asWritten: string, evidence: string) => ({ asWritten, evidence });

/** A correct transcription of `email()` (values as written). */
function quote(): QuoteExtraction {
  return {
    kind: "quote",
    supplierName: { value: "Kestrel Marine Fuels", evidence: "Kestrel Marine Fuels trading desk" },
    vesselName: { value: "MV Aegean Pioneer", evidence: "Vessel: MV Aegean Pioneer (IMO 9480019)" },
    vesselImo: { value: "9480019", evidence: "Vessel: MV Aegean Pioneer (IMO 9480019)" },
    port: { value: "Marsaxlokk", evidence: "Port: Marsaxlokk" },
    deliveryFrom: NO_DATE,
    deliveryTo: NO_DATE,
    validUntil: NO_DATE,
    bargeFee: {
      value: 2800,
      currency: "USD",
      perUnit: "lump sum",
      asWritten: "USD 2,800 lump sum",
      evidence: "Barge fee: USD 2,800 lump sum",
    },
    lines: [
      {
        grade: { value: "LSMGO", evidence: "Quantity: 300 mt LSMGO" },
        quantity: {
          value: 300,
          unit: "mt",
          asWritten: "300 mt",
          evidence: "Quantity: 300 mt LSMGO",
        },
        price: {
          value: 738,
          currency: "USD",
          perUnit: "per mt",
          asWritten: "USD 738 per mt",
          evidence: "Price: USD 738 per mt",
        },
      },
    ],
    notes: null,
  };
}

/** A quote line as written in "Quantity: <qty> mt <grade>" / "Price: USD <price> per mt". */
function line(grade: string, qty: number, price: number): QuoteExtraction["lines"][number] {
  const q = `Quantity: ${qty} mt ${grade}`;
  return {
    grade: { value: grade, evidence: q },
    quantity: { value: qty, unit: "mt", asWritten: `${qty} mt`, evidence: q },
    price: {
      value: price,
      currency: "USD",
      perUnit: "per mt",
      asWritten: `USD ${price} per mt`,
      evidence: `Price: USD ${price} per mt`,
    },
  };
}

const run = (
  out: ExtractionOutput,
  doc: ExtractInput = email(),
  ctx: EvaluationContext = CTX,
  w: World = world,
) => evaluateExtraction(w, doc, out, ctx);
const failed = (r: { checks: { check: string; passed: boolean }[] }) =>
  r.checks.filter((c) => !c.passed).map((c) => c.check);
const receivedOn = (iso: string): EvaluationContext => ({
  receivedAt: new Date(iso),
  hasUnreadableAttachment: false,
});
const detailOf = (r: { checks: { check: string; detail: string | null }[] }, name: string) =>
  r.checks.find((c) => c.check === name)?.detail;

describe("evaluateExtraction: the clean Kestrel quote", () => {
  it("is extracted, runs every quote check, and links the LSMGO requirement", () => {
    const r = run(quote());
    expect(failed(r)).toEqual([]);
    expect(r.status).toBe("extracted");
    const names = new Set(r.checks.map((c) => c.check));
    const securityOnly = [
      "security_provider_resolved",
      "embark_port_resolved",
      "disembark_port_resolved",
      "team_size_unambiguous",
    ];
    for (const name of CHECK_NAMES.filter(
      (n) => n !== "evidence_found:notAQuote" && !securityOnly.includes(n),
    )) {
      expect(names, name).toContain(name);
    }
    expect(r.normalised).toEqual({
      vesselId: pioneer.id,
      portId: marsaxlokk.id,
      supplierId: kestrel.id,
      currency: "USD",
      validUntil: null,
      deliveryFrom: null,
      deliveryTo: null,
      bargeFee: 2800,
      lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
    });
    if (r.status !== "extracted") return;
    expect(r.quote).toEqual({
      supplierId: kestrel.id,
      portId: marsaxlokk.id,
      requirementId: lsmgoRequirement.id,
      currency: "USD",
      bargeFee: 2800,
      validUntil: null,
      deliveryFrom: null,
      deliveryTo: null,
      lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
    });
  });

  it("normaliseExtraction gives the same view evaluateExtraction returns", () => {
    expect(normaliseExtraction(world, email(), quote(), RECEIVED)).toEqual(run(quote()).normalised);
  });
});

describe("check names", () => {
  it("are the canonical R14 names", () => {
    expect([...CHECK_NAMES].sort()).toEqual(
      [
        "evidence_found:notAQuote",
        "currency_known",
        "unit_known",
        "grade_known",
        "quantity_unambiguous",
        "amounts_parsed",
        "vessel_resolved",
        "port_resolved",
        "supplier_resolved",
        "price_within_band",
        "requirement_found",
        "validity_not_expired",
        "dates_parsed",
        "quantity_within_tank_capacity",
        "supplier_name_matches",
        "attachment_text_found",
        "delivery_window_valid",
        "newest_offer_only",
        // Track 3: security quotes.
        "security_provider_resolved",
        "embark_port_resolved",
        "disembark_port_resolved",
        "team_size_unambiguous",
      ].sort(),
    );
  });

  it("every emitted check is a known name; evidence checks are evidence_found:<path>", () => {
    const notAQuote = run({ kind: "not_a_quote", reason: "x", evidence: "Dear Bunker Desk," });
    for (const c of [...run(quote()).checks, ...notAQuote.checks]) {
      expect(isCheckName(c.check), c.check).toBe(true);
    }
    expect(isCheckName("evidence_found:lines.0.price")).toBe(true);
    expect(isCheckName("evidence_found:")).toBe(false);
    expect(isCheckName("price_in_band")).toBe(false);
  });
});

describe("validity_not_expired", () => {
  /** The quote with a validity, and its delivery window (an email that names dates needs both). */
  const withValidity = (written: string, ctx: EvaluationContext = CTX, delivery = "18-19 Nov") => {
    const out = quote();
    out.validUntil = dateField(written, `Valid until: ${written}`);
    out.deliveryFrom = dateField(delivery, `Delivery: ${delivery}`);
    return run(out, email({ append: [`Valid until: ${written}`, `Delivery: ${delivery}`] }), ctx);
  };
  /** The quote with its delivery window transcribed and nothing for validity. */
  const windowOnly = () => {
    const out = quote();
    out.deliveryFrom = dateField("18-19 Nov", "Delivery: 18-19 Nov");
    return out;
  };

  it("expired validity → needs_review / validity_not_expired", () => {
    const r = withValidity("10 Nov 2026");
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["validity_not_expired"]);
    expect(r.normalised.validUntil).toBe("2026-11-10");
  });

  it("validity on the received day passes and is stored", () => {
    const r = withValidity("14 Nov 2026");
    expect(failed(r)).toEqual([]);
    expect(r.status === "extracted" && r.quote?.validUntil).toBe("2026-11-14");
  });

  it("a validity with no year that reads as a past day fails: 30 Dec received 2 Jan", () => {
    const r = withValidity("30 Dec", receivedOn("2027-01-02T09:00:00Z"), "3-4 Jan");
    expect(r.normalised.validUntil).toBe("2026-12-30");
    expect(failed(r)).toEqual(["validity_not_expired"]);
  });

  it("a validity more than 60 days ahead fails: 1 Sep received 14 Nov", () => {
    const r = withValidity("1 Sep");
    expect(r.normalised.validUntil).toBe("2027-09-01");
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["validity_not_expired"]);
    expect(detailOf(r, "validity_not_expired")).toContain(
      "implausibly far ahead of the received date — check the year",
    );
  });

  it("a validity 60 days ahead passes; 61 days ahead fails", () => {
    expect(failed(withValidity("13 Jan 2027"))).toEqual([]);
    expect(failed(withValidity("14 Jan 2027"))).toEqual(["validity_not_expired"]);
  });

  it.each([
    "Valid until: 10 Nov 2026",
    "Validity: 14 Nov 2026 17:00 LT",
    "This offer is valid until 15/11.",
    "Prices expire 16.11.26 at noon",
    "Expiry: Nov 16",
    "Offer firm until 2026-11-16 12:00 UTC",
    "Offer good until Monday",
  ])("a validity written in the email but not transcribed fails: %s", (written) => {
    const r = run(windowOnly(), email({ append: [written, "Delivery: 18-19 Nov"] }));
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["validity_not_expired"]);
    expect(detailOf(r, "validity_not_expired")).toBe(
      "no validity determined — a human confirms (a validity is written in the email but was not transcribed)",
    );
  });

  it("the expired-quote case: an omitted validity cannot store an expired quote", () => {
    // The model leaves validUntil empty on a quote that expired before it was received.
    const doc = email({ append: ["Validity: 12 Nov 2026 17:00 LT", "Delivery: 18-19 Nov"] });
    const r = run(windowOnly(), doc);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["validity_not_expired"]);
  });

  it("an email that names dates needs a determined validity, whatever its wording (ruling A)", () => {
    // No validity word at all: the word-list detector cannot see it, the structural rule does.
    for (const written of ["Prices hold till 20/11", "Exp. 20/11", "Offer stands until Nov 20th"]) {
      const r = run(windowOnly(), email({ append: [written, "Delivery: 18-19 Nov"] }));
      expect(r.status, written).toBe("needs_review");
      expect(failed(r), written).toEqual(["validity_not_expired"]);
      expect(detailOf(r, "validity_not_expired"), written).toContain(
        "no validity determined — a human confirms",
      );
    }
  });

  it("a stated validity that does not read as a date is not determined", () => {
    const out = windowOnly();
    out.validUntil = dateField("close of business", "Valid until close of business");
    const doc = email({ append: ["Valid until close of business", "Delivery: 18-19 Nov"] });
    const r = run(out, doc);
    expect(failed(r).sort()).toEqual(["dates_parsed", "validity_not_expired"]);
    expect(detailOf(r, "validity_not_expired")).toBe("no validity determined — a human confirms");
  });

  it.each(["Prices are valid for 24 hours", "Validity: subject to prompt acceptance"])(
    "a validity word with no date is not a written validity: %s",
    (written) => {
      const r = run(quote(), email({ append: [written] }));
      expect(failed(r)).toEqual([]);
      expect(detailOf(r, "validity_not_expired")).toBe(
        "no validity stated; the email names no date",
      );
    },
  );

  it("absent validity passes only when the email names no date at all (the demo inbox emails)", () => {
    const r = run(quote());
    expect(r.status).toBe("extracted");
    expect(r.checks.find((c) => c.check === "validity_not_expired")).toEqual({
      check: "validity_not_expired",
      passed: true,
      detail: "no validity stated; the email names no date",
    });
  });

  it("a date in an attachment section counts as a date the email names", () => {
    const doc = email();
    doc.bodyText += "\n\n--- attachment: terms.pdf ---\nDelivery: 18-19 Nov";
    const r = run(windowOnly(), doc);
    expect(failed(r)).toEqual(["validity_not_expired"]);
  });
});

describe("delivery dates (R7) and dates_parsed", () => {
  /** The quote with these delivery fields and a validity (an email that names dates needs both). */
  const withDelivery = (
    from: string | null,
    to: string | null,
    bodyLine = `Delivery: ${from ?? to}`,
    ctx: EvaluationContext = CTX,
    validity = "15 Nov 2026",
  ) => {
    const out = quote();
    if (from !== null) out.deliveryFrom = dateField(from, bodyLine);
    if (to !== null) out.deliveryTo = dateField(to, bodyLine);
    out.validUntil = dateField(validity, `Validity: ${validity}`);
    return run(out, email({ append: [bodyLine, `Validity: ${validity}`] }), ctx);
  };

  it('"18-19 Nov" → deliveryFrom/To set', () => {
    const r = withDelivery("18-19 Nov", null);
    expect(failed(r)).toEqual([]);
    expect(r.normalised).toMatchObject({ deliveryFrom: "2026-11-18", deliveryTo: "2026-11-19" });
    expect(r.status === "extracted" && [r.quote?.deliveryFrom, r.quote?.deliveryTo]).toEqual([
      "2026-11-18",
      "2026-11-19",
    ]);
  });

  it("the same span in both fields, or only in deliveryTo, gives the same window", () => {
    for (const r of [withDelivery("18-19 Nov", "18-19 Nov"), withDelivery(null, "18-19 Nov")]) {
      expect(failed(r)).toEqual([]);
      expect(r.normalised).toMatchObject({ deliveryFrom: "2026-11-18", deliveryTo: "2026-11-19" });
    }
  });

  it("separate dates in each field give from and to", () => {
    const both = withDelivery("18 Nov", "20 Nov", "Delivery: from 18 Nov to 20 Nov");
    expect(failed(both)).toEqual([]);
    expect(both.normalised).toMatchObject({ deliveryFrom: "2026-11-18", deliveryTo: "2026-11-20" });
  });

  it("a single date in deliveryFrom alone sets only the start, so the window is not determined", () => {
    for (const written of ["from 18 Nov", "on 18 Nov"]) {
      const r = withDelivery(written, null, `Delivery ${written}`);
      expect(r.normalised, written).toMatchObject({ deliveryFrom: "2026-11-18", deliveryTo: null });
      expect(r.status, written).toBe("needs_review");
      expect(failed(r), written).toEqual(["delivery_window_valid"]);
      expect(detailOf(r, "delivery_window_valid"), written).toBe(
        "delivery window not fully determined — a human confirms",
      );
    }
  });

  it("a single date in deliveryTo alone sets only the end, so the window is not determined", () => {
    const r = withDelivery(null, "by 20 Nov", "Delivery by 20 Nov");
    expect(r.normalised).toMatchObject({ deliveryFrom: null, deliveryTo: "2026-11-20" });
    expect(failed(r)).toEqual(["delivery_window_valid"]);
    expect(detailOf(r, "delivery_window_valid")).toBe(
      "delivery window not fully determined — a human confirms",
    );
  });

  it("a stated date that parses neither way fails dates_parsed and leaves the window undetermined", () => {
    const r = withDelivery("next week", null);
    expect(r.status).toBe("needs_review");
    expect(failed(r).sort()).toEqual(["dates_parsed", "delivery_window_valid"]);
    expect(r.normalised).toMatchObject({ deliveryFrom: null, deliveryTo: null });
  });

  it("no delivery date stated passes only when the email names no date at all", () => {
    expect(detailOf(run(quote()), "delivery_window_valid")).toBe(
      "no delivery window stated; the email names no date",
    );
  });

  it("an email that names dates needs a determined window, whatever its label (ruling A)", () => {
    // "Dates:", "Supply date:", "Stem:": no delivery word, so only the structural rule sees them.
    for (const written of ["Dates: 22-24 Nov", "Supply date: 22-24 Nov", "Stem: 22-24 Nov"]) {
      const out = quote();
      out.validUntil = dateField("15 Nov 2026", "Validity: 15 Nov 2026");
      const r = run(out, email({ append: [written, "Validity: 15 Nov 2026"] }));
      expect(r.status, written).toBe("needs_review");
      expect(failed(r), written).toEqual(["delivery_window_valid"]);
      expect(detailOf(r, "delivery_window_valid"), written).toBe(
        "delivery window not fully determined — a human confirms",
      );
    }
  });

  it("every date omitted from an email that names them: both checks fail", () => {
    const doc = email({ append: ["Delivery: 18-19 Nov", "Validity: 15 Nov 2026"] });
    const r = run(quote(), doc);
    expect(failed(r).sort()).toEqual(["delivery_window_valid", "validity_not_expired"]);
  });

  it("a window that ends before the email was received → delivery_window_valid", () => {
    const r = withDelivery("10-12 Nov", null);
    expect(failed(r)).toEqual(["delivery_window_valid"]);
  });

  it("a window with no year that reads as past days fails: 28-30 Dec received 2 Jan", () => {
    const r = withDelivery(
      "28-30 Dec",
      null,
      undefined,
      receivedOn("2027-01-02T09:00:00Z"),
      "3 Jan 2027",
    );
    expect(r.normalised).toMatchObject({ deliveryFrom: "2026-12-28", deliveryTo: "2026-12-30" });
    expect(failed(r)).toEqual(["delivery_window_valid"]);
  });

  it("a window ending more than 120 days after receipt fails; 120 days passes", () => {
    const far = withDelivery("13-15 Mar 2027", null);
    expect(failed(far)).toEqual(["delivery_window_valid"]);
    expect(detailOf(far, "delivery_window_valid")).toContain(
      "implausibly far ahead of the received date — check the year",
    );
    expect(failed(withDelivery("12-14 Mar 2027", null))).toEqual([]);
  });

  it("a start alone more than 120 days after receipt fails too", () => {
    const r = withDelivery("from 1 Sep", null, "Delivery from 1 Sep");
    expect(r.normalised.deliveryFrom).toBe("2027-09-01");
    expect(failed(r)).toEqual(["delivery_window_valid"]);
  });

  it("a window whose end is before its start → delivery_window_valid", () => {
    const r = withDelivery("20 Nov", "18 Nov", "Delivery: 20 Nov / 18 Nov");
    expect(failed(r)).toEqual(["delivery_window_valid"]);
  });

  it.each([
    "Delivery: 18-19 Nov",
    "Delivery window: 18 to 19 November",
    "ETA Marsaxlokk 18 Nov",
    "Laycan 18/11-19/11",
    "Delivery 10-12 Nov",
  ])("a delivery date written in the email but not transcribed fails: %s", (written) => {
    const out = quote();
    out.validUntil = dateField("15 Nov 2026", "Validity: 15 Nov 2026");
    const r = run(out, email({ append: [written, "Validity: 15 Nov 2026"] }));
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["delivery_window_valid"]);
    expect(detailOf(r, "delivery_window_valid")).toBe(
      "delivery window not fully determined — a human confirms (a delivery date is written in the email but was not transcribed)",
    );
  });

  it("a delivery word with no date is not a written delivery date", () => {
    const r = run(quote(), email({ append: ["Delivery ex-barge, prompt on arrival"] }));
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "delivery_window_valid")).toBe(
      "no delivery window stated; the email names no date",
    );
  });

  it.each(["by 20 Nov", "before 20 Nov", "no later than 20 Nov", "until 20 Nov"])(
    "an end date transcribed as the start fails delivery_window_valid: %s",
    (written) => {
      const r = withDelivery(written, null, `Delivery ${written}`);
      expect(r.status).toBe("needs_review");
      expect(failed(r)).toContain("delivery_window_valid");
      expect(detailOf(r, "delivery_window_valid")).toContain(
        "an end date was transcribed as the start",
      );
    },
  );

  it("a start more than a day before the received day fails: the year typo 18 Nov 2025", () => {
    const r = withDelivery("18 Nov 2025", "20 Nov", "Delivery: from 18 Nov 2025 to 20 Nov");
    expect(r.normalised).toMatchObject({ deliveryFrom: "2025-11-18", deliveryTo: "2026-11-20" });
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["delivery_window_valid"]);
    expect(detailOf(r, "delivery_window_valid")).toContain("2025-11-18");
  });

  it("a start the day before receipt passes; two days before fails", () => {
    // Received 2026-11-14T03:00Z.
    expect(failed(withDelivery("13-15 Nov", null))).toEqual([]);
    expect(failed(withDelivery("12-15 Nov", null))).toEqual(["delivery_window_valid"]);
  });
});

describe("as-written amounts and units are read from the field, not the whole line (I2)", () => {
  const withQuantity = (lineText: string, asWritten: string, value: number, unit = "mt") => {
    const out = quote();
    const first = must(out.lines[0], "line");
    first.quantity = { value, unit, asWritten, evidence: lineText };
    first.grade = { value: "LSMGO", evidence: lineText };
    return run(out, email({ replace: [["Quantity: 300 mt LSMGO", lineText]] }));
  };

  it.each([
    ["Quantity: 280/320 mt LSMGO", "320 mt", 320],
    ["Quantity: abt 300 mt LSMGO", "300 mt", 300],
    ["Quantity: approx. 300 mt LSMGO", "300 mt", 300],
    ["Quantity: min 300 mt LSMGO", "300 mt", 300],
    ["Quantity: up to 300 mt LSMGO", "300 mt", 300],
    ["Quantity: 300 mt LSMGO +/- 5%", "300 mt", 300],
    ["Quantity: 280 to 300 mt LSMGO", "300 mt", 300],
  ])("a quantity that is a range or approximation in its evidence fails: %s", (lineText, aw, v) => {
    const r = withQuantity(lineText, aw, v);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["quantity_unambiguous"]);
  });

  it('"280" taken from "280/320 mt" goes to review', () => {
    const r = withQuantity("Quantity: 280/320 mt LSMGO", "280", 280);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toContain("quantity_unambiguous");
  });

  it.each(["Price: abt USD 738 per mt", "Price: approx USD 738 per mt", "Price: ~USD 738 per mt"])(
    "a price that is an approximation in its evidence fails amounts_parsed: %s",
    (lineText) => {
      const out = quote();
      const first = must(out.lines[0], "line");
      first.price = { ...first.price, evidence: lineText };
      const r = run(out, email({ replace: [["Price: USD 738 per mt", lineText]] }));
      expect(r.status).toBe("needs_review");
      expect(failed(r)).toEqual(["amounts_parsed"]);
    },
  );

  it('"120 m3 at USD 728 per mt" with unit "mt" goes to review: the unit is not in "120 m3"', () => {
    const lineText = "We offer LSMGO, 120 m3 at USD 738 per mt.";
    const out = quote();
    const first = must(out.lines[0], "line");
    first.quantity = { value: 120, unit: "mt", asWritten: "120 m3", evidence: lineText };
    first.grade = { value: "LSMGO", evidence: lineText };
    first.price = { ...first.price, evidence: lineText };
    const doc = email({
      replace: [
        ["Quantity: 300 mt LSMGO", lineText],
        ["Price: USD 738 per mt\n", ""],
      ],
    });
    const r = run(out, doc);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toContain("unit_known");
    expect(r.normalised.lines[0]?.qtyMt).toBeNull();
  });

  it("a currency written only elsewhere on the evidence line is not the price's currency", () => {
    const out = quote();
    const first = must(out.lines[0], "line");
    first.price = {
      value: 690,
      currency: "EUR",
      perUnit: "/ mt",
      asWritten: "690 / mt",
      evidence: "Price: EUR 690 / mt",
    };
    const doc = email({ replace: [["Price: USD 738 per mt", "Price: EUR 690 / mt"]] });
    const r = run(out, doc);
    expect(failed(r)).toContain("currency_known");
    expect(detailOf(r, "currency_known")).toContain("is not written in its text");
  });

  it("a price unit written only elsewhere on the evidence line fails unit_known", () => {
    const out = quote();
    const first = must(out.lines[0], "line");
    first.price = { ...first.price, asWritten: "USD 738" };
    expect(failed(run(out))).toEqual(["unit_known"]);
  });
});

describe("newest_offer_only (I3): stale values from a quoted thread", () => {
  /** The Kestrel offer with a delivery window and validity, as the newest message on top. */
  const NEWEST = ["Delivery: 18-19 Nov", "Validity: 15 Nov 2026"];
  const OLDER = [
    "Quantity: 350 mt LSMGO",
    "Price: USD 734 per mt",
    "Delivery: 16-17 Nov",
    "Validity: 14 Nov 2026",
  ];
  const SEPARATORS: [string, string[], (l: string) => string][] = [
    ["Outlook original message", ["-----Original Message-----"], (l) => l],
    ["Gmail forward", ["---------- Forwarded message ---------"], (l) => l],
    [
      "reply header",
      ["On Fri, 13 Nov 2026 at 09:12, Kestrel Desk <bunkers@kestrel-fuels.example> wrote:"],
      (l) => `> ${l}`,
    ],
    [
      "From header block",
      [
        "From: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Sent: Friday, 13 November 2026 09:12",
        "To: Bunker Desk <bunker-desk@pharos-demo.example>",
      ],
      (l) => l,
    ],
    ["quoted lines only", [], (l) => `> ${l}`],
    // round 2: localized header blocks, original-message lines and attributions
    [
      "Outlook DE header block",
      [
        "________________________________",
        "Von: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Gesendet: Freitag, 13. November 2026 09:12",
        "An: Bunker Desk",
        "Betreff: LSMGO offer",
      ],
      (l) => l,
    ],
    [
      "Outlook FR header block",
      [
        "De : Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Envoyé : vendredi 13 novembre 2026 09:12",
        "À : Bunker Desk",
        "Objet : LSMGO offer",
      ],
      (l) => l,
    ],
    [
      "Outlook DA/NO header block",
      [
        "Fra: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Sendt: 13. november 2026 09:12",
        "Til: Bunker Desk",
        "Emne: LSMGO offer",
      ],
      (l) => l,
    ],
    [
      "Outlook IT header block",
      [
        "Da: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Inviato: venerdì 13 novembre 2026 09:12",
        "A: Bunker Desk",
        "Oggetto: LSMGO offer",
      ],
      (l) => l,
    ],
    [
      "Outlook ES header block",
      [
        "De: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Enviado: viernes, 13 de noviembre de 2026 9:12",
        "Para: Bunker Desk",
        "Asunto: LSMGO offer",
      ],
      (l) => l,
    ],
    [
      "Outlook EL header block",
      [
        "Από: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Στάλθηκε: Παρασκευή, 13 Νοεμβρίου 2026 09:12",
        "Προς: Bunker Desk",
      ],
      (l) => l,
    ],
    [
      "Outlook HTML header, lines separated by blank lines",
      ["From: Kestrel Desk", "", "Sent: 13 November 2026 09:12", "", "To: Bunker Desk", ""],
      (l) => l,
    ],
    [
      "bold header labels",
      ["*From:* Kestrel Desk <bunkers@kestrel-fuels.example>", "*Sent:* 13 November 2026 09:12"],
      (l) => l,
    ],
    ["German original message", ["-----Ursprüngliche Nachricht-----"], (l) => l],
    ["French original message", ["-----Message d'origine-----"], (l) => l],
    ["Italian original message", ["-----Messaggio originale-----"], (l) => l],
    [
      "German attribution",
      ["Am 13.11.2026 um 09:12 schrieb Kestrel Desk <bunkers@kestrel-fuels.example>:"],
      (l) => l,
    ],
    [
      "French attribution",
      ["Le ven. 13 nov. 2026 à 09:12, Kestrel Desk <bunkers@kestrel-fuels.example> a écrit :"],
      (l) => l,
    ],
    [
      "Italian attribution",
      [
        "Il giorno ven 13 nov 2026 alle ore 09:12 Kestrel Desk <bunkers@kestrel-fuels.example> ha scritto:",
      ],
      (l) => l,
    ],
    [
      "Spanish attribution",
      ["El vie, 13 nov 2026 a las 9:12, Kestrel Desk (<bunkers@kestrel-fuels.example>) escribió:"],
      (l) => l,
    ],
    [
      "Gmail attribution wrapped over two lines",
      [
        "On Fri, 13 Nov 2026 at 09:12, Kestrel Marine Fuels trading desk <",
        "bunkers@kestrel-fuels.example> wrote:",
      ],
      (l) => l,
    ],
    // round 3: Dutch, Portuguese and Swedish forms, and more English layouts
    [
      "Outlook NL header block",
      [
        "________________________________",
        "Van: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Verzonden: vrijdag 13 november 2026 09:12",
        "Aan: Bunker Desk",
        "Onderwerp: LSMGO offer",
      ],
      (l) => l,
    ],
    ["Dutch original message", ["-----Oorspronkelijk bericht-----"], (l) => l],
    ["Dutch forwarded message", ["---------- Doorgestuurd bericht ---------"], (l) => l],
    [
      "Dutch attribution",
      ["Op vr 13 nov. 2026 om 09:12 schreef Kestrel Desk <bunkers@kestrel-fuels.example>:"],
      (l) => l,
    ],
    [
      "Portuguese header block",
      [
        "De: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Enviada: sexta-feira, 13 de novembro de 2026 09:12",
        "Para: Bunker Desk",
        "Assunto: LSMGO offer",
      ],
      (l) => l,
    ],
    ["Portuguese original message", ["-----Mensagem original-----"], (l) => l],
    ["Portuguese forwarded message", ["---------- Mensagem encaminhada ---------"], (l) => l],
    [
      "Portuguese attribution",
      [
        "Em sex., 13 de nov. de 2026 às 09:12, Kestrel Desk <bunkers@kestrel-fuels.example> escreveu:",
      ],
      (l) => l,
    ],
    [
      "Swedish header block",
      [
        "Från: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Skickat: den 13 november 2026 09:12",
        "Till: Bunker Desk",
        "Ämne: LSMGO offer",
      ],
      (l) => l,
    ],
    ["Swedish original message", ["-----Ursprungligt meddelande-----"], (l) => l],
    [
      "Swedish attribution",
      ["Den 13 nov. 2026 kl. 09:12 skrev Kestrel Desk <bunkers@kestrel-fuels.example>:"],
      (l) => l,
    ],
    [
      "sender name holding a weekday word",
      ["From: Sun Marine Bunkers", "Sent: 13 November 2026 09:12"],
      (l) => l,
    ],
    [
      "From value on the next line",
      ["From:", "Kestrel Desk <bunkers@kestrel-fuels.example>", "Sent:", "13 November 2026 09:12"],
      (l) => l,
    ],
    [
      "Gmail attribution wrapped over three lines",
      [
        "On Fri, 13 Nov 2026 at 09:12, Kestrel Marine Fuels trading desk",
        "Marsaxlokk <",
        "bunkers@kestrel-fuels.example> wrote:",
      ],
      (l) => l,
    ],
    ["Lotus attribution", ["Kestrel Desk/Kestrel wrote on 13/11/2026 09:12:"], (l) => l],
  ];
  const threadDoc = (separator: string[], quoteLine: (l: string) => string, top = NEWEST) =>
    email({ append: [...top, "", ...separator, ...OLDER.map(quoteLine)] });
  /** The newest offer, transcribed correctly. */
  const newest = (): QuoteExtraction => {
    const out = quote();
    out.deliveryFrom = dateField("18-19 Nov", "Delivery: 18-19 Nov");
    out.validUntil = dateField("15 Nov 2026", "Validity: 15 Nov 2026");
    return out;
  };

  it.each(SEPARATORS)("%s: the newest values pass", (_name, sep, q) => {
    const r = run(newest(), threadDoc(sep, q));
    expect(failed(r)).toEqual([]);
    expect(r.status).toBe("extracted");
    expect(detailOf(r, "newest_offer_only")).toBeNull();
  });

  it.each(SEPARATORS)("%s: the older price and window go to review", (_name, sep, q) => {
    const out = newest();
    const first = must(out.lines[0], "line");
    first.price = {
      ...first.price,
      value: 734,
      asWritten: "USD 734 per mt",
      evidence: "Price: USD 734 per mt",
    };
    out.deliveryFrom = dateField("16-17 Nov", "Delivery: 16-17 Nov");
    const r = run(out, threadDoc(sep, q));
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["newest_offer_only"]);
    expect(detailOf(r, "newest_offer_only")).toContain("lines.0.price");
    expect(detailOf(r, "newest_offer_only")).toContain("deliveryFrom");
  });

  it.each([
    [
      "quantity",
      (o: QuoteExtraction) => {
        const first = must(o.lines[0], "line");
        first.quantity = {
          value: 350,
          unit: "mt",
          asWritten: "350 mt",
          evidence: "Quantity: 350 mt LSMGO",
        };
      },
      "lines.0.quantity",
    ],
    [
      "validity",
      (o: QuoteExtraction) => {
        o.validUntil = dateField("14 Nov 2026", "Validity: 14 Nov 2026");
      },
      "validUntil",
    ],
  ] as const)("an older %s alone goes to review", (_what, mutate, path) => {
    const out = newest();
    mutate(out);
    const r = run(
      out,
      threadDoc(["-----Original Message-----"], (l) => l),
    );
    expect(failed(r)).toEqual(["newest_offer_only"]);
    expect(detailOf(r, "newest_offer_only")).toContain(path);
  });

  it("a forward whose newest message names no price: the quoted offer is the one", () => {
    const doc: ExtractInput = {
      sender: "bunkers@kestrel-fuels.example",
      subject: "FW: LSMGO offer",
      bodyText: [
        "FYI, see our offer below.",
        "",
        "---------- Forwarded message ---------",
        BODY,
      ].join("\n"),
    };
    const r = run(quote(), doc);
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "newest_offer_only")).toContain("names no price");
  });

  it("a forward with no price on top: the first quoted message with a price is the offer", () => {
    // FYI on top, then the revised offer, then the older offer it replaced.
    const doc: ExtractInput = {
      sender: "bunkers@kestrel-fuels.example",
      subject: "FW: LSMGO offer",
      bodyText: [
        "FYI, see below.",
        "",
        "---------- Forwarded message ---------",
        "From: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Date: Fri, 13 Nov 2026 at 09:12",
        "Subject: RE: LSMGO offer",
        "",
        BODY,
        ...NEWEST,
        "",
        "-----Original Message-----",
        "From: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Sent: Thursday, 12 November 2026 10:00",
        "",
        ...OLDER,
      ].join("\n"),
    };
    const revised = run(newest(), doc);
    expect(failed(revised)).toEqual([]);
    expect(detailOf(revised, "newest_offer_only")).toContain("names no price");

    const stale = newest();
    const first = must(stale.lines[0], "line");
    first.price = {
      ...first.price,
      value: 734,
      asWritten: "USD 734 per mt",
      evidence: "Price: USD 734 per mt",
    };
    const r = run(stale, doc);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["newest_offer_only"]);
    expect(detailOf(r, "newest_offer_only")).toContain("lines.0.price");
  });

  // ---- round 3: prices written as labels, tables and per-unit amounts ----

  /** A thread whose newest and older message share one layout; returns stale and current runs. */
  const sameLayout = (
    price: (n: number) => string,
    asWritten: (n: number) => string,
    perUnit: string,
  ) => {
    const offer = (n: number, delivery: string, validity: string) => [
      "Vessel: MV Aegean Pioneer (IMO 9480019)",
      "Port: Marsaxlokk",
      "Quantity: 300 mt LSMGO",
      price(n),
      `Delivery: ${delivery}`,
      `Validity: ${validity}`,
    ];
    const doc: ExtractInput = {
      sender: "bunkers@kestrel-fuels.example",
      subject: "RE: LSMGO offer",
      bodyText: [
        "Revised:",
        ...offer(738, "18-19 Nov", "15 Nov 2026"),
        "Kestrel Marine Fuels trading desk",
        "",
        "-----Original Message-----",
        ...offer(734, "16-17 Nov", "14 Nov 2026"),
      ].join("\n"),
    };
    const out = (n: number, delivery: string, validity: string) => {
      const o = quote();
      o.bargeFee = { value: null, currency: null, perUnit: null, asWritten: null, evidence: null };
      const first = must(o.lines[0], "line");
      first.price = {
        value: n,
        currency: "USD",
        perUnit,
        asWritten: asWritten(n),
        evidence: price(n),
      };
      o.deliveryFrom = dateField(delivery, `Delivery: ${delivery}`);
      o.validUntil = dateField(validity, `Validity: ${validity}`);
      return o;
    };
    return {
      stale: run(out(734, "16-17 Nov", "14 Nov 2026"), doc),
      current: run(out(738, "18-19 Nov", "15 Nov 2026"), doc),
    };
  };

  it.each([
    [
      "Price (USD/mt): N",
      (n: number) => `Price (USD/mt): ${n}`,
      (n: number) => `USD/mt): ${n}`,
      "/mt",
    ],
    [
      "Price [USD/MT]: N",
      (n: number) => `Price [USD/MT]: ${n}`,
      (n: number) => `USD/MT]: ${n}`,
      "/MT",
    ],
    [
      "Price, USD per mt: N",
      (n: number) => `Price, USD per mt: ${n}`,
      (n: number) => `USD per mt: ${n}`,
      "per mt",
    ],
    [
      "USD per mt: N",
      (n: number) => `USD per mt: ${n}`,
      (n: number) => `USD per mt: ${n}`,
      "per mt",
    ],
    [
      "Price in USD/mt = N",
      (n: number) => `Price in USD/mt = ${n}`,
      (n: number) => `USD/mt = ${n}`,
      "/mt",
    ],
  ] as const)(
    "a price written as a label (%s) is the newest offer's price",
    (_name, price, aw, unit) => {
      const { stale, current } = sameLayout(price, aw, unit);
      expect(stale.status).toBe("needs_review");
      expect(failed(stale)).toContain("newest_offer_only");
      expect(failed(current)).toEqual([]);
    },
  );

  it.each([
    "738 per tonne",
    "738/t",
    "738 p/mt",
    "738 per metric ton",
    "738 US dollars",
    "738,00 USD/mt",
  ])(
    "a newest message pricing as %s counts as an offer (no currency next to it is fine)",
    (price) => {
      const doc: ExtractInput = {
        sender: "bunkers@kestrel-fuels.example",
        subject: "RE: LSMGO offer",
        bodyText: [
          `Revised: LSMGO ${price}, rest as below.`,
          "",
          "-----Original Message-----",
          BODY,
        ].join("\n"),
      };
      expect(failed(run(quote(), doc))).toEqual(["newest_offer_only"]);
    },
  );

  it("a header-row table whose currency sits in the header counts as the newest offer", () => {
    const doc: ExtractInput = {
      sender: "bunkers@kestrel-fuels.example",
      subject: "RE: LSMGO offer",
      bodyText: [
        "Revised offer below, rest as per our previous.",
        "",
        "Grade            Qty (mt)    Price (USD/mt)",
        "LSMGO 0.10%S     300         741",
        "",
        "-----Original Message-----",
        BODY,
      ].join("\n"),
    };
    expect(failed(run(quote(), doc))).toEqual(["newest_offer_only"]);
  });

  it("a bottom-posted reply: the quoted lines on top are the older message", () => {
    const doc: ExtractInput = {
      sender: "bunkers@kestrel-fuels.example",
      subject: "RE: LSMGO offer",
      bodyText: [
        ...BODY.split("\n").map((l) => `> ${l}`),
        "",
        "Revised: LSMGO USD 741 per mt, rest as above.",
        "Kestrel Marine Fuels trading desk",
      ].join("\n"),
    };
    const r = run(quote(), doc);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toContain("newest_offer_only");
  });

  it("a forward carries the original's attachment: it belongs to the forwarded message", () => {
    const doc = withAttachment(
      [
        "Revised: LSMGO USD 741 per mt, rest as per the attached original offer.",
        "Kestrel Marine Fuels trading desk",
        "",
        "---------- Forwarded message ---------",
        "From: Kestrel Desk <bunkers@kestrel-fuels.example>",
        "Date: Thu, 12 Nov 2026 at 10:00",
        "Subject: LSMGO offer",
        "",
        "Please find our offer attached.",
      ],
      OFFER,
    );
    const r = run(newest(), doc);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["newest_offer_only"]);
  });

  it("evidence repeated in the newest message and the quoted one passes", () => {
    // The older message quoted the same quantity line the newest one repeats.
    const doc = email({
      append: [...NEWEST, "", "-----Original Message-----", "Quantity: 300 mt LSMGO", ...OLDER],
    });
    const r = run(newest(), doc);
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "newest_offer_only")).toBeNull();
  });

  it("an email with no quoted thread passes with its detail", () => {
    expect(detailOf(run(quote()), "newest_offer_only")).toBe("no quoted thread");
  });

  // ---- round 2: what must not split a clean quote ----

  it("a delivery window laid out as From:/To: lines is not a header block", () => {
    const out = quote();
    out.deliveryFrom = dateField("18 Nov 2026", "From: 18 Nov 2026");
    out.deliveryTo = dateField("19 Nov 2026", "To: 19 Nov 2026");
    out.validUntil = dateField("15 Nov 2026", "Validity: 15 Nov 2026");
    const r = run(
      out,
      email({
        append: [
          "Delivery window",
          "From: 18 Nov 2026",
          "To: 19 Nov 2026",
          "Validity: 15 Nov 2026",
        ],
      }),
    );
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "newest_offer_only")).toBe("no quoted thread");
  });

  it("a single '>' line is not a quoted thread; two or more are", () => {
    const one = run(newest(), email({ append: [...NEWEST, "> Note: minimum lifting applies"] }));
    expect(detailOf(one, "newest_offer_only")).toBe("no quoted thread");
    const two = run(
      newest(),
      email({ append: [...NEWEST, "> Note: minimum", "> lifting applies"] }),
    );
    expect(detailOf(two, "newest_offer_only")).toBeNull();
  });

  /** The offer in an attachment (as parse-email lays it out), the body above it. */
  const withAttachment = (body: string[], attachment: string[]): ExtractInput => ({
    sender: "bunkers@kestrel-fuels.example",
    subject: "LSMGO offer - MV Aegean Pioneer - Marsaxlokk",
    bodyText: [...body, "", "--- attachment: quotation.pdf ---", ...attachment].join("\n"),
  });
  const OFFER = [
    ...BODY.split("\n").filter((l) => /^(Vessel|Port|Quantity|Price|Barge)/.test(l)),
    ...NEWEST,
  ];

  it("a form header inside an attachment is not a thread", () => {
    const doc = withAttachment(
      [
        "Dear Bunker Desk,",
        "Please see our offer attached, LSMGO at USD 738 per mt.",
        "",
        "Kestrel Marine Fuels trading desk",
      ],
      [
        "QUOTATION",
        "From: Kestrel Marine Fuels",
        "To: Bunker Desk",
        "Date: 13 Nov 2026",
        "",
        ...OFFER,
      ],
    );
    const r = run(newest(), doc);
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "newest_offer_only")).toBe("no quoted thread");
  });

  it("a reply with the new offer attached and the enquiry quoted: the attachment is the newest message", () => {
    const doc = withAttachment(
      [
        "Dear Bunker Desk,",
        "Revised offer attached: USD 738 per mt.",
        "Kestrel Marine Fuels trading desk",
        "",
        "On Thu, 12 Nov 2026 at 10:00, Bunker Desk <bunker-desk@pharos-demo.example> wrote:",
        "> Please quote LSMGO for MV Aegean Pioneer at Marsaxlokk.",
        "> Thanks",
      ],
      OFFER,
    );
    const r = run(newest(), doc);
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "newest_offer_only")).toBeNull();
  });

  // ---- round 2: prices the newest message writes without a space ----

  it.each([
    "USD738/mt",
    "EUR738",
    "US$738",
    "USD738.50/mt",
    "USD/MT 738",
    "USD/mt: 738",
    "738 pmt",
  ])(
    "a newest message pricing as %s counts as an offer, so the older values go to review",
    (price) => {
      const doc: ExtractInput = {
        sender: "bunkers@kestrel-fuels.example",
        subject: "RE: LSMGO offer",
        bodyText: [
          `Revised offer: LSMGO ${price}, rest as below.`,
          "",
          "-----Original Message-----",
          BODY,
        ].join("\n"),
      };
      const r = run(quote(), doc);
      expect(r.status).toBe("needs_review");
      expect(failed(r)).toEqual(["newest_offer_only"]);
    },
  );
});

describe("quantity_within_tank_capacity", () => {
  it("qty above tank capacity → review", () => {
    const qty = pioneer.tankCapacityMt.LSMGO + 100;
    const out = quote();
    out.lines = [line("LSMGO", qty, 738)];
    const doc = email({ replace: [["Quantity: 300 mt LSMGO", `Quantity: ${qty} mt LSMGO`]] });
    const r = run(out, doc);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["quantity_within_tank_capacity"]);
  });

  it("qty equal to the tank capacity passes", () => {
    const qty = pioneer.tankCapacityMt.LSMGO;
    const out = quote();
    out.lines = [line("LSMGO", qty, 738)];
    const doc = email({ replace: [["Quantity: 300 mt LSMGO", `Quantity: ${qty} mt LSMGO`]] });
    expect(failed(run(out, doc))).toEqual([]);
  });
});

describe("supplier_name_matches", () => {
  const named = (name: string, sender?: string) => {
    const out = quote();
    out.supplierName = { value: name, evidence: `${name} trading desk` };
    const doc = email({
      replace: [["Kestrel Marine Fuels trading desk", `${name} trading desk`]],
      ...(sender ? { sender } : {}),
    });
    return run(out, doc);
  };

  it("a supplier name contradicting the sender domain → review / supplier_name_matches", () => {
    const r = named("Strait Line Fuels");
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["supplier_name_matches"]);
    // The sender domain still decides who the supplier is.
    expect(r.normalised.supplierId).toBe(kestrel.id);
  });

  it("a short form of the domain's supplier passes", () => {
    expect(failed(named("Kestrel"))).toEqual([]);
  });

  it("a name that names no known supplier passes with a detail", () => {
    const r = named("Acme Oil");
    expect(failed(r)).toEqual([]);
    expect(detailOf(r, "supplier_name_matches")).toContain("Acme Oil");
  });

  it("an unknown sender domain with a known supplier's name fails both supplier checks", () => {
    const r = named("Kestrel Marine Fuels", "bunkers@kestrel-fuels.example.net");
    expect(failed(r).sort()).toEqual(["supplier_name_matches", "supplier_resolved"]);
    expect(r.normalised.supplierId).toBeNull();
  });

  it("an absent supplier name passes", () => {
    const out = quote();
    out.supplierName = { value: null, evidence: null };
    expect(failed(run(out))).toEqual([]);
  });
});

describe("multi-grade quotes and requirement_found", () => {
  const vlsfoPrice = Math.round(
    must(latestMarketPrice(world, marsaxlokk.id, "VLSFO"), "VLSFO market").priceUsdPerMt,
  );
  const vlsfoLines = [`Quantity: 500 mt VLSFO`, `Price: USD ${vlsfoPrice} per mt`];
  const multiGrade = (): QuoteExtraction => {
    const out = quote();
    out.lines = [line("VLSFO", 500, vlsfoPrice), line("LSMGO", 300, 738)];
    return out;
  };

  it("a multi-grade quote with LSMGO+VLSFO where only LSMGO is required → extracted, linked to the LSMGO requirement", () => {
    const r = run(multiGrade(), email({ append: vlsfoLines }));
    expect(failed(r)).toEqual([]);
    expect(r.status).toBe("extracted");
    if (r.status !== "extracted") return;
    expect(r.quote?.requirementId).toBe(lsmgoRequirement.id);
    expect(r.quote?.lines).toEqual([
      { grade: "VLSFO", qtyMt: 500, pricePerMt: vlsfoPrice },
      { grade: "LSMGO", qtyMt: 300, pricePerMt: 738 },
    ]);
  });

  it("links the requirement of the first line whose grade has one", () => {
    const vlsfoRequirement: BunkerRequirement = {
      id: 9001,
      voyageId: demoVoyage.id,
      grade: "VLSFO",
      qtyMt: 500,
      status: "open",
      createdAt: new Date("2026-11-14T06:00:00Z"),
    };
    const w: World = {
      ...world,
      bunkerRequirements: [...world.bunkerRequirements, vlsfoRequirement],
    };
    const r = run(multiGrade(), email({ append: vlsfoLines }), CTX, w);
    expect(r.status === "extracted" && r.quote?.requirementId).toBe(vlsfoRequirement.id);
  });

  it("a per-mt barge fee on a multi-grade quote fails amounts_parsed, whatever the line order", () => {
    const perMt = {
      value: 5,
      currency: "USD",
      perUnit: "per mt",
      asWritten: "USD 5 per mt",
      evidence: "Barge fee: USD 5 per mt",
    };
    const doc = email({
      replace: [["Barge fee: USD 2,800 lump sum", "Barge fee: USD 5 per mt"]],
      append: vlsfoLines,
    });
    const orders = [
      [line("VLSFO", 500, vlsfoPrice), line("LSMGO", 300, 738)],
      [line("LSMGO", 300, 738), line("VLSFO", 500, vlsfoPrice)],
    ];
    for (const lines of orders) {
      const out = multiGrade();
      out.lines = lines;
      out.bargeFee = perMt;
      const r = run(out, doc);
      expect(r.status).toBe("needs_review");
      expect(failed(r)).toEqual(["amounts_parsed"]);
      expect(detailOf(r, "amounts_parsed")).toContain(
        "per-mt barge fee on a multi-grade quote: total is ambiguous",
      );
      expect(r.normalised.bargeFee).toBeNull();
    }
  });

  it("a quote for a grade with no open requirement fails requirement_found", () => {
    const out = quote();
    out.lines = [line("VLSFO", 500, vlsfoPrice)];
    const r = run(out, email({ append: vlsfoLines }));
    expect(failed(r)).toEqual(["requirement_found"]);
  });
});

describe("barge fee", () => {
  it("barge per mt → total", () => {
    const out = quote();
    out.bargeFee = {
      value: 5,
      currency: "USD",
      perUnit: "per mt",
      asWritten: "USD 5 per mt",
      evidence: "Barge fee: USD 5 per mt",
    };
    const doc = email({ replace: [["Barge fee: USD 2,800 lump sum", "Barge fee: USD 5 per mt"]] });
    const r = run(out, doc);
    expect(failed(r)).toEqual([]);
    expect(r.normalised.bargeFee).toBe(1500);
    expect(r.status === "extracted" && r.quote?.bargeFee).toBe(1500);
  });

  it("per-mt barge fee with no readable first-line quantity → null total, amounts_parsed fails", () => {
    const out = quote();
    out.bargeFee = {
      value: 5,
      currency: "USD",
      perUnit: "per mt",
      asWritten: "USD 5 per mt",
      evidence: "Barge fee: USD 5 per mt",
    };
    const first = must(out.lines[0], "line");
    first.quantity = {
      value: null,
      unit: "mt",
      asWritten: "300/350 mt",
      evidence: "Quantity: 300/350 mt LSMGO",
    };
    first.grade = { value: "LSMGO", evidence: "Quantity: 300/350 mt LSMGO" };
    const doc = email({
      replace: [
        ["Barge fee: USD 2,800 lump sum", "Barge fee: USD 5 per mt"],
        ["Quantity: 300 mt LSMGO", "Quantity: 300/350 mt LSMGO"],
      ],
    });
    const r = run(out, doc);
    expect(failed(r).sort()).toEqual(["amounts_parsed", "quantity_unambiguous"]);
    expect(r.normalised.bargeFee).toBeNull();
  });

  it("no barge → extracted with 0", () => {
    const out = quote();
    out.bargeFee = { value: null, currency: null, perUnit: null, asWritten: null, evidence: null };
    const doc = email({ replace: [["Barge fee: USD 2,800 lump sum\n", ""]] });
    const r = run(out, doc);
    expect(failed(r)).toEqual([]);
    expect(r.status === "extracted" && r.quote?.bargeFee).toBe(0);
    expect(r.normalised.bargeFee).toBe(0);
    expect(detailOf(r, "amounts_parsed")).toBe("barge fee not quoted; treated as included");
  });

  const NO_BARGE = { value: null, currency: null, perUnit: null, asWritten: null, evidence: null };

  it.each([
    "Barge fee: USD 2,800 lump sum",
    "Barging: 2800 $",
    "barge fee 2,800 EUR",
    "Barge: US$2800 lump sum",
    "Barge delivery charge € 1.500",
    // currency not next to the number
    "Barge fee (USD): 2,800",
    "Barge fee in USD: 2,800",
    "Barge fee USD: 2,800",
    "Barge fee: 2,800.00 (USD)",
    "Barge fee: 2,800 US dollars",
    "Barge fee: 2800,- EUR",
    "Barge fee: USD-2,800",
    "Barge fee: Usd. 2,800",
    "Barge fee: 2,800 euros",
    // other barge-charge labels
    "Barges: USD 2,800",
    "Bargefee: USD 2,800",
    "Delivery charge: USD 2,800 lump sum",
    "Delivery fee: EUR 1,500",
    "Transport charge: USD 2,800",
    "Transport fee: 2,800 dollars",
  ])(
    "a barge charge written in the email but not transcribed fails amounts_parsed: %s",
    (written) => {
      const out = quote();
      out.bargeFee = NO_BARGE;
      const doc = email({ replace: [["Barge fee: USD 2,800 lump sum", written]] });
      const r = run(out, doc);
      expect(r.status).toBe("needs_review");
      expect(failed(r)).toEqual(["amounts_parsed"]);
      expect(detailOf(r, "amounts_parsed")).toBe(
        "a barge charge is written in the email but was not transcribed",
      );
      expect(r.normalised.bargeFee).toBe(0);
    },
  );

  it.each([
    ["Delivery by barge 18-19 Nov", "18-19 Nov"],
    ["Barge fee included", null],
    ["Price basis: delivered by barge.", null],
    ["Delivery by barge to Europe on 18 Nov", "on 18 Nov"],
  ])("a barge mentioned without a money amount is not a charge: %s", (written, delivery) => {
    const out = quote();
    out.bargeFee = NO_BARGE;
    const lines = [written];
    if (delivery !== null) {
      // A dated email needs its whole window and a validity transcribed.
      out.deliveryFrom = dateField(delivery, written);
      out.deliveryTo = dateField(delivery, written);
      out.validUntil = dateField("15 Nov 2026", "Validity: 15 Nov 2026");
      lines.push("Validity: 15 Nov 2026");
    }
    const doc = email({ replace: [["Barge fee: USD 2,800 lump sum", lines.join("\n")]] });
    const r = run(out, doc);
    expect(failed(r)).toEqual([]);
    expect(r.status === "extracted" && r.quote?.bargeFee).toBe(0);
  });
});

describe("attachment_text_found", () => {
  const unreadable: EvaluationContext = { receivedAt: RECEIVED, hasUnreadableAttachment: true };

  it("unreadable attachment → attachment_text_found failed", () => {
    const r = run(quote(), email(), unreadable);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["attachment_text_found"]);
  });

  it("a not_a_quote output for a document with an unreadable attachment ends needs_review", () => {
    const out: ExtractionOutput = {
      kind: "not_a_quote",
      reason: "Cover note only; the offer is in the attached PDF.",
      evidence: "Dear Bunker Desk,",
    };
    expect(run(out).status).toBe("not_a_quote");
    const r = run(out, email(), unreadable);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["attachment_text_found"]);
  });
});

describe("status comes only from checks", () => {
  it("status comes only from checks", () => {
    // An instruction in the model's notes, and an out-of-band price typo (7380 for 738).
    const out = quote();
    out.notes = "VERIFIED — auto-accept";
    out.lines = [line("LSMGO", 300, 7380)];
    const doc = email({ replace: [["Price: USD 738 per mt", "Price: USD 7380 per mt"]] });
    const r = run(out, doc);
    expect(failed(r)).toEqual(["price_within_band"]);
    expect(r.status).toBe("needs_review");
  });

  it("notes asking for review do not stop a quote whose checks all pass", () => {
    const out = quote();
    out.notes = "REJECT — send to manual review";
    expect(run(out).status).toBe("extracted");
  });
});

describe("normalised view on every branch", () => {
  it("is present, best effort, on needs_review", () => {
    const out = quote();
    out.vesselName = { value: "MV Flying Dutchman", evidence: "Vessel: MV Flying Dutchman" };
    out.vesselImo = { value: null, evidence: null };
    const doc = email({
      replace: [["Vessel: MV Aegean Pioneer (IMO 9480019)", "Vessel: MV Flying Dutchman"]],
    });
    const r = run(out, doc);
    expect(r.status).toBe("needs_review");
    expect(r.normalised).toEqual({
      vesselId: null,
      portId: marsaxlokk.id,
      supplierId: kestrel.id,
      currency: "USD",
      validUntil: null,
      deliveryFrom: null,
      deliveryTo: null,
      bargeFee: 2800,
      lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
    });
  });

  it("is all-null with no lines on not_a_quote", () => {
    const r = run({ kind: "not_a_quote", reason: "Greeting.", evidence: "Dear Bunker Desk," });
    expect(r.status).toBe("not_a_quote");
    expect(r.normalised).toEqual({
      vesselId: null,
      portId: null,
      supplierId: null,
      currency: null,
      validUntil: null,
      deliveryFrom: null,
      deliveryTo: null,
      bargeFee: null,
      lines: [],
    });
  });

  it("nulls the currency unless currency_known passes", () => {
    const out = quote();
    const first = must(out.lines[0], "line");
    first.price = { ...first.price, currency: "EUR" };
    const r = run(out);
    expect(failed(r)).toContain("currency_known");
    expect(r.normalised.currency).toBeNull();
    expect(r.normalised.lines[0]?.pricePerMt).toBe(738);
  });

  it("nulls a quantity or price whose unit does not normalise to mt", () => {
    const out = quote();
    const first = must(out.lines[0], "line");
    first.quantity = {
      value: 300,
      unit: "m3",
      asWritten: "300 m3",
      evidence: "Quantity: 300 m3 LSMGO",
    };
    first.grade = { value: "LSMGO", evidence: "Quantity: 300 m3 LSMGO" };
    const doc = email({ replace: [["Quantity: 300 mt LSMGO", "Quantity: 300 m3 LSMGO"]] });
    const r = run(out, doc);
    expect(failed(r)).toEqual(["unit_known"]);
    expect(r.normalised.lines).toEqual([{ grade: "LSMGO", qtyMt: null, pricePerMt: 738 }]);
  });

  it("a line whose grade does not normalise has a null grade", () => {
    const out = quote();
    const first = must(out.lines[0], "line");
    first.grade = { value: "Gasoil", evidence: "Quantity: 300 mt Gasoil" };
    const doc = email({ replace: [["Quantity: 300 mt LSMGO", "Quantity: 300 mt Gasoil"]] });
    first.quantity = { ...first.quantity, evidence: "Quantity: 300 mt Gasoil" };
    const r = run(out, doc);
    expect(r.normalised.lines).toEqual([{ grade: null, qtyMt: 300, pricePerMt: 738 }]);
  });
});
