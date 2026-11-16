/**
 * The agent's "thinking" header over its trace (Beautiful UI's thinking-state pattern, composed
 * from shadcn `collapsible` and driven by real state rather than a timer). Open while working,
 * it can be folded; the trace itself is the children (usually `ToolChips`). No answer text
 * streams here: the release gate passes the answer before anything is shown.
 */
import {
  Alert02Icon,
  ArrowDown01Icon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ThinkingStatus = "working" | "done" | "failed";

const DEFAULT_LABEL: Record<ThinkingStatus, string> = {
  working: "Working",
  done: "Done",
  failed: "Stopped",
};

export function ThinkingState({
  status,
  label,
  children,
  className,
}: {
  status: ThinkingStatus;
  /** Overrides the status word, e.g. "Checking 3 tools" or "Answered in 4.6 s" (API timing). */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(status === "working");
  // Fold the trace once the work settles; the operator can reopen it.
  useEffect(() => {
    setOpen(status === "working");
  }, [status]);

  const icon = status === "working" ? Loading03Icon : status === "done" ? Tick02Icon : Alert02Icon;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("flex flex-col", className)}>
      <CollapsibleTrigger
        className={cn(
          "-mx-1 flex h-7 w-fit items-center gap-1.5 rounded-sm px-1 text-xs text-text-2",
          "outline-none hover:bg-ink-800 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-beacon/40",
        )}
      >
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          className={cn(
            "size-3.5",
            status === "working" && "animate-spin text-text-2 motion-reduce:animate-none",
            status === "done" && "text-text-3",
            status === "failed" && "text-alarm",
          )}
        />
        <span role="status" aria-live="polite">
          {label ?? DEFAULT_LABEL[status]}
        </span>
        {children ? (
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={cn(
              "size-3 text-text-3 transition-transform duration-150",
              open ? "rotate-180" : "rotate-0",
            )}
          />
        ) : null}
      </CollapsibleTrigger>
      {children ? (
        <CollapsibleContent className="ml-[7px] border-l border-line pl-3">
          {children}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
