import { cn } from "@/lib/utils";

/**
 * Text that came from outside: AIS ship names and destinations, hazard labels, email bodies and
 * evidence sentences. Rendered as a React text node only (never markup), inside `<bdi>` so a
 * right-to-left or bidi-override character cannot reorder the line around it.
 */
export function UntrustedText({
  text,
  className,
  fallback = "—",
  title,
}: {
  text: string | null | undefined;
  className?: string;
  /** Shown when there is no text, so a missing value is visible rather than a silent gap. */
  fallback?: string;
  /** Hover text; defaults to the text itself when the caller truncates it. */
  title?: string;
}) {
  if (text === null || text === undefined || text === "") {
    return <span className={cn("text-text-3", className)}>{fallback}</span>;
  }
  return (
    <bdi className={className} title={title} data-untrusted="">
      {text}
    </bdi>
  );
}
