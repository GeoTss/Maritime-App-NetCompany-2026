/**
 * The release gate: code, not the model, decides whether an answer may be shown. Every number in
 * the answer must be cited, and be the value of a fact in the first citation that follows it in the
 * same sentence, at the precision the answer displays it. The gate only checks; it never edits the
 * text.
 */
import type { Fact, GateResult } from "@pharos/shared";

/** A square-bracket citation of one or more fact ids, e.g. `[f_a]` or `[f_a, f_b]`. */
const CITATION = /\[\s*f_[A-Za-z0-9_.:-]+(?:\s*[,;]\s*f_[A-Za-z0-9_.:-]+)*\s*\]/g;
const FACT_ID = /f_[A-Za-z0-9_.:-]+/g;

/**
 * Digits with optional thousands commas and decimals, an optional leading `$`/`€` and trailing `%`.
 * Every digit in the text lands in some token: a comma run that is not thousands grouping is read
 * as separate numbers, so nothing can hide a number from the gate by formatting it oddly.
 */
const NUMBER = /([$€])?((?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?)(%)?/g;

export interface NumericToken {
  /** As written, without a currency sign (the percent sign is kept). */
  text: string;
  value: number;
  /** Decimal places as displayed. */
  decimals: number;
  percent: boolean;
}

/** A sentence ends at `.`, `!` or `?` before whitespace, or at a line break. */
const SENTENCE_END = /[.!?](?=\s)|\n/g;

/** Citations blanked to spaces of the same length, so positions still match `text`. */
const blankCitations = (text: string): string =>
  text.replace(CITATION, (c) => " ".repeat(c.length));

function scan(text: string): (NumericToken & { end: number })[] {
  const tokens: (NumericToken & { end: number })[] = [];
  for (const m of blankCitations(text).matchAll(NUMBER)) {
    const digits = m[2] ?? "";
    const percent = m[3] === "%";
    tokens.push({
      text: percent ? `${digits}%` : digits,
      value: Number(digits.replaceAll(",", "")),
      decimals: digits.includes(".") ? (digits.split(".")[1]?.length ?? 0) : 0,
      percent,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

/** The numbers in `text`, ignoring fact citations. */
export function numericTokens(text: string): NumericToken[] {
  return scan(text).map(({ end: _end, ...token }) => token);
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

/** Within half a unit of the last displayed decimal: `233,851` shows 233851.2 at 0 dp. */
function showsValue(token: NumericToken, value: number): boolean {
  const scale = 10 ** token.decimals;
  return Math.abs(Math.abs(value) * scale - token.value * scale) <= 0.5 + 1e-9;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The token appears inside the string as a whole digit run (an IMO, a voyage no., an ETA part). */
function inString(token: NumericToken, value: string): boolean {
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
 * Checks every number in `answer` against the facts cited right after it. A number is ungrounded
 * when no citation follows it in its sentence, or when none of the cited facts (known in `facts`)
 * shows its value. `repaired` is always false here; the agent sets it after the repair turn.
 */
export function checkNumbers(answer: string, facts: Fact[]): GateResult {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const ungrounded = new Set<string>();
  for (const token of scan(answer)) {
    const cited = citationAfter(answer, token.end).flatMap((id) => byId.get(id) ?? []);
    if (!grounded(token, cited)) ungrounded.add(token.text);
  }
  return { passed: ungrounded.size === 0, repaired: false, ungroundedNumbers: [...ungrounded] };
}
