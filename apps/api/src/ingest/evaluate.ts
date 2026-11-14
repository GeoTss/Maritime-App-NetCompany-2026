/**
 * The pure half of the ingestion workflow: normalisation and checks for one extraction.
 *
 *   normaliseExtraction: the model's as-written values mapped to world ids, mt, ISO dates and a
 *                        barge-fee total by deterministic code, whatever the status. The graders
 *                        and the review queue read it.
 *   evaluateExtraction:  every check, the normalised view, and the quote to store when all pass.
 *
 * Status comes only from the checks: no value the model writes, and no `notes` text, can set it.
 * No database, no clock: the received time and the attachment flag come in as context.
 */
import { currentVoyage, openRequirements, type World } from "@pharos/db";
import {
  bargeFeeTotal,
  evidenceSupports,
  hedgedInSource,
  isoDayAfter,
  mentionsDate,
  normaliseCurrency,
  normaliseGrade,
  normaliseMassUnit,
  normalisePerUnit,
  parseAmount,
  parseDeliveryWindow,
  parseQuoteDate,
} from "@pharos/domain";
import type {
  CheckResult,
  Currency,
  DateField,
  ExtractionOutput,
  FuelGrade,
  Id,
  IsoDate,
  MoneyField,
  NormalisedView,
  QuoteExtraction,
  QuoteLineExtraction,
} from "@pharos/shared";
import { type ExtractInput, sourceText } from "../ai/extract.js";
import {
  checkPriceBand,
  resolvePort,
  resolveSupplier,
  resolveSupplierName,
  resolveVessel,
} from "./resolve.js";

// ---------- check names ----------

/** Per-field evidence checks are `evidence_found:<path>`, e.g. `evidence_found:lines.0.price`. */
export const EVIDENCE_CHECK_PREFIX = "evidence_found:";

/** Every check with a fixed name. The golden truth's `reviewChecks` use these names. */
export const CHECK_NAMES = [
  "evidence_found:notAQuote",
  "currency_known",
  "unit_known",
  "grade_known",
  "quantity_unambiguous",
  "amounts_parsed",
  "dates_parsed",
  "validity_not_expired",
  "delivery_window_valid",
  "newest_offer_only",
  "vessel_resolved",
  "port_resolved",
  "supplier_resolved",
  "supplier_name_matches",
  "price_within_band",
  "quantity_within_tank_capacity",
  "requirement_found",
  "attachment_text_found",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number] | `${typeof EVIDENCE_CHECK_PREFIX}${string}`;

/** A fixed check name, or `evidence_found:` followed by a field path. */
export function isCheckName(name: string): boolean {
  return (
    (CHECK_NAMES as readonly string[]).includes(name) ||
    (name.startsWith(EVIDENCE_CHECK_PREFIX) && name.length > EVIDENCE_CHECK_PREFIX.length)
  );
}

/** Passes with `note` as its detail when there are no failures; else fails with them. */
const check = (name: CheckName, failures: string[], note: string | null = null): CheckResult => ({
  check: name,
  passed: failures.length === 0,
  detail: failures.length === 0 ? note : failures.join(" "),
});

const allPassed = (checks: CheckResult[]): boolean => checks.every((c) => c.passed);

// ---------- shared reading rules (used by both the checks and the normalised view) ----------

/** The number in the as-written text, if it parses and equals the transcribed value. */
function readAmount(f: { value: number | null; asWritten: string | null }): number | null {
  if (f.value === null || f.asWritten === null) return null;
  const parsed = parseAmount(f.asWritten);
  return parsed !== null && parsed === f.value ? parsed : null;
}

const foldText = (x: string): string => x.replace(/\s+/g, " ").trim().toLowerCase();
const isWordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);

/**
 * Was the transcribed currency/unit string written in the field's own as-written text? Not its
 * evidence line: on "120 m3 at USD 728 per mt" the "mt" belongs to the price, not the quantity.
 * Case- and whitespace-folded; an alphanumeric edge must sit on a word boundary, so "mt" is not
 * found inside "pmt" and "usd" not inside "usdt".
 */
export function writtenIn(raw: string | null, asWritten: string | null): boolean {
  if (raw === null || asWritten === null) return false;
  const needle = foldText(raw);
  if (needle === "") return false;
  const hay = foldText(asWritten);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = hay[at - 1];
    const after = hay[at + needle.length];
    const startOk = !isWordChar(needle[0]) || !isWordChar(before);
    const endOk = !isWordChar(needle.at(-1)) || !isWordChar(after);
    if (startOk && endOk) return true;
  }
  return false;
}

/** A validity this many days or fewer after the received day is plausible; further is a misread year. */
const VALIDITY_MAX_DAYS_AHEAD = 60;
/** A delivery window ending this many days or fewer after the received day is plausible. */
const DELIVERY_MAX_DAYS_AHEAD = 120;
const FAR_AHEAD = "implausibly far ahead of the received date — check the year";

/** A barge-charge label: "barg" anywhere (barge, barges, barging, bargefee), delivery/transport charge or fee. */
const BARGE_LABEL = /barg|\bdelivery (?:charge|fee)\b|\btransport (?:charge|fee)\b/i;
/** A currency anywhere on the line: USD, US$, $, EUR, €, euro(s), dollar(s). */
const CURRENCY_TOKEN = /\b(?:usd|eur|euros?|dollars?)\b|us\$|\$|€/i;

/**
 * Some line of the email has a barge-charge label, a currency and a digit: a barge charge is
 * written there. ("Delivery by barge 18-19 Nov" and "Barge fee included" are not charges.)
 */
function bargeChargeWritten(source: string): boolean {
  return source
    .split(/\r?\n/)
    .some((l) => BARGE_LABEL.test(l) && CURRENCY_TOKEN.test(l) && /\d/.test(l));
}

/** A validity word: valid, validity, expire(s/d), expiry, firm until, (offer) good until. */
const VALIDITY_WORD =
  /\bvalid(?:ity)?\b|\bexpir(?:e|es|ed|y|ing|ation)\b|\bfirm until\b|\bgood until\b/i;
/** A delivery word: delivery (window), deliveries, ETA, laycan. */
const DELIVERY_WORD = /\bdeliver(?:y|ies)\b|\beta\b|\blaycan\b/i;

/**
 * Some line of the email has the word and something that reads as a date: a validity or a
 * delivery date is written there ("Prices valid for 24 hours" and "Delivery ex-barge" are not).
 */
const dateWrittenWith = (source: string, word: RegExp): boolean =>
  source.split(/\r?\n/).some((l) => word.test(l) && mentionsDate(l));

/** Some line of the email (subject, body, attachments) reads as naming a day. */
const namesADate = (source: string): boolean => source.split(/\r?\n/).some((l) => mentionsDate(l));

const NO_VALIDITY = "no validity determined — a human confirms";
const NO_WINDOW = "delivery window not fully determined — a human confirms";

/** A deliveryFrom text that names an end ("by 20 Nov"), not a start. */
const END_DATE_WORDS = /^(?:by|before|no later than|until)\b/;

const bargeQuoted = (barge: MoneyField): boolean =>
  barge.value !== null || barge.asWritten !== null;

/** One recognised currency, written in its text, across every price and a quoted barge fee. */
function readCurrency(q: QuoteExtraction): { currency: Currency | null; failures: string[] } {
  const failures: string[] = [];
  const fields = [
    ...q.lines.map((l, i) => [`lines.${i}.price`, l.price] as const),
    ...(bargeQuoted(q.bargeFee) ? [["bargeFee", q.bargeFee] as const] : []),
  ];
  const currencies = fields.map(([path, field]) => {
    const raw = field.currency;
    const c = normaliseCurrency(raw);
    if (c === null) failures.push(`Currency "${raw ?? ""}" of ${path} is not recognised.`);
    else if (!writtenIn(raw, field.asWritten)) {
      failures.push(`Currency "${raw}" of ${path} is not written in its text.`);
    }
    return c;
  });
  const known = [...new Set(currencies.filter((c): c is Currency => c !== null))];
  if (known.length > 1) failures.push(`The quote mixes currencies (${known.join(", ")}).`);
  return { currency: failures.length === 0 ? (known[0] ?? null) : null, failures };
}

/** Why a line's quantity is not in mass units / its price not per mt, or null when it is. */
function lineUnitProblems(
  l: QuoteLineExtraction,
  i: number,
): { quantity: string | null; price: string | null } {
  const notWritten = (raw: string | null, what: string) =>
    `${what} "${raw ?? ""}" is not written in its text.`;
  const quantity =
    normaliseMassUnit(l.quantity.unit) === null
      ? `Quantity unit "${l.quantity.unit ?? ""}" of line ${i} is not a mass unit.`
      : writtenIn(l.quantity.unit, l.quantity.asWritten)
        ? null
        : notWritten(l.quantity.unit, `Quantity unit of line ${i}`);
  const price =
    normalisePerUnit(l.price.perUnit) !== "per_mt"
      ? `Price of line ${i} is not per mt ("${l.price.perUnit ?? ""}").`
      : writtenIn(l.price.perUnit, l.price.asWritten)
        ? null
        : notWritten(l.price.perUnit, `Price unit of line ${i}`);
  return { quantity, price };
}

/** A quoted barge fee's unit (per mt or lump sum, written in its text), or why it has none. */
function bargeUnit(barge: MoneyField): {
  unit: "per_mt" | "lump_sum" | null;
  problem: string | null;
} {
  const unit = normalisePerUnit(barge.perUnit);
  if (unit === null) {
    return { unit: null, problem: `Barge fee unit "${barge.perUnit ?? ""}" is not recognised.` };
  }
  if (!writtenIn(barge.perUnit, barge.asWritten)) {
    return { unit: null, problem: `Barge fee unit "${barge.perUnit}" is not written in its text.` };
  }
  return { unit, problem: null };
}

type DatePath = "deliveryFrom" | "deliveryTo" | "validUntil";

/**
 * Dates (R7). A delivery field whose as-written text reads as a window gives its own end of it
 * (`from` for deliveryFrom, `to` for deliveryTo), else it is read as a single date. When only one
 * delivery field has an as-written text and it reads as a real span (from ≠ to), it fills both
 * ends; a single date ("by 20 Nov", "from 18 Nov") sets only its own field's end. The reference
 * for a missing year is the received time.
 */
function readDates(
  q: QuoteExtraction,
  receivedAt: Date,
): {
  validUntil: IsoDate | null;
  deliveryFrom: IsoDate | null;
  deliveryTo: IsoDate | null;
  /** Fields with an as-written text that reads as no date. */
  unparsed: { path: DatePath; asWritten: string }[];
} {
  const unparsed: { path: DatePath; asWritten: string }[] = [];
  const delivery = (path: DatePath, f: DateField) => {
    if (f.asWritten === null) return null;
    const window = parseDeliveryWindow(f.asWritten, receivedAt);
    const single = window ? null : parseQuoteDate(f.asWritten, receivedAt);
    if (!window && single === null) unparsed.push({ path, asWritten: f.asWritten });
    return { window, single };
  };
  const from = delivery("deliveryFrom", q.deliveryFrom);
  const to = delivery("deliveryTo", q.deliveryTo);
  let deliveryFrom = from ? (from.window?.from ?? from.single) : null;
  let deliveryTo = to ? (to.window?.to ?? to.single) : null;
  if (from?.window && from.window.from !== from.window.to && !to) deliveryTo = from.window.to;
  if (to?.window && to.window.from !== to.window.to && !from) deliveryFrom = to.window.from;

  const validUntil = parseQuoteDate(q.validUntil.asWritten, receivedAt);
  if (q.validUntil.asWritten !== null && validUntil === null) {
    unparsed.push({ path: "validUntil", asWritten: q.validUntil.asWritten });
  }
  return { validUntil, deliveryFrom, deliveryTo, unparsed };
}

// ---------- normalisation ----------

/** The view of an output with nothing to normalise (not a quote, or no usable output). */
export function emptyNormalisedView(): NormalisedView {
  return {
    vesselId: null,
    portId: null,
    supplierId: null,
    currency: null,
    validUntil: null,
    deliveryFrom: null,
    deliveryTo: null,
    bargeFee: null,
    lines: [],
  };
}

/** The normalised view plus what the checks need from the same reading of the output. */
function normaliseQuote(world: World, doc: ExtractInput, q: QuoteExtraction, receivedAt: Date) {
  const vessel = resolveVessel(world, { name: q.vesselName.value, imo: q.vesselImo.value });
  const port = resolvePort(world, q.port.value);
  const supplier = resolveSupplier(world, doc.sender);
  const currency = readCurrency(q);
  const dates = readDates(q, receivedAt);
  const unitProblems: ReturnType<typeof lineUnitProblems>[] = [];

  // A quantity or price whose unit does not normalise to mt is not a number in mt: null.
  const lines = q.lines.map((l, i) => {
    const problems = lineUnitProblems(l, i);
    unitProblems.push(problems);
    return {
      grade: normaliseGrade(l.grade.value),
      qtyMt: problems.quantity === null ? readAmount(l.quantity) : null,
      pricePerMt: problems.price === null ? readAmount(l.price) : null,
    };
  });

  // Barge fee: not quoted means included (0); a lump sum as is; per mt times the quantity of a
  // single-line quote (on a multi-line quote the total is ambiguous: null).
  const quoted = bargeQuoted(q.bargeFee);
  const barge = quoted ? bargeUnit(q.bargeFee) : { unit: null, problem: null };
  const fee = quoted ? readAmount(q.bargeFee) : null;
  const firstQty = lines[0]?.qtyMt ?? null;
  let bargeFee: number | null = null;
  if (!quoted) bargeFee = 0;
  else if (fee !== null && fee >= 0 && barge.unit === "lump_sum") bargeFee = fee;
  else if (
    fee !== null &&
    fee >= 0 &&
    barge.unit === "per_mt" &&
    lines.length === 1 &&
    firstQty !== null
  ) {
    bargeFee = bargeFeeTotal(fee, "per_mt", firstQty);
  }

  const view: NormalisedView = {
    vesselId: vessel.vessel?.id ?? null,
    portId: port.port?.id ?? null,
    supplierId: supplier.supplier?.id ?? null,
    currency: currency.currency,
    validUntil: dates.validUntil,
    deliveryFrom: dates.deliveryFrom,
    deliveryTo: dates.deliveryTo,
    bargeFee,
    lines,
  };
  return {
    view,
    vessel,
    port,
    supplier,
    currencyFailures: currency.failures,
    unitProblems,
    unparsedDates: dates.unparsed,
    barge: { quoted, unit: barge.unit, unitProblem: barge.problem, fee },
  };
}

/**
 * The extraction mapped to world ids, mt, ISO dates and a barge-fee total, whatever its status.
 * Unresolved or unreadable values are null; the currency is null unless `currency_known` passes.
 * A not-a-quote output gives the all-null view with no lines.
 */
export function normaliseExtraction(
  world: World,
  doc: ExtractInput,
  output: ExtractionOutput,
  receivedAt: Date,
): NormalisedView {
  return output.kind === "quote"
    ? normaliseQuote(world, doc, output, receivedAt).view
    : emptyNormalisedView();
}

// ---------- checks ----------

export interface EvaluationContext {
  /** When the email was received: the reference for dates without a year, and for expiry. */
  receivedAt: Date;
  /** An attachment could not be read, so the document text is incomplete. */
  hasUnreadableAttachment: boolean;
}

export interface NormalisedQuote {
  supplierId: Id;
  portId: Id;
  requirementId: Id;
  currency: Currency;
  bargeFee: number;
  validUntil: IsoDate | null;
  deliveryFrom: IsoDate | null;
  deliveryTo: IsoDate | null;
  lines: { grade: FuelGrade; qtyMt: number; pricePerMt: number }[];
}

export type Evaluation = {
  fieldEvidence: Record<string, string | null>;
  checks: CheckResult[];
  normalised: NormalisedView;
} & (
  | { status: "extracted"; quote: NormalisedQuote }
  | { status: "needs_review" }
  | { status: "not_a_quote" }
);

interface EvidenceItem {
  path: string;
  evidence: string | null;
  /** The text the evidence must contain; null when the field is absent (no check). */
  mustContain: string | null;
  present: boolean;
}

function evidenceItems(q: QuoteExtraction): EvidenceItem[] {
  const text = (path: string, f: { value: string | null; evidence: string | null }) => ({
    path,
    evidence: f.evidence,
    mustContain: f.value,
    present: f.value !== null,
  });
  const written = (
    path: string,
    f: { asWritten: string | null; evidence: string | null; value?: number | null },
  ) => ({
    path,
    evidence: f.evidence,
    mustContain: f.asWritten,
    present: f.asWritten !== null || (f.value ?? null) !== null,
  });
  return [
    text("supplierName", q.supplierName),
    text("vesselName", q.vesselName),
    text("vesselImo", q.vesselImo),
    text("port", q.port),
    written("deliveryFrom", q.deliveryFrom),
    written("deliveryTo", q.deliveryTo),
    written("validUntil", q.validUntil),
    written("bargeFee", q.bargeFee),
    ...q.lines.flatMap((l, i) => [
      text(`lines.${i}.grade`, l.grade),
      written(`lines.${i}.quantity`, l.quantity),
      written(`lines.${i}.price`, l.price),
    ]),
  ];
}

// ---------- quoted threads ----------

/** "-----Original Message-----" and its localized and forwarded forms. */
const ORIGINAL_MESSAGE =
  /^-{2,}\s*(?:original message|forwarded message|ursprüngliche nachricht|weitergeleitete nachricht|message d['’]origine|message transféré|messaggio originale|messaggio inoltrato|mensaje original|mensaje reenviado)\s*-{2,}|^begin forwarded message:/;
const ATTRIBUTION_START = /^(?:on|am|le|il|el)\s/;
/** An attribution's end: "… wrote:", "… schrieb … :", "… a écrit :", "… ha scritto:", "… escribió:". */
const ATTRIBUTION_END = /(?:^|\s)(?:wrote|schrieb|a\s+écrit|ha\s+scritto|escribió)(?:\s.*)?:\s*$/;
/** A "From" header label (English, German, French/Spanish, Danish/Norwegian, Italian, Greek). */
const FROM_HEADER = /^[*_]{0,2}(?:from|von|de|fra|da|από)[*_]{0,2}\s*:[*_]{0,2}\s*(.*)$/;
/** The header lines that follow a From line in a quoted header block, in the same languages. */
const NEXT_HEADER =
  /^[*_]{0,2}(?:sent|date|to|subject|cc|gesendet|datum|an|betreff|envoyé|à|objet|sendt|til|emne|inviato|a|oggetto|enviado|fecha|para|asunto|στάλθηκε|ημερομηνία|προς|θέμα|κοιν)[*_]{0,2}\s*:/;
/** A header block's other lines must come within this many non-empty lines of its From line. */
const HEADER_BLOCK_REACH = 6;
/** The first attachment section parse-email appends; separators are only looked for above it. */
const ATTACHMENT_MARKER = /^--- attachment: .* ---$/m;

/** A From header value that names a sender, not a date ("From: 22 Nov" in a delivery window). */
const namesSender = (value: string) =>
  value !== "" && (value.includes("@") || !mentionsDate(value));

/**
 * The line index where a quoted older message starts, or -1. Separators: an original-message or
 * forwarded-message line (localized), an attribution ("On … wrote:", "Am … schrieb …:", "Le … a
 * écrit :", "Il … ha scritto:", "El … escribió:", also wrapped over two lines), a From header line
 * (localized, bold markers allowed) naming a sender with another header line within the next 6
 * non-empty lines, or two or more consecutive lines starting with ">".
 */
function firstSeparatorLine(lines: string[]): number {
  const folded = lines.map((l) => l.trim().toLowerCase());
  const nonEmptyAfter = (i: number, n: number) =>
    folded
      .slice(i + 1)
      .filter((l) => l !== "")
      .slice(0, n);
  for (const [i, l] of folded.entries()) {
    if (ORIGINAL_MESSAGE.test(l)) return i;
    if (ATTRIBUTION_START.test(l)) {
      if (ATTRIBUTION_END.test(l)) return i;
      const next = folded[i + 1];
      if (next !== undefined && ATTRIBUTION_END.test(next)) return i;
    }
    const from = FROM_HEADER.exec(l);
    if (from && namesSender(from[1] ?? "")) {
      if (nonEmptyAfter(i, HEADER_BLOCK_REACH).some((x) => NEXT_HEADER.test(x))) return i;
    }
    if (l.startsWith(">") && folded[i + 1]?.startsWith(">")) return i;
  }
  return -1;
}

/**
 * The source split at the first reply or forward separator in the body above any attachment
 * section: the quoted thread is the body from the separator to the first attachment; the newest
 * message is the rest (the From and Subject lines, the body above the separator, and the
 * attachments, which the newest email carries). Null when there is no separator.
 */
function threadSplit(doc: ExtractInput): { newest: string; quoted: string } | null {
  const body = doc.bodyText;
  const marker = body.search(ATTACHMENT_MARKER);
  const text = marker === -1 ? body : body.slice(0, marker);
  const lines = text.split("\n");
  const line = firstSeparatorLine(lines);
  if (line === -1) return null;
  const at = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const end = marker === -1 ? body.length : marker;
  const source = sourceText(doc);
  const offset = source.length - body.length;
  return {
    newest: source.slice(0, offset + at) + source.slice(offset + end),
    quoted: source.slice(offset + at, offset + end),
  };
}

/**
 * A price in the text: a currency next to a number ("USD 738", "USD738/mt", "US$738", "€690",
 * "690 EUR", "USD/MT 738", "USD/mt: 738"), or a number per mt ("738 pmt", "738 per mt", "738/mt").
 */
const PRICE_IN_TEXT =
  /(?:\b(?:usd|eur)|us\$|\$|€)(?:\s*\/\s*(?:mt|t|tons?|tonnes?|metric tons?)\b)?[\s.:-]*\d|\d\s*(?:(?:usd|eur|euros?|dollars?)\b|\$|€)|\d\s*(?:pmt|per\s+mt|\/\s*mt)\b/i;

/** The evidence of every price, quantity, validity and delivery date the output states. */
function offerEvidence(q: QuoteExtraction): [string, string][] {
  const all: [string, string | null][] = [
    ["validUntil", q.validUntil.evidence],
    ["deliveryFrom", q.deliveryFrom.evidence],
    ["deliveryTo", q.deliveryTo.evidence],
    ...q.lines.flatMap((l, i): [string, string | null][] => [
      [`lines.${i}.quantity`, l.quantity.evidence],
      [`lines.${i}.price`, l.price.evidence],
    ]),
  ];
  return all.filter((e): e is [string, string] => e[1] !== null && foldText(e[1]) !== "");
}

/**
 * newest_offer_only (R22): in a reply or forward whose newest message itself names a price, an
 * offer value whose evidence occurs only in the quoted thread below is a stale value.
 */
function newestOfferCheck(doc: ExtractInput, q: QuoteExtraction): CheckResult {
  const thread = threadSplit(doc);
  if (thread === null) return check("newest_offer_only", [], "no quoted thread");
  if (!PRICE_IN_TEXT.test(thread.newest)) {
    return check(
      "newest_offer_only",
      [],
      "the newest message names no price; the quoted offer is the only one",
    );
  }
  const newest = foldText(thread.newest);
  const quoted = foldText(thread.quoted);
  const stale = offerEvidence(q)
    .filter(([, ev]) => !newest.includes(foldText(ev)) && quoted.includes(foldText(ev)))
    .map(([path]) => path);
  return check(
    "newest_offer_only",
    stale.length === 0
      ? []
      : [
          `Evidence for ${stale.join(", ")} is only in the quoted older message, below the newest offer.`,
        ],
  );
}

const attachmentCheck = (ctx: EvaluationContext): CheckResult =>
  check(
    "attachment_text_found",
    ctx.hasUnreadableAttachment
      ? ["An attachment could not be read, so the document was not fully checked."]
      : [],
  );

/**
 * Runs every check on one extraction. The status is `extracted` (quote) or `not_a_quote` only
 * when all of them pass, `needs_review` otherwise; the normalised view is returned either way.
 */
export function evaluateExtraction(
  world: World,
  doc: ExtractInput,
  output: ExtractionOutput,
  ctx: EvaluationContext,
): Evaluation {
  const source = sourceText(doc);
  if (output.kind === "not_a_quote") {
    // An unverifiable "not a quote", or one over unreadable content, could hide a real offer.
    const found = evidenceSupports(source, output.evidence, null);
    const checks = [
      check("evidence_found:notAQuote", found ? [] : ["Evidence not found in the email."]),
      attachmentCheck(ctx),
    ];
    return {
      status: allPassed(checks) ? "not_a_quote" : "needs_review",
      fieldEvidence: { notAQuote: output.evidence },
      checks,
      normalised: emptyNormalisedView(),
    };
  }

  const n = normaliseQuote(world, doc, output, ctx.receivedAt);
  const { view } = n;
  const lines = output.lines;
  const vessel = n.vessel.vessel;

  const items = evidenceItems(output);
  const fieldEvidence = Object.fromEntries(items.map((i) => [i.path, i.evidence]));
  const checks: CheckResult[] = items
    .filter((i) => i.present)
    .map((i) =>
      check(
        `evidence_found:${i.path}`,
        evidenceSupports(source, i.evidence, i.mustContain)
          ? []
          : [`Evidence for ${i.path} is missing, not verbatim in the email, or lacks the value.`],
      ),
    );

  checks.push(check("currency_known", n.currencyFailures));

  // unit_known: quantities in mass, prices per mt, a quoted barge fee per mt or a lump sum.
  checks.push(
    check("unit_known", [
      ...n.unitProblems.flatMap((p) => [p.quantity, p.price].filter((x) => x !== null)),
      ...(n.barge.unitProblem ? [n.barge.unitProblem] : []),
    ]),
  );

  // grade_known: every line's grade recognised, no grade twice.
  const grades = view.lines.map((l) => l.grade);
  const gradeFailures = grades.flatMap((g, i) =>
    g === null ? [`Grade "${lines[i]?.grade.value ?? ""}" of line ${i} is not recognised.`] : [],
  );
  const recognised = grades.filter((g): g is FuelGrade => g !== null);
  if (new Set(recognised).size < recognised.length) {
    gradeFailures.push("A grade appears on more than one line.");
  }
  checks.push(check("grade_known", gradeFailures));

  // quantity_unambiguous: a single number, as written, greater than zero, and not a range or
  // approximation on its source line ("280" from "280/320 mt", "300 mt" from "abt 300 mt").
  checks.push(
    check(
      "quantity_unambiguous",
      lines.flatMap((l, i) => {
        const q = readAmount(l.quantity);
        if (q === null || q <= 0) {
          return [
            `Quantity of line ${i} is not a single amount ("${l.quantity.asWritten ?? ""}").`,
          ];
        }
        return hedgedInSource(source, l.quantity.evidence, l.quantity.asWritten)
          ? [`Quantity of line ${i} is a range or approximation on its source line.`]
          : [];
      }),
    ),
  );

  // amounts_parsed: prices and a quoted barge fee parse from the as-written text to the value.
  const prices = lines.map((l) => readAmount(l.price));
  const amountFailures = prices.flatMap((p, i) => {
    const price = lines[i]?.price;
    if (p === null || p <= 0)
      return [`Price of line ${i} does not read as "${price?.asWritten ?? ""}".`];
    return price && hedgedInSource(source, price.evidence, price.asWritten)
      ? [`Price of line ${i} is a range or approximation on its source line.`]
      : [];
  });
  if (n.barge.quoted) {
    if (n.barge.fee === null || n.barge.fee < 0) {
      amountFailures.push(`Barge fee does not read as "${output.bargeFee.asWritten ?? ""}".`);
    } else if (n.barge.unit === "per_mt" && lines.length > 1) {
      amountFailures.push("per-mt barge fee on a multi-grade quote: total is ambiguous");
    } else if (n.barge.unit === "per_mt" && view.lines[0]?.qtyMt == null) {
      amountFailures.push("Barge fee is per mt, but the first line's quantity in mt is not known.");
    }
  } else if (bargeChargeWritten(source)) {
    // Absent means included only when the email names no barge charge the model left out.
    amountFailures.push("a barge charge is written in the email but was not transcribed");
  }
  checks.push(
    check(
      "amounts_parsed",
      amountFailures,
      n.barge.quoted ? null : "barge fee not quoted; treated as included",
    ),
  );

  // dates_parsed: every date written in the quote reads as a date.
  checks.push(
    check(
      "dates_parsed",
      n.unparsedDates.map((d) => `${d.path} "${d.asWritten}" does not read as a date.`),
    ),
  );

  // Ruling A: an email that names any date must have its validity and both ends of its delivery
  // window determined (non-null after normalisation), or a human confirms them. Absent passes
  // only for an email with no date at all (the demo inbox emails). The word-list detectors add
  // the more specific reason when a validity or delivery date is written but was left out.
  const datesInEmail = namesADate(source);

  // validity_not_expired: determined (above), valid until the received day or later, and not
  // implausibly far ahead (a date with no year that resolved into the wrong year).
  const today = isoDayAfter(ctx.receivedAt, 0);
  const validityStated = output.validUntil.asWritten !== null;
  const validityFailures: string[] = [];
  if (view.validUntil === null) {
    if (datesInEmail) {
      const omitted = !validityStated && dateWrittenWith(source, VALIDITY_WORD);
      validityFailures.push(
        omitted
          ? `${NO_VALIDITY} (a validity is written in the email but was not transcribed)`
          : NO_VALIDITY,
      );
    }
  } else if (view.validUntil < today) {
    validityFailures.push(
      `The quote expired on ${view.validUntil}, before it was received on ${today}.`,
    );
  } else if (
    view.validUntil !== null &&
    view.validUntil > isoDayAfter(ctx.receivedAt, VALIDITY_MAX_DAYS_AHEAD)
  ) {
    validityFailures.push(`Validity ${view.validUntil} is ${FAR_AHEAD}.`);
  }
  checks.push(
    check(
      "validity_not_expired",
      validityFailures,
      !validityStated
        ? "no validity stated; the email names no date"
        : view.validUntil === null
          ? "not checked: the validity does not read as a date"
          : null,
    ),
  );

  // delivery_window_valid: both ends determined (ruling A, above); a start that is not an end
  // ("by 20 Nov"); and once the stated dates parse, the window ends no earlier than it starts,
  // starts no more than a day before the received day (a wrong year), ends not before the
  // received day and not implausibly far ahead. An unparsed date also fails dates_parsed.
  const deliveryStated =
    output.deliveryFrom.asWritten !== null || output.deliveryTo.asWritten !== null;
  const deliveryUnparsed = n.unparsedDates.some((d) => d.path !== "validUntil");
  const { deliveryFrom: from, deliveryTo: to } = view;
  const windowFailures: string[] = [];
  if ((from === null || to === null) && datesInEmail) {
    const omitted = !deliveryStated && dateWrittenWith(source, DELIVERY_WORD);
    windowFailures.push(
      omitted
        ? `${NO_WINDOW} (a delivery date is written in the email but was not transcribed)`
        : NO_WINDOW,
    );
  }
  const startWritten = output.deliveryFrom.asWritten;
  if (startWritten !== null && END_DATE_WORDS.test(foldText(startWritten))) {
    windowFailures.push(`an end date was transcribed as the start ("${startWritten}").`);
  }
  if (deliveryStated && !deliveryUnparsed) {
    if (from !== null && to !== null && to < from) {
      windowFailures.push(`The delivery window ends (${to}) before it starts (${from}).`);
    }
    if (from !== null && from < isoDayAfter(ctx.receivedAt, -1)) {
      windowFailures.push(
        `The delivery window starts on ${from}, more than a day before receipt on ${today} — check the year.`,
      );
    }
    const windowEnd = to ?? from;
    if (windowEnd !== null && windowEnd < today) {
      windowFailures.push(`The delivery window ends on ${windowEnd}, before receipt on ${today}.`);
    } else if (
      windowEnd !== null &&
      windowEnd > isoDayAfter(ctx.receivedAt, DELIVERY_MAX_DAYS_AHEAD)
    ) {
      windowFailures.push(`The delivery window ends on ${windowEnd}, ${FAR_AHEAD}.`);
    }
  }
  checks.push(
    check(
      "delivery_window_valid",
      windowFailures,
      !deliveryStated
        ? "no delivery window stated; the email names no date"
        : deliveryUnparsed
          ? "not checked: a delivery date does not read as a date"
          : from === null || to === null
            ? "only one end of the delivery window is stated; the email names no other date"
            : null,
    ),
  );

  checks.push(newestOfferCheck(doc, output));

  checks.push(check("vessel_resolved", n.vessel.detail ? [n.vessel.detail] : []));
  checks.push(check("port_resolved", n.port.detail ? [n.port.detail] : []));
  checks.push(check("supplier_resolved", n.supplier.detail ? [n.supplier.detail] : []));

  // supplier_name_matches: a name that names a known supplier must name the sender domain's.
  const writtenName = output.supplierName.value;
  const named = resolveSupplierName(world, writtenName);
  const bySender = n.supplier.supplier;
  const nameFailures =
    named === null || named.id === bySender?.id
      ? []
      : [
          bySender
            ? `Supplier name "${writtenName}" names ${named.name}, but the sender domain is ${bySender.name}'s.`
            : `Supplier name "${writtenName}" names ${named.name}, but the sender domain is not a known supplier.`,
        ];
  checks.push(
    check(
      "supplier_name_matches",
      nameFailures,
      writtenName === null
        ? "no supplier name stated"
        : named === null
          ? `Supplier name "${writtenName}" names no known supplier; the sender domain decides.`
          : null,
    ),
  );

  // price_within_band: ±15 % of the port's latest market price for the grade.
  const port = n.port.port;
  checks.push(
    check(
      "price_within_band",
      lines.flatMap((_, i) => {
        const grade = grades[i];
        const price = prices[i];
        if (!port || !grade || price == null || !view.currency) {
          return [`Line ${i} not checked: needs a resolved port, grade, price and currency.`];
        }
        const band = checkPriceBand(world, port.id, grade, price, view.currency);
        return band.passed ? [] : [band.detail ?? `Line ${i} price is outside the band.`];
      }),
    ),
  );

  // quantity_within_tank_capacity: each line's mt fits the vessel's tanks for its grade. Lines
  // without a vessel, grade or mt quantity are left to the checks that already fail for them.
  const tankFailures: string[] = [];
  const tankUnchecked: number[] = [];
  view.lines.forEach((l, i) => {
    if (!vessel || l.grade === null || l.qtyMt === null) {
      tankUnchecked.push(i);
      return;
    }
    const capacity = vessel.tankCapacityMt[l.grade];
    if (l.qtyMt > capacity) {
      tankFailures.push(
        `Line ${i}: ${l.qtyMt} mt ${l.grade} exceeds ${vessel.name}'s ${l.grade} tank capacity of ${capacity} mt.`,
      );
    }
  });
  checks.push(
    check(
      "quantity_within_tank_capacity",
      tankFailures,
      tankUnchecked.length > 0
        ? `not checked for line ${tankUnchecked.join(", ")}: needs a resolved vessel, grade and quantity in mt`
        : null,
    ),
  );

  // requirement_found: some line's grade has an open requirement on the vessel's current voyage;
  // the quote links the requirement of the first such line.
  const voyage = vessel ? currentVoyage(world, vessel.id) : null;
  const requirementOf = (g: FuelGrade | null) =>
    voyage && g ? (openRequirements(world, voyage.id, g)[0] ?? null) : null;
  const requirement = grades.map(requirementOf).find((r) => r !== null) ?? null;
  const distinct = [...new Set(recognised)];
  const unrequired = distinct.filter((g) => requirementOf(g) === null);
  checks.push(
    check(
      "requirement_found",
      requirement !== null
        ? []
        : [
            !vessel
              ? "Not checked: needs a resolved vessel."
              : !voyage
                ? `${vessel.name} has no current voyage.`
                : distinct.length === 0
                  ? "Not checked: needs a recognised grade."
                  : `No open ${distinct.join("/")} requirement on ${vessel.name}'s current voyage.`,
          ],
      requirement !== null && unrequired.length > 0
        ? `Linked to the ${requirement.grade} requirement; no open ${unrequired.join("/")} requirement.`
        : null,
    ),
  );

  checks.push(attachmentCheck(ctx));

  if (!allPassed(checks))
    return { status: "needs_review", fieldEvidence, checks, normalised: view };
  return {
    status: "extracted",
    fieldEvidence,
    checks,
    normalised: view,
    quote: quoteFrom(view, requirement?.id ?? null),
  };
}

/**
 * The stored quote, from a view whose checks all passed. A null here means a check that should
 * have failed did not: a bug, so it throws rather than store a partial quote.
 */
function quoteFrom(view: NormalisedView, requirementId: Id | null): NormalisedQuote {
  const need = <T>(v: T | null, what: string): T => {
    if (v === null) throw new Error(`evaluateExtraction: all checks passed but ${what} is null`);
    return v;
  };
  return {
    supplierId: need(view.supplierId, "supplierId"),
    portId: need(view.portId, "portId"),
    requirementId: need(requirementId, "requirementId"),
    currency: need(view.currency, "currency"),
    bargeFee: need(view.bargeFee, "bargeFee"),
    validUntil: view.validUntil,
    deliveryFrom: view.deliveryFrom,
    deliveryTo: view.deliveryTo,
    lines: view.lines.map((l, i) => ({
      grade: need(l.grade, `lines.${i}.grade`),
      qtyMt: need(l.qtyMt, `lines.${i}.qtyMt`),
      pricePerMt: need(l.pricePerMt, `lines.${i}.pricePerMt`),
    })),
  };
}
