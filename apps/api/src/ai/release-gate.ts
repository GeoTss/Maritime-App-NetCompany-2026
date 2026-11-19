/**
 * The release gate: code, not the model, decides whether an answer may be shown. Every number in
 * the answer must be cited, and be the value of a fact in the first citation that follows it in the
 * same sentence: at the precision the answer displays it, with the currency and unit written next
 * to it (if any) agreeing with the fact's unit, and with its sign agreeing with the fact's. Every
 * cited fact id must be a known fact. A few digit runs are not numeric claims (names such as "CO2"
 * or "ISO 8217"; clock times, IMO numbers, MMSIs and identifiers such as hazard ids that a fact
 * holds). Numbers the gate cannot read (non-ASCII digits, spelled-out amounts) are never grounded.
 * The gate only checks; it never edits the text.
 *
 * The vocabulary (currencies, units, fact units, non-claims, the signed-saving rule) is in the
 * tables below; the code after them only reads text with them.
 */
import type { Fact, GateResult } from "@pharos/shared";

// ---- Vocabulary ---------------------------------------------------------------------------------

export type Currency = "USD" | "EUR";
/**
 * The units the gate reads. "/mt" is a price per tonne: "USD 738 per mt", "$712/mt". "kg" and "g"
 * are read so that they never pass for tonnes: no fact unit means either.
 */
export type Unit =
  | "/mt"
  | "mt"
  | "%"
  | "kn"
  | "nm"
  | "h"
  | "days"
  | "t CO₂"
  | "kg"
  | "g"
  | "m"
  | "m3";

/** How each currency is written right before a number ("USD 738", "$738") or right after it. */
const CURRENCIES: { code: Currency; before: string[]; after: string[] }[] = [
  { code: "USD", before: ["US$", "$", "USD"], after: ["USD", "dollar", "dollars"] },
  { code: "EUR", before: ["€", "EUR"], after: ["EUR", "euro", "euros"] },
];

const TONNES = ["mt", "t", "tonne", "tonnes", "ton", "tons", "metric ton", "metric tons"];
/** A mass followed by CO₂ is a mass of CO₂: "mt CO2", "t of CO₂", "tCO2", "kg CO2". */
const ofCo2 = (masses: string[]) =>
  masses.flatMap((m) => ["CO₂", "CO2"].flatMap((c) => [`${m} ${c}`, `${m} of ${c}`, `${m}${c}`]));

/** How each unit is written after a number, or after the currency that follows it ("738 USD/mt"). */
const UNITS: Record<Unit, string[]> = {
  "/mt": ["/mt", "/t", "/tonne", "per mt", "per t", "per tonne", "per ton", "per metric ton"],
  "t CO₂": ofCo2(TONNES),
  mt: TONNES,
  kg: ["kg", "kilogram", "kilograms", ...ofCo2(["kg"])],
  g: ["g", "gram", "grams", ...ofCo2(["g"])],
  "%": ["%", "percent", "per cent"],
  kn: ["kn", "knot", "knots", "kts"],
  nm: ["nm", "nautical mile", "nautical miles"],
  h: ["h", "hr", "hrs", "hour", "hours"],
  days: ["day", "days"],
  // Metres (a draught). A lowercase "m" after a currency is million (`scaleOf`) and is read
  // before units; "m/s", "m²" and "m³" are not metres (see `scan`).
  m: ["m", "metre", "metres", "meter", "meters"],
  // A volume (sludge, sewage). Matched before "m" (longest form first).
  m3: ["m³", "m3", "cbm", "cubic metre", "cubic metres", "cubic meter", "cubic meters"],
};

interface Dimension {
  currency: Currency | null;
  unit: Unit | null;
}

/**
 * The fact units the tools emit, as the currency and unit each one means. A fact with no unit (a
 * count, ratio or id) or a unit not listed (the fx rate "USD/EUR", the CII unit, `calculate`
 * products such as "USD/mt·mt") is not unit-checked: there is nothing known to disagree with.
 */
const FACT_UNITS = new Map<string, Dimension>([
  ["USD", { currency: "USD", unit: null }],
  ["EUR", { currency: "EUR", unit: null }],
  ["USD/mt", { currency: "USD", unit: "/mt" }],
  ["EUR/mt", { currency: "EUR", unit: "/mt" }],
  ["mt", { currency: null, unit: "mt" }],
  ["%", { currency: null, unit: "%" }],
  ["kn", { currency: null, unit: "kn" }],
  ["nm", { currency: null, unit: "nm" }],
  ["h", { currency: null, unit: "h" }],
  ["days", { currency: null, unit: "days" }],
  ["m", { currency: null, unit: "m" }],
  ["m3", { currency: null, unit: "m3" }],
  ["t CO₂", { currency: null, unit: "t CO₂" }],
  ["t CO2", { currency: null, unit: "t CO₂" }],
]);

/**
 * Digit runs that state no amount. A number that lies wholly inside one of these spans is skipped:
 * always for a name, and for a clock time or an IMO number only when a fact holds it. A number
 * that runs on past the span ("CO2 950 t" reads "2 950") is checked, and fails closed.
 */
const NOT_CLAIMS: {
  what: string;
  pattern: RegExp;
  exempt: (match: RegExpExecArray, facts: Fact[]) => boolean;
}[] = [
  {
    what: "a chemical or regulation name",
    pattern: /CO2(?!\d)|IMO 2020(?!\d)|ISO 8217(?::\d{4})?(?!\d)|MARPOL Annex VI/gi,
    exempt: () => true,
  },
  {
    what: "the 3 of a volume unit written m3 right after a number",
    pattern: /(?<=\d[ \t]?)m3(?![A-Za-z0-9])/g,
    exempt: () => true,
  },
  {
    what: "a clock time a fact holds, written 8:00 or 08:00",
    pattern: /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g,
    exempt: (m, facts) => facts.some((f) => holdsTime(f, Number(m[1]), m[2] ?? "")),
  },
  {
    what: "an IMO number equal to a fact",
    pattern: /(?<![A-Za-z])IMO[ \t]*(?:no\.?[ \t]*)?:?[ \t]*(\d{7})(?!\d)/gi,
    exempt: (m, facts) => facts.some((f) => String(f.value) === m[1]),
  },
  {
    what: "a 9-digit MMSI an identifier fact holds, or a label names",
    pattern: /(?<![A-Za-z])MMSI[ \t]*(?:no\.?[ \t]*)?:?[ \t]*(\d{9})(?!\d)/gi,
    exempt: (m, facts) => {
      const mmsi = m[1] ?? "";
      // Labels are built by code and name an AIS ship only as "MMSI <n>". An identifier value
      // backs it whole ("205795000") or as a segment ("ais:distress_beacon:970123456").
      const named = new RegExp(`MMSI ${mmsi}(?!\\d)`);
      return facts.some(
        (f) => identifierValues(f).some((v) => v.split(":").includes(mmsi)) || named.test(f.label),
      );
    },
  },
  {
    what: "an identifier such as a hazard id (synthetic:1, ais:distress_beacon:970123456) an identifier fact holds",
    pattern: /(?<![A-Za-z0-9_:])[A-Za-z][A-Za-z0-9_]*(?::[A-Za-z0-9_]+)+/g,
    exempt: (m, facts) => facts.some((f) => identifierValues(f).includes(m[0])),
  },
  {
    what: "a hyphenated code such as a voyage number (AP-2611) an identifier fact holds",
    pattern: /(?<![A-Za-z0-9_:-])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+(?![A-Za-z0-9_:-])/g,
    exempt: (m, facts) => facts.some((f) => identifierValues(f).includes(m[0])),
  },
];

/**
 * The identifiers a fact carries, from columns code fills: the string value of a row's `id`
 * (such as a hazard id), of an `mmsi` field or of a `voyageNo` field, and the row id of a
 * `nav_hazards` fact (hazard ids are built by code, so a crossed hazard's label fact names its
 * id). Only these can make an MMSI, an identifier or a code a non-claim: free text (an AIS ship
 * name, a hazard label) is untrusted and a number fact is an amount.
 */
function identifierValues(fact: Fact): string[] {
  const p = fact.provenance;
  if (p.source !== "db") return [];
  const out: string[] = [];
  if (typeof fact.value === "string" && /^(?:id|(?:.*\.)?(?:mmsi|voyageNo))$/.test(p.field)) {
    out.push(fact.value);
  }
  if (p.table === "nav_hazards") out.push(String(p.rowId));
  return out;
}

/** A negative number may state a positive saving or difference said to be less. */
const SIGNED_DELTA = { label: /saving|difference/i, words: /\b(?:less|lower|cheaper)\b/i };

/**
 * Scale suffixes written right after a number ("16k", "1.2 mln", "5 Million"), matched without
 * regard to case. Lowercase `m` is handled in `scaleOf`: it means metres unless a currency leads.
 */
const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  mn: 1e6,
  mln: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
};

// ---- Patterns built from the vocabulary ---------------------------------------------------------

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Lookup key of a written form: lower case, single spaces. */
const formKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
/** One alternative per written form, longest first; a space matches any run of blanks. */
const alternation = (forms: string[]) =>
  [...forms]
    .sort((a, b) => b.length - a.length)
    .map((f) => escapeRegExp(f).replaceAll(" ", "[ \\t]+"))
    .join("|");
/** Each written form, by `formKey`, to the value it means. */
function lookup<T>(groups: [T, string[]][]): Map<string, T> {
  return new Map(
    groups.flatMap(([value, forms]) => forms.map((f): [string, T] => [formKey(f), value])),
  );
}

const CURRENCY_BEFORE_FORMS = lookup(
  CURRENCIES.map((c): [Currency, string[]] => [c.code, c.before]),
);
const CURRENCY_AFTER_FORMS = lookup(CURRENCIES.map((c): [Currency, string[]] => [c.code, c.after]));
const UNIT_FORMS = lookup(Object.entries(UNITS) as [Unit, string[]][]);

/**
 * A sign and/or currency right before a number: "-26", "$26", "-$26", "$-26", "USD -26". The minus
 * may be a hyphen, a minus sign or an en dash ("–26"). One glued to a letter or digit ("AP-2611",
 * "2026-11-15", the range "10–12") is not a minus.
 */
const SIGN_AND_CURRENCY_BEFORE = new RegExp(
  `(?:(?<![\\p{L}\\p{N}])([-−–]))?(?:(?<![A-Za-z])(${alternation([...CURRENCY_BEFORE_FORMS.keys()])})[ \\t]?([-−–])?)?$`,
  "iu",
);
/** A currency right after a number or its scale suffix: "26 USD", "8 thousand dollars". */
const CURRENCY_AFTER = new RegExp(
  `^[ \\t]?(${alternation([...CURRENCY_AFTER_FORMS.keys()])})(?![A-Za-z0-9])`,
  "iu",
);
/**
 * A unit right after a number or its currency: "300 mt", "36.32-hour", "$712/mt", "4 %". A unit or
 * currency must end the word, so the "T" of "2026-11-15T10:30" is not a tonne.
 */
const UNIT_AFTER = new RegExp(
  `^[ \\t-]?(${alternation([...UNIT_FORMS.keys()])})(?![A-Za-z0-9])`,
  "iu",
);

// ---- Reading numbers ----------------------------------------------------------------------------

/** A square-bracket citation of one or more fact ids, e.g. `[f_a]` or `[f_a, f_b]`. */
const CITATION = /\[\s*f_[A-Za-z0-9_.:-]+(?:\s*[,;]\s*f_[A-Za-z0-9_.:-]+)*\s*\]/g;
const FACT_ID = /f_[A-Za-z0-9_.:-]+/g;

/**
 * ASCII digits with optional thousands grouping (commas, or spaces as in "233 914", one kind per
 * number) and decimals. Every ASCII digit in the text lands in some token: a run that is not
 * thousands grouping is read as separate numbers. Sign, currency, scale and unit are read around it.
 */
const NUMBER =
  /(?:\d{1,3}(?:,\d{3})+(?!\d)|\d{1,3}(?:[ \u00a0\u2009\u202f]\d{3})+(?!\d)|\d+)(?:\.\d+)?/gu;

/** The word right after a number (one optional space), a scale suffix candidate. */
const WORD_AFTER = /^( ?)([A-Za-z]+)/u;

/** The multiplier of the word after a number, if it is a scale suffix. */
function scaleOf(word: string, currencyLed: boolean): number | undefined {
  if (word === "M") return 1e6;
  if (word === "m") return currencyLed ? 1e6 : undefined;
  return SCALES[word.toLowerCase()];
}

/** Decimal digits outside ASCII (Arabic-Indic, fullwidth, ...): the gate cannot check them. */
const NON_ASCII_DIGITS = /(?:(?![0-9])\p{Nd})+/gu;

/** A numbered-list marker at the start of a line: "1. ", "2) ". */
const LIST_MARKER = /^([ \t]*)(\d{1,2})[.)](?=[ \t])/gmu;

/** A sentence ends at `.`, `!` or `?` before whitespace, or at a line break. */
const SENTENCE_END = /[.!?](?=\s)|\n/g;

// Spelled-out numbers: zero to ninety-nine, half, quarter, hundred, dozen, and the scale words.
const ONES = "one|two|three|four|five|six|seven|eight|nine";
const TEENS = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const SCALE_WORD = "thousand|million|billion";
const NUMBER_WORD = `(?:(?:${TENS})(?:-(?:${ONES}))?|${TEENS}|zero|${ONES}|half|quarter|hundred|dozen|${SCALE_WORD})`;
/** Words joined into one amount: "two hundred and fifty", "half a million", "quarter of a million". */
const JOIN = "(?:[ \\t]+(?:and|of[ \\t]+a|a)[ \\t]+|[ \\t-]+)";
const SPELLED = new RegExp(
  `(?<![A-Za-z])${NUMBER_WORD}(?:${JOIN}${NUMBER_WORD})*(?![A-Za-z])`,
  "giu",
);
const HAS_SCALE_WORD = new RegExp(`(?<![A-Za-z])(?:${SCALE_WORD})(?![A-Za-z])`, "iu");
/** A unit, currency or percent word or symbol right after a spelled-out number ("half an hour"). */
const SPELLED_UNIT_AFTER =
  /^[ \t-]*(?:an?[ \t]+)?(?:%|(?:dollars?|euros?|usd|eur|percent|per[ \t]?cent|tonnes?|tons?|mt|metric[ \t]+tons?|hours?|hrs?|h|days?|weeks?|minutes?|mins?|knots?|kn|kts|nm|nautical[ \t]+miles?|miles?|cents?)(?![A-Za-z]))/iu;
/** A currency symbol or code right before a spelled-out number. */
const CURRENCY_BEFORE = /(?:[$€]|(?<![A-Za-z])(?:usd|eur))[ \t]*$/iu;

export interface NumericToken {
  /** As written: sign, digits and scale suffix, plus "%" for a percentage; no currency sign. */
  text: string;
  /** The value shown, sign and scale applied: "-16k" is -16 000. */
  value: number;
  /** Decimal places as displayed, before the scale. */
  decimals: number;
  /** The scale suffix's multiplier, 1 without one. */
  multiplier: number;
  /** Written as a percentage ("12.5%", "70 percent"): the unit is "%". */
  percent: boolean;
  /** The currency written right before or after the number, if any. */
  currency: Currency | null;
  /** The unit written right after the number or its currency, if any. */
  unit: Unit | null;
}

interface Located {
  start: number;
  end: number;
}

/** A token with its place in the text and its digits as written (grouping kept, no sign). */
interface Scanned extends NumericToken, Located {
  digits: string;
}

/** Spaces of the same length, so positions still match the original text. */
const blank = (s: string) => " ".repeat(s.length);

/**
 * The text with citations and the markers of a numbered list blanked. A line-start marker is a
 * list marker only if it continues a sequence from 1, so a stray "8. " still gets checked.
 */
function scannable(text: string): string {
  let expected = 1;
  return text.replace(CITATION, blank).replace(LIST_MARKER, (marker, indent: string, n: string) => {
    const value = Number(n);
    if (value !== 1 && value !== expected) return marker;
    expected = value + 1;
    return indent + blank(marker.slice(indent.length));
  });
}

/**
 * A string fact holds the clock time `hour:minutes`, with or without a leading zero, as an hour and
 * minute: the "15:30" of "T03:15:30" is minutes and seconds, not a time.
 */
function holdsTime(fact: Fact, hour: number, minutes: string): boolean {
  if (typeof fact.value !== "string") return false;
  return new RegExp(`(?<![\\d:])0?${hour}:${minutes}(?!\\d)`).test(fact.value);
}

/** The spans of `text` that are not numeric claims, given the facts. */
function notClaimSpans(text: string, facts: Fact[]): Located[] {
  const spans: Located[] = [];
  for (const { pattern, exempt } of NOT_CLAIMS) {
    for (const m of text.matchAll(pattern)) {
      if (exempt(m, facts)) spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return spans;
}

function scan(text: string, facts: Fact[]): Scanned[] {
  const source = scannable(text);
  const skipped = notClaimSpans(source, facts);
  const tokens: Scanned[] = [];
  for (const m of source.matchAll(NUMBER)) {
    const start = m.index;
    const digits = m[0];
    let end = start + digits.length;
    if (skipped.some((s) => start >= s.start && end <= s.end)) continue;

    const before = SIGN_AND_CURRENCY_BEFORE.exec(source.slice(0, start));
    const negative = Boolean(before?.[1] ?? before?.[3]);
    let currency = before?.[2] ? (CURRENCY_BEFORE_FORMS.get(formKey(before[2])) ?? null) : null;

    let written = digits;
    let multiplier = 1;
    const word = WORD_AFTER.exec(source.slice(end));
    const scale = word ? scaleOf(word[2] ?? "", currency !== null) : undefined;
    if (word && scale !== undefined) {
      multiplier = scale;
      written += word[0];
      end += word[0].length;
    }

    const after = CURRENCY_AFTER.exec(source.slice(end));
    if (after) {
      currency ??= CURRENCY_AFTER_FORMS.get(formKey(after[1] ?? "")) ?? null;
      end += after[0].length;
    }
    let unitMatch = UNIT_AFTER.exec(source.slice(end));
    // "10 m/s", "20 m²": a compound of metres is not a length, so no unit is read ("m³" is read
    // as the volume unit m3 before this, longest form first).
    if (unitMatch && /^[/²³^]/u.test(source.slice(end + unitMatch[0].length))) {
      if (UNIT_FORMS.get(formKey(unitMatch[1] ?? "")) === "m") unitMatch = null;
    }
    const unit = unitMatch ? (UNIT_FORMS.get(formKey(unitMatch[1] ?? "")) ?? null) : null;
    if (unitMatch) end += unitMatch[0].length;

    const percent = unit === "%";
    const magnitude = Number(digits.replace(/[^\d.]/g, "")) * multiplier;
    tokens.push({
      text: `${negative ? "-" : ""}${written}${percent ? "%" : ""}`,
      value: negative ? -magnitude : magnitude,
      decimals: digits.split(".")[1]?.length ?? 0,
      multiplier,
      percent,
      currency,
      unit,
      digits,
      start,
      end,
    });
  }
  return tokens;
}

/** The numbers in `text`, ignoring fact citations, numbered-list markers and names like "CO2". */
export function numericTokens(text: string): NumericToken[] {
  return scan(text, []).map(({ start: _s, end: _e, digits: _d, ...token }) => token);
}

/**
 * Spelled-out numbers that state an amount: any phrase with a scale word ("one thousand", "a
 * million"), or one next to a unit or currency ("one day", "five percent", "$ nine"). Bare counts
 * ("two options", "one is feasible") pass. `text` has citations and digit tokens blanked, so a scale
 * word that scales a digit token ("16 thousand") is checked once, with the token.
 */
function spelledAmounts(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const m of text.matchAll(SPELLED)) {
    const phrase = m[0];
    const scale = HAS_SCALE_WORD.test(phrase);
    const unit = SPELLED_UNIT_AFTER.test(text.slice(m.index + phrase.length));
    const currency = CURRENCY_BEFORE.test(text.slice(0, m.index));
    if (scale || unit || currency) out.push({ start: m.index, text: phrase });
  }
  return out;
}

/** `text` with each span replaced by spaces of the same length. */
function blankSpans(text: string, spans: Located[]): string {
  let out = text;
  for (const { start, end } of spans) {
    out = out.slice(0, start) + " ".repeat(end - start) + out.slice(end);
  }
  return out;
}

/** Ids in the first citation after `from`, if it comes before the sentence ends; else none. */
function citationAfter(text: string, from: number): string[] {
  CITATION.lastIndex = from;
  const citation = CITATION.exec(text);
  CITATION.lastIndex = 0;
  if (!citation) return [];
  SENTENCE_END.lastIndex = from;
  const end = SENTENCE_END.exec(text);
  SENTENCE_END.lastIndex = 0;
  if (end && end.index < citation.index) return [];
  return citation[0].match(FACT_ID) ?? [];
}

/** The sentence around `span`: from the previous sentence end to the next. */
function sentenceAround(text: string, span: Located): string {
  let from = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    if (m.index < span.start) from = m.index + 1;
    else if (m.index >= span.end) return text.slice(from, m.index);
  }
  return text.slice(from);
}

/** Fact ids cited in square brackets, in first-cited order, without duplicates. */
export function citedFactIds(text: string): string[] {
  const ids = new Set<string>();
  for (const citation of text.match(CITATION) ?? []) {
    for (const id of citation.match(FACT_ID) ?? []) ids.add(id);
  }
  return [...ids];
}

// ---- Matching a number to a fact ----------------------------------------------------------------

/**
 * Within half a unit of the last displayed decimal, at the displayed scale, sign aside:
 * `233,851` shows 233851.2, and `16k` shows 16 230.
 */
function showsValue(token: NumericToken, value: number): boolean {
  const step = token.multiplier / 10 ** token.decimals;
  return Math.abs(Math.abs(value) - Math.abs(token.value)) / step <= 0.5 + 1e-9;
}

/** The token appears inside the string as a whole digit run (a voyage no., an ETA part). */
function inString(token: Scanned, value: string): boolean {
  if (token.multiplier !== 1) return false;
  return new RegExp(`(?<!\\d)${escapeRegExp(token.digits)}(?!\\d)`).test(value);
}

/** The value shown is the fact's; a percentage may also show a fraction with no unit (0.7 → 70%). */
function valueMatches(token: Scanned, fact: Fact): boolean {
  if (typeof fact.value === "number") {
    const fraction = token.percent && fact.unit === null;
    return showsValue(token, fact.value) || (fraction && showsValue(token, fact.value * 100));
  }
  if (typeof fact.value === "string") return inString(token, fact.value);
  return false;
}

/** The currency and unit written, where written, are the fact's ("EUR 738" states EUR/mt 738). */
function unitAgrees(token: NumericToken, fact: Fact): boolean {
  const dimension = fact.unit === null ? undefined : FACT_UNITS.get(fact.unit);
  if (!dimension) return true;
  if (token.currency !== null && token.currency !== dimension.currency) return false;
  return token.unit === null || token.unit === dimension.unit;
}

/**
 * A positive number may state a negative fact's magnitude ("short by 12.4 mt"). A negative number
 * states a negative fact, or a positive saving or difference its sentence says is less.
 */
function signAgrees(token: NumericToken, fact: Fact, sentence: string): boolean {
  if (token.value >= 0) return true;
  if (typeof fact.value !== "number") return false;
  if (fact.value <= 0) return true;
  return SIGNED_DELTA.label.test(fact.label) && SIGNED_DELTA.words.test(sentence);
}

/**
 * Some number in `text` shows `fact`'s value as the gate reads it: at the precision displayed,
 * with the currency and unit written next to it (if any) agreeing with the fact's unit. Sign and
 * citations are not looked at. The Q&A grader uses it so an answer states a value exactly when
 * the gate would read it as that value.
 */
export function statesFact(text: string, fact: Fact): boolean {
  return scan(text, []).some((token) => valueMatches(token, fact) && unitAgrees(token, fact));
}

function grounded(token: Scanned, cited: Fact[], sentence: string): boolean {
  return cited.some(
    (f) => valueMatches(token, f) && unitAgrees(token, f) && signAgrees(token, f, sentence),
  );
}

/**
 * Checks `answer` against `facts`. Ungrounded, in text order and once each:
 * - a number with no citation after it in its sentence, or that none of the facts in that
 *   citation states (value at its precision, written currency and unit, sign);
 * - a cited fact id that is not in `facts` (listed as `[f_…]`);
 * - non-ASCII digits, and spelled-out amounts ("eight thousand", "five percent").
 * Names such as "CO2" or "ISO 8217", and clock times, IMO numbers, MMSIs and identifiers (hazard
 * ids) some fact holds, are not numbers here. `repaired` is always false; the agent sets it after
 * the repair turn. `attempts` holds this pass as attempt 1; the agent appends the repair pass as
 * attempt 2.
 */
export function checkNumbers(answer: string, facts: Fact[]): GateResult {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const problems: { start: number; text: string }[] = [];
  const tokens = scan(answer, facts);
  for (const token of tokens) {
    const cited = citationAfter(answer, token.end).flatMap((id) => byId.get(id) ?? []);
    if (!grounded(token, cited, sentenceAround(answer, token))) {
      problems.push({ start: token.start, text: token.text });
    }
  }
  for (const m of answer.matchAll(CITATION)) {
    for (const id of m[0].match(FACT_ID) ?? []) {
      if (!byId.has(id)) problems.push({ start: m.index, text: `[${id}]` });
    }
  }
  for (const m of answer.matchAll(NON_ASCII_DIGITS)) {
    problems.push({ start: m.index, text: m[0] });
  }
  problems.push(...spelledAmounts(blankSpans(answer.replace(CITATION, blank), tokens)));

  problems.sort((a, b) => a.start - b.start);
  const ungrounded = [...new Set(problems.map((p) => p.text))];
  const passed = ungrounded.length === 0;
  return {
    passed,
    repaired: false,
    ungroundedNumbers: ungrounded,
    attempts: [{ attempt: 1, passed, ungroundedNumbers: ungrounded }],
  };
}
