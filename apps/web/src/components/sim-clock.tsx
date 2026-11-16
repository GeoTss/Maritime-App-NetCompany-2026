import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUtc, formatUtcTime } from "@/lib/format";
import { useSimClock } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The demo world's clock, as `GET /api/clock` reports it (UTC). "pinned" when the stack runs on a
 * frozen demo anchor. Until the API answers, a quiet placeholder: the console never shows its
 * own wall-clock time in its place.
 */
export function SimClock({ className }: { className?: string }) {
  const { data } = useSimClock();

  if (!data) {
    return (
      <span
        role="img"
        aria-label="Simulation clock not available yet"
        className={cn(
          "inline-flex h-6 items-center px-1.5 font-mono text-xs text-text-3",
          className,
        )}
      >
        --:--Z
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip explains the clock on focus.
          tabIndex={0}
          data-pinned={data.pinned}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-sm px-1.5 text-xs outline-none",
            "focus-visible:ring-2 focus-visible:ring-beacon/40",
            className,
          )}
        >
          <span className="text-text-3 font-label">sim</span>
          <time dateTime={data.now} className="font-mono text-text-1">
            {formatUtcTime(data.now)}
          </time>
          {data.pinned ? <span className="text-caution">pinned</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
        <span>Simulation clock, {formatUtc(data.now)}.</span>
        <span className="text-text-2">
          {data.pinned
            ? `Pinned to the demo anchor ${formatUtc(data.anchor)}: the world does not move.`
            : `World seeded at ${formatUtc(data.anchor)}; the clock follows real time.`}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
