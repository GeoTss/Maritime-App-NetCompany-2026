/**
 * Which stored plan the map is drawing, from the address, with Clear. A plan that could not be
 * read says so in the same place (an alert), and Clear still drops it; the rest of the map keeps
 * working.
 */
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { describeFailure, isApiFailure } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PlanChip({
  label,
  onClear,
  failed = false,
  className,
}: {
  /** "Showing bunker plan 1 · 3 options", "Showing route plan 2", or why it is not shown. */
  label: string;
  onClear: () => void;
  /** The plan could not be read: the chip is an alert. */
  failed?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "flex min-h-7 w-fit max-w-full items-center gap-2 rounded-sm border bg-ink-900 py-0.5 pr-0.5 pl-2.5 text-xs text-text-1",
        failed ? "border-alarm/60" : "border-beacon/60",
        className,
      )}
    >
      <span id={id} className="min-w-0">
        {label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Clear the plan from the map"
        aria-describedby={id}
        onClick={onClear}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
      </Button>
    </div>
  );
}

/** What the chip says while a stored plan is loading, after it failed, or once it is drawn. */
export function planChipText(
  kind: "route" | "bunker",
  id: number,
  query: { isPending: boolean; error: unknown },
  shown: string,
): { label: string; failed: boolean } {
  const noun = kind === "route" ? "route plan" : "bunker plan";
  if (query.error) {
    if (isApiFailure(query.error) && query.error.status === 404)
      return { label: `Plan ${id} could not be found.`, failed: true };
    return {
      label: `Plan ${id} could not be loaded: ${describeFailure(query.error)}`,
      failed: true,
    };
  }
  if (query.isPending) return { label: `Loading ${noun} ${id}…`, failed: false };
  return { label: shown, failed: false };
}
