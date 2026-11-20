import NumberFlow from "@number-flow/react";
import { formatNumber, numberFormatOptions, unitAffixes } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A number that changes state (ships at anchor, waiting hours, fuel on board, traffic count),
 * animated between values the API returned. Static text under `prefers-reduced-motion`.
 * Never use it for a cited fact: fact chips are static text (see `FactChip`).
 */
export function MetricNumber({
  value,
  unit,
  className,
}: {
  value: number;
  unit: string | null;
  className?: string;
}) {
  const reduce = usePrefersReducedMotion();
  const text = formatNumber(value, unit);
  const classes = cn("tabular-nums", className);
  if (reduce || !Number.isFinite(value)) {
    return <span className={classes}>{text}</span>;
  }
  const { prefix, suffix } = unitAffixes(unit);
  return (
    <span className={classes} role="img" aria-label={text}>
      <NumberFlow
        value={value}
        locales="en-GB"
        format={numberFormatOptions(unit, value)}
        prefix={prefix || undefined}
        suffix={suffix || undefined}
        aria-hidden
      />
    </span>
  );
}
