import type { Currency, FuelGrade } from "@pharos/shared";

/**
 * Pure normalisers: as-written email values -> structured quote fields.
 * Every function returns null on unrecognised or ambiguous text (never throws);
 * null means "needs human review", not "zero".
 */

const clean = (raw: string | null | undefined): string =>
  typeof raw === "string" ? raw.trim().toLowerCase().replace(/\s+/g, " ") : "";

/**
 * First number in the string. Null for ranges/alternatives, approximations,
 * and ambiguous decimal-comma or space-grouped forms.
 */
export function parseAmount(asWritten: string): number | null {
  const s = clean(asWritten);
  if (s === "") return null;
  if (/\b(?:abt|about|approx\w*|circa|ca)\b\.?|~/.test(s)) return null;
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
  const s = clean(raw);
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

const UNIT = String.raw`(?:metric\s+tonnes?|metric\s+tons?|tonnes?|tons?|mts?|t|m3|cbm|pmt|per\s+mt|/\s*mt)`;
const CUR = String.raw`(?:usd|eur|us\$|\$|€)`;
const NUM = String.raw`\d[\d,.]*`;

/** Qualifies the amount right after it (ending at most 8 characters before it, no digit between). */
const BEFORE_MARKER =
  /\b(?:about|abt|approx(?:imately)?|around|roughly|circa|minimum|maximum|min|max|at least|up to|moloo|more or less|between)(?![a-z])\.?|\b(?:ca|c)\.|~|≈/g;
const BEFORE_MARKER_REACH = 8;
/** Another amount joined to it from before: "280/", "280 - ", "280 to ", "100 mt or ", "between 100 and ". */
const BEFORE_RANGE = new RegExp(
  String.raw`(?:${NUM}\s*${UNIT}?\s*(?:/|-|–|—|\bto\b|\bor\b)|\bbetween\s+${CUR}?\s*${NUM}\s*${UNIT}?\s*and)\s*${CUR}?\s*$`,
);
/** Another amount joined to it from after: "/320", " - 150 mt", " to 320", " or USD 690". */
const AFTER_RANGE = new RegExp(String.raw`^\s*${UNIT}?\.?\s*(?:/|-|–|—|to|or)\s*${CUR}?\s*\d`);
/** A marker right after the amount and its unit: "100 mt approx.", "100 mt max", "100 mt (abt)". */
const AFTER_MARKER = new RegExp(
  String.raw`^\s*${UNIT}?\.?\s*(?:(?:\(\s*)?(?:approx(?:imately)?|abt|about|circa|ca\.|c\.|moloo|more or less)|minimum|maximum|min|max)(?![a-z])`,
);
/** A tolerance starting within 12 characters after the amount: ±, +/-, +-, plus/minus, more or less. */
const AFTER_TOLERANCE = /±|\+\/-|\+-|plus\/minus|plus or minus|more or less|\bmoloo\b/;
const AFTER_TOLERANCE_REACH = 12;

/** Is the amount at [at, end) of the folded line a range or an approximation? */
function hedgedAt(line: string, at: number, end: number): boolean {
  const before = line.slice(0, at);
  const after = line.slice(end);
  const markerTouches = [...before.matchAll(BEFORE_MARKER)].some((m) => {
    const gap = before.slice(m.index + m[0].length);
    return gap.length <= BEFORE_MARKER_REACH && !/\d/.test(gap);
  });
  const tolerance = AFTER_TOLERANCE.exec(after);
  return (
    markerTouches ||
    BEFORE_RANGE.test(before) ||
    AFTER_RANGE.test(after) ||
    AFTER_MARKER.test(after) ||
    (tolerance !== null && tolerance.index < AFTER_TOLERANCE_REACH)
  );
}

/**
 * The folded source lines each occurrence of the evidence touches (every line of an evidence that
 * spans lines), with the evidence's span inside them. The folded evidence itself when the source
 * does not hold it.
 */
function evidenceContexts(
  source: string,
  ev: string,
): { text: string; from: number; to: number }[] {
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
  const found: { text: string; from: number; to: number }[] = [];
  for (let at = joined.indexOf(ev); at !== -1; at = joined.indexOf(ev, at + 1)) {
    const end = at + ev.length;
    const lo = starts[lineAt(at)] ?? 0;
    const last = lineAt(end - 1);
    const hi = (starts[last] ?? 0) + (lines[last]?.length ?? 0);
    found.push({ text: joined.slice(lo, hi), from: at - lo, to: end - lo });
  }
  return found.length > 0 ? found : [{ text: ev, from: 0, to: ev.length }];
}

/**
 * True when the source line(s) holding the evidence show the as-written amount as a range or an
 * approximation: "280" from "280/320 mt", "100 mt" from "abt 100 mt", "USD 683 per mt" from
 * "USD 683 per mt or USD 690 per mt". The whole line is read, not the model's span, so a
 * shortened evidence ("100 mt") cannot hide the marker. Markers must touch the amount: one before
 * it within 8 characters of the number or its currency, another amount joined by / - – to or, a
 * marker right after the amount and its unit, or a tolerance (±, +/-, plus/minus, more or less)
 * within 12 characters after. "(max tank capacity 400 mt)" or "ISO 8217-2017" nearby does not
 * count. Case- and whitespace-folded; the amount is matched on token boundaries.
 */
export function hedgedInSource(
  source: string,
  evidence: string | null,
  asWritten: string | null,
): boolean {
  if (evidence === null || asWritten === null) return false;
  const ev = collapse(evidence);
  const value = collapse(asWritten);
  if (ev === "" || value === "") return false;
  return evidenceContexts(source, ev).some(({ text, from, to }) => {
    const all = tokenOccurrences(text, value);
    // The amount the evidence points at; any on its lines when the evidence does not hold it.
    const inside = all.filter((at) => at < to && at + value.length > from);
    return (inside.length > 0 ? inside : all).some((at) => hedgedAt(text, at, at + value.length));
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
