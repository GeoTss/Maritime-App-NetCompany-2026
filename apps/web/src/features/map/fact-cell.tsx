/** A cited number from a route plan's facts as a chip, or a dash when the plan returned no fact. */
import type { Fact } from "@pharos/shared";
import { FactChip } from "@/components/fact-chip";
import { formatNumber, formatUtc, isIsoInstant } from "@/lib/format";

/** What a fact shows: its own digits, rounded for display; a time as "16 Nov 15:45Z". */
export function factText(fact: Fact, kind: "number" | "time" = "number"): string {
  if (typeof fact.value === "string" && (kind === "time" || isIsoInstant(fact.value)))
    return formatUtc(fact.value);
  if (typeof fact.value === "number") return formatNumber(fact.value, fact.unit);
  return String(fact.value);
}

export function FactCell({
  fact,
  kind = "number",
  metric,
  className,
}: {
  fact: Fact | undefined;
  kind?: "number" | "time";
  metric?: string;
  className?: string;
}) {
  return (
    <span data-testid={metric ? `cell-${metric}` : undefined} className={className}>
      {fact ? (
        <FactChip fact={fact}>{factText(fact, kind)}</FactChip>
      ) : (
        <span className="text-text-3" title="The plan returned no fact for this number">
          —
        </span>
      )}
    </span>
  );
}
