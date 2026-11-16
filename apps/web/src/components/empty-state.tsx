import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What goes here, and the one thing to do about it. Left-aligned, in the flow of the panel. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: IconSvgElement;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-[52ch] flex-col items-start gap-2 p-3", className)}>
      <div className="flex items-center gap-2">
        {icon ? (
          <HugeiconsIcon icon={icon} strokeWidth={1.75} className="size-4 text-text-3" />
        ) : null}
        <h2 className="text-sm font-medium text-text-1">{title}</h2>
      </div>
      {description ? <div className="text-xs/relaxed text-text-2">{description}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
