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
    for (const name of CHECK_NAMES.filter((n) => n !== "evidence_found:notAQuote")) {
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
  const withValidity = (written: string, ctx: EvaluationContext = CTX) => {
    const out = quote();
    out.validUntil = dateField(written, `Valid until: ${written}`);
    return run(out, email({ append: [`Valid until: ${written}`] }), ctx);
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
    expect(r.status === "extracted" && r.quote.validUntil).toBe("2026-11-14");
  });

  it("a validity with no year that reads as a past day fails: 30 Dec received 2 Jan", () => {
    const r = withValidity("30 Dec", receivedOn("2027-01-02T09:00:00Z"));
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

  it("absent validity passes with the detail 'no validity stated'", () => {
    const r = run(quote());
    expect(r.checks.find((c) => c.check === "validity_not_expired")).toEqual({
      check: "validity_not_expired",
      passed: true,
      detail: "no validity stated",
    });
  });
});

describe("delivery dates (R7) and dates_parsed", () => {
  const withDelivery = (
    from: string | null,
    to: string | null,
    bodyLine = `Delivery: ${from ?? to}`,
    ctx: EvaluationContext = CTX,
  ) => {
    const out = quote();
    if (from !== null) out.deliveryFrom = dateField(from, bodyLine);
    if (to !== null) out.deliveryTo = dateField(to, bodyLine);
    return run(out, email({ append: [bodyLine] }), ctx);
  };

  it('"18-19 Nov" → deliveryFrom/To set', () => {
    const r = withDelivery("18-19 Nov", null);
    expect(failed(r)).toEqual([]);
    expect(r.normalised).toMatchObject({ deliveryFrom: "2026-11-18", deliveryTo: "2026-11-19" });
    expect(r.status === "extracted" && [r.quote.deliveryFrom, r.quote.deliveryTo]).toEqual([
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

  it("a single date in deliveryFrom alone sets only the start", () => {
    for (const written of ["from 18 Nov", "on 18 Nov"]) {
      const r = withDelivery(written, null, `Delivery ${written}`);
      expect(failed(r), written).toEqual([]);
      expect(r.normalised, written).toMatchObject({ deliveryFrom: "2026-11-18", deliveryTo: null });
      expect(r.status === "extracted" && [r.quote.deliveryFrom, r.quote.deliveryTo]).toEqual([
        "2026-11-18",
        null,
      ]);
    }
  });

  it("a single date in deliveryTo alone sets only the end", () => {
    const r = withDelivery(null, "by 20 Nov", "Delivery by 20 Nov");
    expect(failed(r)).toEqual([]);
    expect(r.normalised).toMatchObject({ deliveryFrom: null, deliveryTo: "2026-11-20" });
    expect(r.status === "extracted" && [r.quote.deliveryFrom, r.quote.deliveryTo]).toEqual([
      null,
      "2026-11-20",
    ]);
  });

  it("a stated date that parses neither way fails dates_parsed only", () => {
    const r = withDelivery("next week", null);
    expect(r.status).toBe("needs_review");
    expect(failed(r)).toEqual(["dates_parsed"]);
    expect(r.normalised).toMatchObject({ deliveryFrom: null, deliveryTo: null });
  });

  it("no delivery date stated: delivery_window_valid passes with its detail", () => {
    expect(detailOf(run(quote()), "delivery_window_valid")).toBe("no delivery window stated");
  });

  it("a window that ends before the email was received → delivery_window_valid", () => {
    const r = withDelivery("10-12 Nov", null);
    expect(failed(r)).toEqual(["delivery_window_valid"]);
  });

  it("a window with no year that reads as past days fails: 28-30 Dec received 2 Jan", () => {
    const r = withDelivery("28-30 Dec", null, undefined, receivedOn("2027-01-02T09:00:00Z"));
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
    expect(r.quote.requirementId).toBe(lsmgoRequirement.id);
    expect(r.quote.lines).toEqual([
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
    expect(r.status === "extracted" && r.quote.requirementId).toBe(vlsfoRequirement.id);
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
    expect(r.status === "extracted" && r.quote.bargeFee).toBe(1500);
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
    expect(r.status === "extracted" && r.quote.bargeFee).toBe(0);
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
    "Delivery by barge 18-19 Nov",
    "Barge fee included",
    "Price basis: delivered by barge.",
    "Delivery by barge to Europe on 18 Nov",
  ])("a barge mentioned without a money amount is not a charge: %s", (written) => {
    const out = quote();
    out.bargeFee = NO_BARGE;
    const doc = email({ replace: [["Barge fee: USD 2,800 lump sum", written]] });
    const r = run(out, doc);
    expect(failed(r)).toEqual([]);
    expect(r.status === "extracted" && r.quote.bargeFee).toBe(0);
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
