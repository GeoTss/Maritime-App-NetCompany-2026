/**
 * A side-column section that opens on request: its title is the switch. Used for "Fuel on board"
 * and "Danger areas" in the Needs you column, so the items that need you come first.
 */
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function FoldSection({
  label,
  title,
  open,
  onOpenChange,
  aside,
  className,
  children,
}: {
  /** The section's accessible name. */
  label: string;
  title: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Beside the title, open or closed (a data tag, a count). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <section aria-label={label} className={cn("px-3 py-2", className)}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-beacon/50"
            >
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={12}
                strokeWidth={2}
                className={cn(
                  "transition-transform motion-reduce:transition-none",
                  open && "rotate-90",
                )}
              />
              {title}
            </button>
          </CollapsibleTrigger>
          {aside}
        </div>
        <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
