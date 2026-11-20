import { Alert02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { describeFailure, isApiFailure } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A read that failed: what failed, the API's own code (so a replay miss or a schema mismatch is
 * recognisable), and a retry when one makes sense.
 */
export function ErrorState({
  error,
  title = "This could not be loaded",
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const code = isApiFailure(error)
    ? `${error.error}${error.status ? `, HTTP ${error.status}` : ""}`
    : null;
  return (
    <div role="alert" className={cn("flex max-w-[60ch] flex-col items-start gap-2 p-3", className)}>
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={1.75} className="size-4 text-alarm" />
        <h2 className="text-sm font-medium text-text-1">{title}</h2>
      </div>
      <p className="text-xs/relaxed text-text-2">{describeFailure(error)}</p>
      {code ? <span className="font-mono text-2xs text-text-3">{code}</span> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} data-icon="inline-start" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
