/**
 * The release gate: code, not the model, decides whether an answer may be shown. Every number in
 * the answer must be cited, and be the value of a fact in the first citation that follows it in the
 * same sentence, at the precision the answer displays it. Every cited fact id must be a known fact.
 * Numbers the gate cannot read (non-ASCII digits, spelled-out amounts) are never grounded. The gate
 * only checks; it never edits the text.
 */
import type { Fact, GateResult } from "@pharos/shared";

/** A square-bracket citation of one or more fact ids, e.g. `[f_a]` or `[f_a, f_b]`. */
const CITATION = /\[\s*f_[A-Za-z0-9_.:-]+(?:\s*[,;]\s*f_[A-Za-z0-9_.:-]+)*\s*\]/g;
const FACT_ID = /f_[A-Za-z0-9_.:-]+/g;

/** Multipliers of a scale suffix written right after a number ("16k", "1.2M", "5 million"). */
const SCALES: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  thousand: 1e3,
  Thousand: 1e3,
  m: 1e6,
  M: 1e6,
  mn: 1e6,
  million: 1e6,
  Million: 1e6,
  bn: 1e9,
  billion: 1e9,
  Billion: 1e9,
};

/**
 * ASCII digits with optional thousands commas and decimals, an optional leading `$`/`€`, an
 * optional scale suffix (not followed by a letter, so "300 mt" and "5 min" keep their units) and
 * an optional trailing `%`. Every ASCII digit in the text lands in some token: a comma run that is
 * not thousands grouping is read as separate numbers.
 */
const NUMBER =
  /([$€])?((?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?)(?:( ?)(thousand|Thousand|million|Million|billion|Billion|mn|bn|k|K|m|M)(?![A-Za-z]))?(%)?/gu;

/** Decimal digits outside ASCII (Arabic-Indic, fullwidth, ...): the gate cannot check them. */
const NON_ASCII_DIGITS = /(?:(?![0-9])\p{Nd})+/gu;

/** A numbered-list marker at the start of a line: "1. ", "2) ". */
const LIST_MARKER = /^([ \t]*)(\d{1,2})[.)](?=[ \t])/gmu;

/** A sentence ends at `.`, `!` or `?` before whitespace, or at a line break. */
const SENTENCE_END = /[.!?](?=\s)|\n/g;

// Spelled-out numbers: two to ninety-nine, hundred, dozen, and the scale words.
const ONES = "two|three|four|five|six|seven|eight|nine";
const TEENS = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const SCALE_WORD = "thousand|million|billion";
const NUMBER_WORD = `(?:(?:${TENS})(?:-(?:one|${ONES}))?|${TEENS}|${ONES}|hundred|dozen|${SCALE_WORD})`;
const SPELLED = new RegExp(
  `(?<![A-Za-z])${NUMBER_WORD}(?:(?:[ \\t]+and[ \\t]+|[ \\t-]+)${NUMBER_WORD})*(?![A-Za-z])`,
  "giu",
);
const HAS_SCALE_WORD = new RegExp(`(?<![A-Za-z])(?:${SCALE_WORD})(?![A-Za-z])`, "iu");
/** A unit, currency or percent word or symbol right after a spelled-out number. */
const UNIT_AFTER =
  /^[ \t-]*(?:%|(?:dollars?|euros?|usd|eur|percent|per[ \t]?cent|tonnes?|tons?|mt|metric[ \t]+tons?|hours?|hrs?|h|days?|weeks?|minutes?|mins?|knots?|kn|kts|nm|nautical[ \t]+miles?|miles?|cents?)(?![A-Za-z]))/iu;
/** A currency symbol or code right before a spelled-out number. */
const CURRENCY_BEFORE = /(?:[$€]|(?<![A-Za-z])(?:usd|eur))[ \t]*$/iu;

export interface NumericToken {
  /** As written, without a currency sign (a scale suffix and the percent sign are kept). */
  text: string;
  /** The value shown, scale applied: "16k" is 16 000. */
  value: number;
  /** Decimal places as displayed, before the scale. */
  decimals: number;
  /** The scale suffix's multiplier, 1 without one. */
  multiplier: number;
  percent: boolean;
}

interface Located {
  start: number;
  end: number;
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

function scan(text: string): (NumericToken & Located)[] {
  const tokens: (NumericToken & Located)[] = [];
  for (const m of scannable(text).matchAll(NUMBER)) {
    const digits = m[2] ?? "";
    const suffix = m[4] ?? "";
    const multiplier = suffix ? (SCALES[suffix] ?? 1) : 1;
    const percent = m[5] === "%";
    tokens.push({
      text: `${digits}${suffix ? `${m[3] ?? ""}${suffix}` : ""}${percent ? "%" : ""}`,
      value: Number(digits.replaceAll(",", "")) * multiplier,
      decimals: digits.includes(".") ? (digits.split(".")[1]?.length ?? 0) : 0,
      multiplier,
      percent,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

/** The numbers in `text`, ignoring fact citations and numbered-list markers. */
export function numericTokens(text: string): NumericToken[] {
  return scan(text).map(({ start: _s, end: _e, ...token }) => token);
}

/** Spelled-out numbers that state an amount: with a scale word, or next to a unit or currency. */
function spelledAmounts(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const m of text.matchAll(SPELLED)) {
    const phrase = m[0];
    const multiWordScale = HAS_SCALE_WORD.test(phrase) && /[ \t-]/.test(phrase);
    const unit = UNIT_AFTER.test(text.slice(m.index + phrase.length));
    const currency = CURRENCY_BEFORE.test(text.slice(0, m.index));
    if (multiWordScale || unit || currency) out.push({ start: m.index, text: phrase });
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

/** Fact ids cited in square brackets, in first-cited order, without duplicates. */
export function citedFactIds(text: string): string[] {
  const ids = new Set<string>();
  for (const citation of text.match(CITATION) ?? []) {
    for (const id of citation.match(FACT_ID) ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Within half a unit of the last displayed decimal, at the displayed scale: `233,851` shows
 * 233851.2, and `16k` shows 16 230.
 */
function showsValue(token: NumericToken, value: number): boolean {
  const step = token.multiplier / 10 ** token.decimals;
  return Math.abs(Math.abs(value) - token.value) / step <= 0.5 + 1e-9;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The token appears inside the string as a whole digit run (an IMO, a voyage no., an ETA part). */
function inString(token: NumericToken, value: string): boolean {
  if (token.multiplier !== 1) return false;
  const digits = token.percent ? token.text.slice(0, -1) : token.text;
  return new RegExp(`(?<!\\d)${escapeRegExp(digits)}(?!\\d)`).test(value);
}

function grounded(token: NumericToken, facts: Fact[]): boolean {
  return facts.some((f) => {
    if (typeof f.value === "number") {
      const value = f.value;
      return showsValue(token, value) || (token.percent && showsValue(token, value * 100));
    }
    if (typeof f.value === "string") return inString(token, f.value);
    return false;
  });
}

/**
 * Checks `answer` against `facts`. Ungrounded, in text order and once each:
 * - a number with no citation after it in its sentence, or whose value none of the facts in that
 *   citation shows;
 * - a cited fact id that is not in `facts` (listed as `[f_…]`);
 * - non-ASCII digits, and spelled-out amounts ("eight thousand", "five percent").
 * `repaired` is always false here; the agent sets it after the repair turn.
 */
export function checkNumbers(answer: string, facts: Fact[]): GateResult {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const problems: { start: number; text: string }[] = [];
  for (const token of scan(answer)) {
    const cited = citationAfter(answer, token.end).flatMap((id) => byId.get(id) ?? []);
    if (!grounded(token, cited)) problems.push({ start: token.start, text: token.text });
  }
  for (const m of answer.matchAll(CITATION)) {
    for (const id of m[0].match(FACT_ID) ?? []) {
      if (!byId.has(id)) problems.push({ start: m.index, text: `[${id}]` });
    }
  }
  for (const m of answer.matchAll(NON_ASCII_DIGITS)) {
    problems.push({ start: m.index, text: m[0] });
  }
  problems.push(...spelledAmounts(answer.replace(CITATION, blank)));

  problems.sort((a, b) => a.start - b.start);
  const ungrounded = [...new Set(problems.map((p) => p.text))];
  return { passed: ungrounded.length === 0, repaired: false, ungroundedNumbers: ungrounded };
}
