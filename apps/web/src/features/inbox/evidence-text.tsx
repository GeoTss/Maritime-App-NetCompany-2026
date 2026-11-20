/**
 * The source text with one evidence sentence marked. Matching is a plain string search on what
 * the API returned, tolerant of whitespace only (an HTML email arrives as converted text where
 * line breaks and spacing may differ from the model's quote). Nothing is rendered as markup:
 * the three pieces are React text nodes.
 */
import { useEffect, useRef } from "react";

export interface Span {
  start: number;
  end: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `evidence` sits in `source`, or null when it does not (the caller flags that). */
export function locateEvidence(source: string, evidence: string | null | undefined): Span | null {
  if (!evidence) return null;
  const exact = source.indexOf(evidence);
  if (exact >= 0) return { start: exact, end: exact + evidence.length };
  const words = evidence.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const match = new RegExp(words.map(escapeRegExp).join("\\s+")).exec(source);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

export function EvidenceText({
  text,
  evidence,
}: {
  text: string;
  /** The sentence to mark; null leaves the text plain. */
  evidence: string | null;
}) {
  const markRef = useRef<HTMLElement>(null);
  const span = locateEvidence(text, evidence);
  const start = span?.start ?? null;

  useEffect(() => {
    if (start !== null) markRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [start]);

  if (!span) return <bdi>{text}</bdi>;
  return (
    <bdi>
      {text.slice(0, span.start)}
      <mark
        ref={markRef}
        data-testid="evidence-mark"
        className="rounded-sm bg-beacon/25 px-0.5 text-text-1 shadow-[inset_0_-1px_0_var(--beacon)]"
      >
        {text.slice(span.start, span.end)}
      </mark>
      {text.slice(span.end)}
    </bdi>
  );
}
