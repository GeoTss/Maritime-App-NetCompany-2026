/**
 * An answer with its citations made clickable. Each `[f_…]` marker (the API's citation style: the
 * fact id right after the number and its unit) is removed, and the number written just before it
 * becomes a `FactChip`, keeping the model's digits exactly as written. A marker whose id is not in
 * the answer's facts stays visible as plain text and is counted (the release gate should make that
 * impossible; if it happens, the operator sees it rather than a silent chip).
 */
import type { Fact } from "@pharos/shared";
import { Fragment, useEffect, useMemo } from "react";
import { FactChip, FactLedgerProvider } from "@/components/fact-chip";
import { cn } from "@/lib/utils";

/** Same shape as the release gate's: `[f_a]` or `[f_a, f_b]`. */
const CITATION = /\[\s*f_[A-Za-z0-9_.:-]+(?:\s*[,;]\s*f_[A-Za-z0-9_.:-]+)*\s*\]/g;
const FACT_ID = /f_[A-Za-z0-9_.:-]+/g;

/** Units the prompt writes between a number and its citation. Longest first. */
const UNITS = [
  "USD/mt",
  "EUR/mt",
  "USD/EUR",
  "mt/day",
  "t CO₂",
  "tCO₂",
  "CO₂",
  "/mt",
  "per mt",
  "tonnes",
  "tonne",
  "knots",
  "hours",
  "hour",
  "days",
  "day",
  "hrs",
  "USD",
  "EUR",
  "mt",
  "kn",
  "nm",
  "NM",
  "m3",
  "m³",
  "h",
  "t",
  "m",
  "%",
  "°",
];
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const UNIT = `(?:[ \\u00a0]?(?:${UNITS.map(escapeRegExp).join("|")}))`;
/** A currency lead, a sign, digits with grouping (commas or spaces) and decimals. */
const NUMBER = String.raw`(?:(?:USD|EUR|US\$|[$€£])[  ]?)?[-−+]?\d{1,3}(?:(?:,\d{3})+|(?:[   ]\d{3})+|\d*)(?:\.\d+)?`;
/** The number (and its unit) that ends a stretch of text. */
const NUMBER_AT_END = new RegExp(`${NUMBER}${UNIT}?(?![A-Za-z0-9])$`, "u");
/** Any number in a stretch of text (the fallback when the unit after it is not one we know). */
const ANY_NUMBER = new RegExp(NUMBER, "gu");

export type FactTextPart =
  | { kind: "text"; text: string }
  | { kind: "fact"; written: string | null; facts: Fact[]; unknownIds: string[] }
  | { kind: "unknown"; written: string; marker: string };

interface Split {
  /** Text before the written number. */
  before: string;
  /** The number (with currency and unit) the chip will carry; null when there is none. */
  written: string | null;
  /** Words between the number and the marker that are not a unit, kept as text after the chip. */
  after: string;
}

/** Finds the written number a citation belongs to at the end of the text before it. */
function splitWritten(segment: string): Split {
  const trimmed = segment.replace(/\s+$/u, "");
  const atEnd = NUMBER_AT_END.exec(trimmed);
  if (atEnd) return { before: trimmed.slice(0, atEnd.index), written: atEnd[0], after: "" };
  // A short word we do not know as a unit sits between the number and the marker ("12 boxes").
  let last: RegExpMatchArray | undefined;
  for (const m of trimmed.matchAll(ANY_NUMBER)) last = m;
  if (last?.index !== undefined) {
    const end = last.index + last[0].length;
    if (trimmed.length - end <= 12) {
      return { before: trimmed.slice(0, last.index), written: last[0], after: trimmed.slice(end) };
    }
  }
  return { before: segment, written: null, after: "" };
}

export function parseFactText(
  text: string,
  facts: Fact[],
): { parts: FactTextPart[]; unknownIds: string[] } {
  const ledger = new Map(facts.map((f) => [f.id, f]));
  const parts: FactTextPart[] = [];
  const unknownIds: string[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const prev = parts.at(-1);
    if (prev?.kind === "text") prev.text += t;
    else parts.push({ kind: "text", text: t });
  };

  let cursor = 0;
  for (const match of text.matchAll(CITATION)) {
    const marker = match[0];
    const ids = marker.match(FACT_ID) ?? [];
    const known = ids.map((id) => ledger.get(id)).filter((f): f is Fact => f !== undefined);
    const unknown = ids.filter((id) => !ledger.has(id));
    unknownIds.push(...unknown);

    const { before, written, after } = splitWritten(text.slice(cursor, match.index));
    pushText(before);

    if (known.length === 0) {
      // Nothing to cite: the number stays plain text and the marker stays visible.
      const plain = `${written ?? ""}${after}`;
      pushText(plain && !/\s$/u.test(plain) ? `${plain} ` : plain);
      parts.push({ kind: "unknown", written: written ?? "", marker });
    } else {
      parts.push({ kind: "fact", written, facts: known, unknownIds: unknown });
      pushText(after);
    }
    cursor = match.index + marker.length;
  }
  pushText(text.slice(cursor));
  return { parts, unknownIds };
}

export function FactText({
  text,
  facts,
  onUnknownIds,
  className,
}: {
  text: string;
  facts: Fact[];
  /** Called with the cited ids that are not in `facts` (empty when every citation resolves). */
  onUnknownIds?: (ids: string[]) => void;
  className?: string;
}) {
  const { parts, unknownIds } = useMemo(() => parseFactText(text, facts), [text, facts]);
  const unknownKey = unknownIds.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: report when the set of ids changes.
  useEffect(() => {
    onUnknownIds?.(unknownIds);
  }, [unknownKey]);

  return (
    <FactLedgerProvider facts={facts}>
      <span className={cn("whitespace-pre-line", className)} data-unknown-facts={unknownIds.length}>
        {parts.map((part, i) => {
          const key = `${part.kind}-${i}`;
          if (part.kind === "text") return <Fragment key={key}>{part.text}</Fragment>;
          if (part.kind === "unknown") {
            return (
              <span
                key={key}
                className="font-mono text-2xs text-caution"
                title="This citation names a fact the answer does not carry."
              >
                {part.marker}
              </span>
            );
          }
          const [first, ...rest] = part.facts;
          if (!first) return null;
          return (
            <Fragment key={key}>
              {part.written ? (
                <FactChip fact={first}>{part.written}</FactChip>
              ) : (
                <FactChip fact={first} iconOnly />
              )}
              {rest.map((f) => (
                <FactChip key={f.id} fact={f} iconOnly />
              ))}
            </Fragment>
          );
        })}
      </span>
    </FactLedgerProvider>
  );
}
