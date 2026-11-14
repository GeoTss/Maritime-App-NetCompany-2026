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
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    from = at + 1;
    const end = at + needle.length;
    const before = haystack[at - 1];
    const after = haystack[end];
    if (isAlnum(needle[0]) && isAlnum(before)) continue;
    if (isAlnum(needle[needle.length - 1]) && isAlnum(after)) continue;
    if (/[.,]/.test(after ?? "") && isDigit(haystack[end + 1])) continue;
    if (/[.,]/.test(before ?? "") && isDigit(haystack[at - 2])) continue;
    return true;
  }
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
