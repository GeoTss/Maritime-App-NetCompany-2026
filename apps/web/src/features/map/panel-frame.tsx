import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The chrome both side panels share: title block, close button, scrolling body. */
export function PanelFrame({
  title,
  subtitle,
  tags,
  onClose,
  children,
  footer,
  className,
  label,
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
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex min-h-0 flex-col rounded-sm border border-line bg-ink-900 text-xs",
        className,
      )}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-line p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-base font-semibold text-text-1 font-title">{title}</h2>
          {subtitle ? <div className="text-text-2">{subtitle}</div> : null}
          {tags ? <div className="flex flex-wrap gap-1">{tags}</div> : null}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Close ${label}`} onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 flex-col gap-1.5 border-t border-line p-3">
          {footer}
        </footer>
      ) : null}
    </section>
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
