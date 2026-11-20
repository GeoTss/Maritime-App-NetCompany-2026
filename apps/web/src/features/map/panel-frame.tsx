import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The chrome both side panels share: title block, close button, scrolling body. A foldable panel
 * (`fold` given, e.g. while the route tray is open) can fold to its header row: the title, Expand
 * and Close; the body and the action are kept, only hidden.
 */
export function PanelFrame({
  title,
  subtitle,
  tags,
  onClose,
  children,
  footer,
  className,
  label,
  fold,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  tags?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling body: the panel's action. */
  footer?: ReactNode;
  className?: string;
  label: string;
  /** Present when the panel can fold: whether it is folded, and the change the operator asks for. */
  fold?: { folded: boolean; onFoldedChange: (folded: boolean) => void };
}) {
  const folded = fold?.folded ?? false;
  return (
    <Collapsible asChild open={!folded} onOpenChange={(open) => fold?.onFoldedChange(!open)}>
      <section
        aria-label={label}
        data-folded={folded}
        className={cn(
          "flex min-h-0 flex-col rounded-sm border border-line bg-ink-900 text-xs",
          className,
        )}
      >
        <header
          className={cn(
            "flex shrink-0 items-start gap-2 p-3",
            folded ? "items-center" : "border-b border-line",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2
              tabIndex={-1}
              className="truncate text-base font-medium text-text-1 outline-none font-title"
            >
              {title}
            </h2>
            {subtitle && !folded ? <div className="text-text-2">{subtitle}</div> : null}
            {tags && !folded ? <div className="flex flex-wrap gap-1">{tags}</div> : null}
          </div>
          {fold ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-text-2">
                {folded ? "Expand" : "Fold"}
              </Button>
            </CollapsibleTrigger>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label={`Close ${label}`} onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        </header>
        <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">{children}</div>
          {footer ? (
            <footer className="flex shrink-0 flex-col gap-1.5 border-t border-line p-3">
              {footer}
            </footer>
          ) : null}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-text-3 font-label">{label}</dt>
      <dd className="min-w-0 text-right text-text-1">{children}</dd>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-2xs font-medium text-text-2 font-label">{title}</h3>
      {children}
    </div>
  );
}
