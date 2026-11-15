import type { Currency, FuelGrade } from "@pharos/shared";
import { mentionsDate } from "./dates.js";

/**
 * Pure normalisers: as-written email values -> structured quote fields.
 * Every function returns null on unrecognised or ambiguous text (never throws);
 * null means "needs human review", not "zero".
 */

const clean = (raw: string | null | undefined): string =>
  typeof raw === "string" ? raw.trim().toLowerCase().replace(/\s+/g, " ") : "";

/**
 * A hedge marker in an as-written amount: an approximation, a limit or a tolerance, so the text
 * is not one amount ("min 100 mt", "up to 100 mt", "+/- 100 mt", "around USD 683 per mt").
 * Words are whole words: "Maxwell" holds no "max", "best" no "est".
 */
const HEDGE_IN_AMOUNT =
  /\b(?:min|minimum|max|maximum|up\s+to|upto|at\s+least|not\s+exceeding|around|roughly|approx\w*|appr|aprox\w*|circa|ca|est|estimated|indicative(?:ly)?|or\s+thereabouts|moloo|more\s+or\s+less|plus\/minus|plus\s+or\s+minus)(?![a-z])|\bc\.|±|\+\/-|\+-|≈|~|\d\s*\+(?![\d/-])/;

/**
 * First number in the string. Null for ranges/alternatives, approximations, limits and
 * tolerances anywhere in the text, and ambiguous decimal-comma or space-grouped forms.
 */
export function parseAmount(asWritten: string): number | null {
  const s = clean(asWritten);
  if (s === "") return null;
  if (/\b(?:abt|about)\b\.?/.test(s) || HEDGE_IN_AMOUNT.test(s)) return null;
  if (/\d\s*(?:\/|-|–|—|to|or|and)\s*\d/.test(s)) return null;
  const m = /\d[\d,]*(?:\.\d+)?/.exec(s);
  if (!m) return null;
  // Leading "." or "-" ("$.50", "-300") is malformed or signed: review.
  if (/[.\-−]/.test(s[m.index - 1] ?? "")) return null;
  const token = m[0].replace(/,+$/, "");
  if (!/^\d+(?:\.\d+)?$/.test(token) && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) return null;
  // Dot-grouped thousands ("9.000", "1.234") read as decimals would be a x1000 error.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) return null;
  const rest = s.slice(m.index + m[0].length);
  // "1 234,5" / "1 234": space-grouped; "1.234,5" / "1.234.567": dot-grouped.
  if (/^[  ]\d{3}(?!\d)/.test(rest) || /^[,.]\d/.test(rest)) return null;
  // A second number after a connector (currency/unit words allowed between): range or alternative.
  if (/(?:-|–|—|\/|\b(?:up to|to|or|and)\b)\s*[^\d\-–—/]{0,12}?\d/.test(rest)) return null;
  const value = Number(token.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

const USD = new Set(["usd", "us$", "$", "us dollar", "us dollars", "u.s. dollar", "u.s. dollars"]);
const EUR = new Set(["eur", "€", "euro", "euros"]);

export function normaliseCurrency(raw: string | null): Currency | null {
  const s = clean(raw);
  if (USD.has(s)) return "USD";
  if (EUR.has(s)) return "EUR";
  return null;
}

const MASS = new Set([
  "mt",
  "mts",
  "t",
  "tonne",
  "tonnes",
  "metric ton",
  "metric tons",
  "metric tonne",
  "metric tonnes",
]);

/** Volume units (m3, cbm, litres) need a density and are deliberately null. */
export function normaliseMassUnit(raw: string | null): "mt" | null {
  return MASS.has(clean(raw)) ? "mt" : null;
}

const PER_MT = new Set(["mt", "pmt", "per mt", "/mt", "per metric ton", "per metric tonne"]);
const LUMP = new Set(["lump sum", "lumpsum", "ls"]);

export function normalisePerUnit(raw: string | null): "per_mt" | "lump_sum" | null {
  // "USD/MT", "US$ pmt", "EUR per mt": the currency is checked on its own field.
  const s = clean(raw).replace(/^(?:usd|us\$|\$|eur|€)\s*(?=\/|p|l)/, "");
  if (PER_MT.has(s)) return "per_mt";
  if (LUMP.has(s)) return "lump_sum";
  return null;
}

// Grade families. Sulphur limits: LSMGO/DMA 0.1%, VLSFO 0.5%, HSFO 3.5% (ISO 8217 / MARPOL VI).
const GRADE_PATTERNS: [FuelGrade, RegExp][] = [
  ["LSMGO", /\b(?:ls)?mgo\b|\bdma\b(?=.*(?<!\d)0\.1(?!\d))|(?<!\d)0\.1(?!\d).*\bdma\b/],
  ["VLSFO", /\bvlsfo\b|(?<!\d)0\.50?(?!\d)\s*%/],
  ["HSFO", /\bhsfo\b|\bifo\s*380\b|\brmg\s*380\b|(?<!\d)3\.50?(?!\d)\s*%/],
];

export function normaliseGrade(raw: string | null): FuelGrade | null {
  const s = clean(raw);
  if (s === "") return null;
  const hits = GRADE_PATTERNS.filter(([, re]) => re.test(s)).map(([g]) => g);
  return hits.length === 1 ? (hits[0] as FuelGrade) : null;
}

const collapse = (x: string): string => x.replace(/\s+/g, " ").trim().toLowerCase();

const isAlnum = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && /\d/.test(c);

/**
 * True when `needle` occurs in `haystack` on a token boundary. The boundary rule applies at an
 * alphanumeric edge of the needle ("30" is not in "300"; "$738" is in "US$738"). A match that
 * continues a number is also rejected: followed by [.,]digit or preceded by digit[.,]
 * ("738" is not in "738.50", "500" is not in "2,500"). Every occurrence is tried.
 */
function containsToken(haystack: string, needle: string): boolean {
  return tokenOccurrences(haystack, needle).length > 0;
}

/** Start index of every occurrence of `needle` in `haystack` on a token boundary (as above). */
function tokenOccurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    const before = haystack[at - 1];
    const after = haystack[end];
    if (isAlnum(needle[0]) && isAlnum(before)) continue;
    if (isAlnum(needle[needle.length - 1]) && isAlnum(after)) continue;
    if (/[.,]/.test(after ?? "") && isDigit(haystack[end + 1])) continue;
    if (/[.,]/.test(before ?? "") && isDigit(haystack[at - 2])) continue;
    found.push(at);
  }
  return found;
}

// ---------- ranges and approximations around an amount ----------

const MASS_RE = String.raw`(?:metric\s+tonnes?|metric\s+tons?|tonnes?|tons?|mts?|t|m3|cbm)\b`;
const PER = String.raw`(?:pmt|p/mt|per\s+(?:metric\s+)?(?:mt|tonnes?|tons?)\b|/\s*(?:mt|t|tonnes?|tons?)\b)`;
const CUR = String.raw`(?:usd|eur|us\$|\$|€)`;
const NUM = String.raw`\d[\d,.]*`;
const RANGE_JOIN = String.raw`(?:/|-|–|—|\bto\b|\bor\b)`;

/** What an amount is: a quantity, a price, a bare number (either), or not an amount of ours. */
export type AmountKind = "quantity" | "price";
type Kind = AmountKind | "bare" | "other";

const PER_START = new RegExp(String.raw`^\s*${PER}`);
const MASS_START = new RegExp(String.raw`^\s*${MASS_RE}`);
const DURATION_START = /^\s*(?:days?|hrs?|hours?|mins?|minutes?|weeks?|%|pct|percent)\b/;

/** The kind of an amount from its text: a currency or per-unit is a price, a mass unit a quantity. */
function kindOfText(text: string): Kind {
  if (new RegExp(CUR).test(text) || new RegExp(PER).test(text)) return "price";
  if (new RegExp(`(?<![a-z])${MASS_RE}`).test(text)) return "quantity";
  return "bare";
}

/** The kind of the other amount of a would-be range: its currency, then what follows its number. */
function kindOfOther(currency: boolean, num: string, tail: string): Kind {
  if (mentionsDate(`${num}${tail.slice(0, 12)}`) || DURATION_START.test(tail)) return "other";
  if (currency || PER_START.test(tail)) return "price";
  if (MASS_START.test(tail)) return "quantity";
  return "bare";
}

/** Two amounts form a range only when they are of the same kind ("100 mt / USD 683" is not one). */
const sameKind = (ours: Kind, other: Kind) =>
  other !== "other" && (ours === "bare" || other === "bare" || ours === other);

/**
 * Qualifies the amount right after it: it must end at most 8 characters before the number or
 * its currency, with no digit between (a field label in between does not count: "Approximate
 * quantity: 300 mt", "Min. quantity: 300 mt").
 */
const BEFORE_MARKER =
  /\b(?:about|abt|approx\w*|appr|aprox\w*|around|roughly|circa|ca|minimum|maximum|min|max|at\s+least|up\s+to|upto|not\s+exceeding|moloo|more\s+or\s+less|between|some|est|estimated|indicative(?:ly)?)(?![a-z])\.?|\bc\.|~|≈|±|\+\/-|\+-|plus\/minus|plus\s+or\s+minus/g;
const BEFORE_MARKER_REACH = 8;
const FIELD_LABEL = /\b(?:quantity|qty|price|amount)\b/g;
/** Another amount joined to it from before: "280/", "280 - ", "100 mt or ", "USD 683 / ". */
const BEFORE_RANGE = new RegExp(
  String.raw`(?:(${CUR})\s*)?(${NUM})\s*(${MASS_RE}|${PER})?\.?\s*${RANGE_JOIN}\s*(?:${CUR})?\s*$`,
);
const BETWEEN = new RegExp(
  String.raw`\bbetween\s+(?:(${CUR})\s*)?(${NUM})\s*(${MASS_RE}|${PER})?\s*and\s*(?:${CUR})?\s*$`,
);
/** Another amount joined to it from after: "/320", " - 150 mt", " to 320", " or USD 690". */
const AFTER_RANGE = new RegExp(
  String.raw`^\s*(?:${MASS_RE}|${PER})?\.?\s*${RANGE_JOIN}\s*(${CUR})?\s*(${NUM})(.*)$`,
);
/**
 * A marker right after the amount and its unit: "100 mt approx.", "300 mt (abt)", "300 mt or
 * thereabouts"; min/max only at the end of the clause ("100 mt max", not "100 mt max tank
 * capacity" or "100 mt min. lifting 50 mt").
 */
const AFTER_MARKER = new RegExp(
  String.raw`^\s*(?:\+(?![\d/-])|(?:${MASS_RE}|${PER})?\.?\s*(?:\+(?![\d/-])|(?:\(\s*)?(?:approx\w*|appr|aprox\w*|abt|about|circa|ca|est|moloo|more\s+or\s+less|or\s+thereabouts)(?![a-z])|\bc\.|(?:minimum|maximum|min|max)\.?(?=\s*(?:$|[,;:)(/]|and\b|or\b))))`,
);
/** A tolerance starting within 12 characters after the amount. */
const AFTER_TOLERANCE =
  /±|\+\/-|\+-|plus\/minus|plus\s+or\s+minus|more\s+or\s+less|\bmoloo\b|or\s+thereabouts/;
const AFTER_TOLERANCE_REACH = 12;
/** A parenthesis right after the amount that holds a tolerance: "(Seller's option +/- 5%)". */
const AFTER_PAREN = new RegExp(
  String.raw`^\s*(?:${MASS_RE}|${PER})?\.?\s*\([^)]*(?:±|\+/-|\+-|plus/minus|more\s+or\s+less|\bmoloo\b|\babt\b|\bapprox)[^)]*\)`,
);

/**
 * Is the amount at [at, end) of the folded line a range or an approximation? `above` is the
 * line above, read for a marker on a label when the amount opens its line.
 */
function hedgedAt(line: string, at: number, end: number, ours: Kind, above: string): boolean {
  const own = line.slice(0, at);
  const before = own.trim() === "" && above !== "" ? `${above} ` : own;
  const after = line.slice(end);
  const markerTouches = [...before.matchAll(BEFORE_MARKER)].some((m) => {
    const gap = before.slice(m.index + m[0].length).replace(FIELD_LABEL, "");
    return gap.length <= BEFORE_MARKER_REACH && !/\d/.test(gap);
  });
  const rangedBefore = [BEFORE_RANGE.exec(own), BETWEEN.exec(own)].some(
    (m) => m !== null && sameKind(ours, kindOfOther(m[1] !== undefined, m[2] ?? "", m[3] ?? "")),
  );
  const a = AFTER_RANGE.exec(after);
  const rangedAfter =
    a !== null && sameKind(ours, kindOfOther(a[1] !== undefined, a[2] ?? "", a[3] ?? ""));
  const tolerance = AFTER_TOLERANCE.exec(after);
  return (
    markerTouches ||
    rangedBefore ||
    rangedAfter ||
    AFTER_MARKER.test(after) ||
    AFTER_PAREN.test(after) ||
    (tolerance !== null && tolerance.index < AFTER_TOLERANCE_REACH)
  );
}

/**
 * The folded source lines each occurrence of the evidence touches (every line of an evidence that
 * spans lines), with the evidence's span inside them and the line above them. The folded
 * evidence itself when the source does not hold it.
 */
function evidenceContexts(
  source: string,
  ev: string,
): { text: string; from: number; to: number; above: string }[] {
  const lines = source
    .split(/\r?\n/)
    .map(collapse)
    .filter((l) => l !== "");
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }
  const joined = lines.join(" ");
  const lineAt = (offset: number) => starts.findLastIndex((s) => s <= offset);
  const found: { text: string; from: number; to: number; above: string }[] = [];
  for (let at = joined.indexOf(ev); at !== -1; at = joined.indexOf(ev, at + 1)) {
    const end = at + ev.length;
    const first = lineAt(at);
    const lo = starts[first] ?? 0;
    const last = lineAt(end - 1);
    const hi = (starts[last] ?? 0) + (lines[last]?.length ?? 0);
    found.push({
      text: joined.slice(lo, hi),
      from: at - lo,
      to: end - lo,
      above: lines[first - 1] ?? "",
    });
  }
  return found.length > 0 ? found : [{ text: ev, from: 0, to: ev.length, above: "" }];
}

/**
 * True when the source line(s) holding the evidence show the as-written amount as a range or an
 * approximation: "280" from "280/320 mt", "100 mt" from "abt 100 mt", "USD 683 per mt" from
 * "USD 683 per mt or USD 690 per mt". The whole line is read, not the model's span, so a
 * shortened evidence ("100 mt") cannot hide the marker. Markers must touch the amount: one before
 * it within 8 characters of the number or its currency (a field label between allowed, and on
 * the label line above when the amount opens its line), another amount of the same kind joined by
 * / - – to or ("100 mt / USD 683 pmt" and "USD 683 - 30 days" are field separators), a marker
 * right after the amount and its unit, a tolerance within 12 characters after, or a tolerance in
 * a parenthesis right after. `kind` is the field (quantity or price); without it the as-written
 * text decides. Case- and whitespace-folded; the amount is matched on token boundaries.
 */
export function hedgedInSource(
  source: string,
  evidence: string | null,
  asWritten: string | null,
  kind?: AmountKind,
): boolean {
  if (evidence === null || asWritten === null) return false;
  const ev = collapse(evidence);
  const value = collapse(asWritten);
  if (ev === "" || value === "") return false;
  const ours: Kind = kindOfText(value) === "bare" ? (kind ?? "bare") : kindOfText(value);
  return evidenceContexts(source, ev).some(({ text, from, to, above }) => {
    const all = tokenOccurrences(text, value);
    // The amount the evidence points at; any on its lines when the evidence does not hold it.
    const inside = all.filter((at) => at < to && at + value.length > from);
    return (inside.length > 0 ? inside : all).some((at) =>
      hedgedAt(text, at, at + value.length, ours, at === 0 ? above : ""),
    );
  });
}

/**
 * Evidence must appear in the source, and the as-written value must appear in the evidence on
 * token boundaries (case- and whitespace-folded).
 */
export function evidenceSupports(
  source: string,
  evidence: string | null,
  asWritten: string | null,
): boolean {
  if (evidence === null) return false;
  const ev = collapse(evidence);
  if (ev === "") return false;
  if (!collapse(source).includes(ev)) return false;
  if (asWritten === null) return true;
  const value = collapse(asWritten);
  if (value === "") return false;
  return containsToken(ev, value);
}
