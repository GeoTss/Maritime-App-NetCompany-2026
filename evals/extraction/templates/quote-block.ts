/**
 * Shared pieces for generated quote templates: the as-written phrasing of a quote's facts, the
 * perfect transcription of that phrasing, sender/subject/signature variants, and the plain-text
 * labelled offer block several templates reuse.
 */
import type { World } from "@pharos/db";
import type { ExtractionTruth } from "@pharos/shared";
import {
  DESK,
  type GoldenCase,
  type Mailbox,
  type MailDraft,
  type MoneySpan,
  type QuoteTranscription,
} from "../case.js";
import { type QuoteFacts, truthFromFacts } from "../facts.js";
import { type Prng, prngInt, prngPick, sha256Hex } from "../prng.js";
import {
  BARGE_INCLUDED,
  bareName,
  formatNumber,
  phraseBargeLump,
  phraseGrade,
  phrasePort,
  phrasePrice,
  phraseQty,
  phraseValidity,
  phraseVessel,
  phraseWindow,
  pickAmountStyle,
  pickPerson,
  refCode,
  supplierCode,
  type VesselPhrase,
  type WindowPhrase,
} from "./phrasing.js";

export interface TemplateContext {
  world: World;
  prng: Prng;
  /** Case id, e.g. "plain-007". */
  id: string;
}

export type Template = (ctx: TemplateContext) => Promise<GoldenCase> | GoldenCase;

export interface PhrasedLine {
  gradeText: string;
  /** `value` overrides the number read from `asWritten` (hard variants: null when ambiguous). */
  qty: { asWritten: string; unit: string; value?: number | null };
  price: MoneySpan;
}

/** `per_mt` is used only by hand-specified hard variants; generated quotes never draw it. */
export type BargePhrase =
  | { kind: "absent" }
  | { kind: "included"; text: string }
  | { kind: "lump_sum" | "per_mt"; span: MoneySpan };

export interface PhrasedQuote {
  facts: QuoteFacts;
  vessel: VesselPhrase;
  port: { text: string; value: string };
  lines: PhrasedLine[];
  barge: BargePhrase;
  validity: string;
  window: WindowPhrase;
  person: { first: string; last: string; local: string };
  ref: string;
}

export function phraseQuote(prng: Prng, facts: QuoteFacts): PhrasedQuote {
  const style = pickAmountStyle(
    prng,
    facts.lines.map((l) => l.pricePerMt),
  );
  const lines = facts.lines.map((l) => ({
    gradeText: phraseGrade(prng, l.grade),
    qty: phraseQty(prng, l.qtyMt, style),
    price: phrasePrice(prng, l.pricePerMt, facts.currency, style),
  }));
  let barge: BargePhrase;
  if (facts.barge.kind === "lump_sum") {
    barge = { kind: "lump_sum", span: phraseBargeLump(prng, facts.barge.amount, facts.currency) };
  } else {
    barge =
      prng() < 0.5
        ? { kind: "absent" }
        : { kind: "included", text: prngPick(prng, BARGE_INCLUDED) };
  }
  return {
    facts,
    vessel: phraseVessel(prng, facts.vessel),
    port: phrasePort(prng, facts.port),
    lines,
    barge,
    validity: phraseValidity(prng, facts.validUntil).text,
    window: phraseWindow(prng, facts.deliveryFrom, facts.deliveryTo),
    person: pickPerson(prng),
    ref: refCode(prng, supplierCode(facts.supplier.erpCode)),
  };
}

export interface Labels {
  vessel: string;
  port: string;
  grade: string;
  qty: string;
  price: string;
  barge: string;
  validity: string;
  delivery: string;
  deliveryFrom: string;
  deliveryTo: string;
}

export function pickLabels(prng: Prng): Labels {
  return {
    vessel: prngPick(prng, ["Vessel", "Vessel", "Ship", "Vessel name"]),
    port: prngPick(prng, ["Port", "Port", "Delivery port", "Location", "Place of delivery"]),
    grade: prngPick(prng, ["Grade", "Grade", "Product", "Fuel"]),
    qty: prngPick(prng, ["Quantity", "Quantity", "Qty"]),
    price: prngPick(prng, ["Price", "Price", "Unit price", "Offer price"]),
    barge: prngPick(prng, ["Barging", "Barge fee", "Barge", "Delivery charge"]),
    validity: prngPick(prng, [
      "Validity",
      "Offer valid until",
      "Prices valid until",
      "Firm until",
      "Valid till",
    ]),
    delivery: prngPick(prng, [
      "Delivery",
      "Delivery window",
      "Delivery date",
      "Dates",
      "Delivery period",
    ]),
    deliveryFrom: "Delivery from",
    deliveryTo: "Delivery to",
  };
}

/** "Label: value" lines of the offer, in a fixed order. */
export function labelledOfferLines(pq: PhrasedQuote, l: Labels): string[] {
  const out = [
    `${l.vessel}: ${pq.vessel.text}`,
    `${l.port}: ${pq.port.text}`,
    ...windowLines(pq.window, l),
  ];
  if (pq.lines.length === 1) {
    const [line] = pq.lines as [PhrasedLine];
    out.push(
      `${l.grade}: ${line.gradeText}`,
      `${l.qty}: ${line.qty.asWritten}`,
      `${l.price}: ${line.price.asWritten}`,
    );
  } else {
    pq.lines.forEach((line, i) => {
      out.push(
        `${l.grade} ${i + 1}: ${line.gradeText}`,
        `${l.qty}: ${line.qty.asWritten}`,
        `${l.price}: ${line.price.asWritten}`,
      );
    });
  }
  const barge = bargeText(pq.barge);
  if (barge !== null) out.push(`${l.barge}: ${barge}`);
  out.push(`${l.validity}: ${pq.validity}`);
  return out;
}

export function windowLines(w: WindowPhrase, l: Labels): string[] {
  return w.kind === "one"
    ? [`${l.delivery}: ${w.text}`]
    : [`${l.deliveryFrom}: ${w.from}`, `${l.deliveryTo}: ${w.to}`];
}

export const bargeText = (b: BargePhrase): string | null =>
  b.kind === "lump_sum" || b.kind === "per_mt"
    ? b.span.asWritten
    : b.kind === "included"
      ? b.text
      : null;

export interface TranscribeHints {
  /** Labels sit on the same text line as their value (labelled layouts). */
  labels?: Labels;
  /** The line items carry their own labels (labelled or per-grade layouts). */
  lineLabels?: boolean;
}

/** The perfect transcription of a phrased quote; evidence lines are attached from the text later. */
export function transcribe(pq: PhrasedQuote, hints: TranscribeHints = {}): QuoteTranscription {
  const l = hints.labels;
  const near = (label: string | undefined) => (label === undefined ? {} : { near: label });
  const w = pq.window;
  return {
    kind: "quote",
    supplierName: { value: pq.facts.supplier.name },
    vesselName: pq.vessel.name === null ? null : { value: pq.vessel.name, ...near(l?.vessel) },
    vesselImo: pq.vessel.imo === null ? null : { value: pq.vessel.imo, ...near(l?.vessel) },
    port: { value: pq.port.value, ...near(l?.port) },
    deliveryFrom:
      w.kind === "one"
        ? { asWritten: w.text, ...near(l?.delivery) }
        : { asWritten: w.from, ...near(l?.deliveryFrom) },
    deliveryTo:
      w.kind === "one"
        ? { asWritten: w.text, ...near(l?.delivery) }
        : { asWritten: w.to, ...near(l?.deliveryTo) },
    validUntil: { asWritten: pq.validity, ...near(l?.validity) },
    bargeFee:
      pq.barge.kind === "lump_sum" || pq.barge.kind === "per_mt"
        ? { ...pq.barge.span, ...near(l?.barge) }
        : null,
    lines: pq.lines.map((line) => ({
      grade: { value: line.gradeText, ...near(hints.lineLabels ? l?.grade : undefined) },
      quantity: {
        value: line.qty.value !== undefined ? line.qty.value : pqNumber(line.qty.asWritten),
        unit: line.qty.unit,
        asWritten: line.qty.asWritten,
        ...near(hints.lineLabels ? l?.qty : undefined),
      },
      price: { ...line.price, ...near(hints.lineLabels ? l?.price : undefined) },
    })),
  };
}

/** The number a transcriber reads from a generated quantity span ("1,200 mt" -> 1200). */
const pqNumber = (asWritten: string): number => Number(asWritten.split(" ")[0]?.replace(/,/g, ""));

/** The truth for a generated quote: status extracted, values from the facts. */
export function quoteTruth(id: string, tags: string[], facts: QuoteFacts): ExtractionTruth {
  return {
    id,
    tags,
    source: "generated",
    expected: {
      kind: "quote",
      status: "extracted",
      reviewChecks: [],
      quote: truthFromFacts(facts),
    },
  };
}

// ---------- sender, subject, greeting, signature ----------

export function senderOf(prng: Prng, pq: PhrasedQuote): Mailbox {
  const { supplier } = pq.facts;
  const personal = prng() < 0.6;
  const local = personal
    ? pq.person.local
    : prngPick(prng, ["trading", "bunkers", "offers", "desk", "sales"]);
  const name = personal
    ? `${asciiPerson(pq)} - ${supplier.name}`
    : `${supplier.name} ${prngPick(prng, ["Trading", "Bunker Desk", "Sales"])}`;
  return { name, address: `${local}@${supplier.emailDomain}` };
}

const asciiPerson = (pq: PhrasedQuote) =>
  `${pq.person.first} ${pq.person.last}`.normalize("NFD").replace(/[^\x20-\x7e]/g, "");

export function subjectOf(prng: Prng, pq: PhrasedQuote): string {
  const vessel = bareName(pq.facts.vessel);
  const port = pq.facts.port.name;
  const grade = pq.lines.map((l) => l.gradeText.split(" ")[0]).join("/");
  return prngPick(prng, [
    `${grade} offer - ${pq.facts.vessel.name} - ${port}`,
    `Bunker offer ${vessel} / ${port}`,
    `RE: Enquiry ${vessel} - ${port} bunkers`,
    `Quotation ${pq.ref} - ${vessel} at ${port}`,
    `${vessel} - ${port} - our offer`,
    `Offer: ${grade} for ${vessel} (${port})`,
  ]).replace(/[^\x20-\x7e]/g, "");
}

export function greetingOf(prng: Prng): string {
  return prngPick(prng, [
    "Dear Sirs,",
    "Dear Bunker Desk,",
    "Good morning,",
    "Dear colleagues,",
    "Hello team,",
  ]);
}

export function introOf(prng: Prng): string {
  return prngPick(prng, [
    "Thank you for your enquiry. We are pleased to offer as follows:",
    "Further to your request, please find our offer below.",
    "As discussed, we can offer the following:",
    "Please see our firm offer below.",
  ]);
}

export function termsOf(prng: Prng): string[] {
  const all = [
    "Payment: 30 days from date of delivery.",
    "Subject to availability at time of nomination.",
    "Our standard terms and conditions apply.",
    "Price basis: delivered by barge.",
    "Supply subject to port and weather conditions.",
    "Prices exclude any local taxes, if applicable.",
  ];
  const n = prngInt(prng, 1, 3);
  const start = prngInt(prng, 0, all.length - 1);
  return Array.from({ length: n }, (_, i) => all[(start + i) % all.length] as string);
}

export function signatureOf(prng: Prng, pq: PhrasedQuote, address: string): string[] {
  const { supplier } = pq.facts;
  const sign = prngPick(prng, ["Best regards,", "Kind regards,", "Regards,", "BR,"]);
  const title = prngPick(prng, ["Bunker Trader", "Trading Desk", "Senior Trader", "Marine Fuels"]);
  const company = prngPick(prng, [
    supplier.name,
    `${supplier.name} | Trading Desk`,
    `For and on behalf of ${supplier.name}`,
  ]);
  const phone = `+${prngInt(prng, 30, 49)} ${prngInt(prng, 20, 99)} ${prngInt(prng, 1000, 9999)} ${prngInt(prng, 1000, 9999)}`;
  return [sign, `${pq.person.first} ${pq.person.last}`, title, company, `T ${phone} | ${address}`];
}

/** A stable, realistic-looking Message-ID for a case. */
export function messageIdOf(id: string, domain: string): string {
  return `${sha256Hex(`message-id:${id}`).slice(0, 20)}@${domain}`;
}

export function baseDraft(
  ctx: TemplateContext,
  pq: PhrasedQuote,
  body: Pick<MailDraft, "text" | "html" | "attachments">,
  from: Mailbox,
  subject: string,
): MailDraft {
  return {
    from,
    to: DESK,
    subject,
    date: pq.facts.receivedAt,
    messageId: messageIdOf(ctx.id, pq.facts.supplier.emailDomain),
    ...body,
  };
}

/** Thousands-grouped number for prose ("2,800"). */
export const grouped = (n: number): string => formatNumber(n, { thousands: true, decimals: 0 });
