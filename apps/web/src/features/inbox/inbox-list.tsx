import type { InboxItem } from "@pharos/shared";
import { Badge } from "@/components/ui/badge";
import { UntrustedText } from "@/components/untrusted-text";
import { formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = InboxItem["extractionStatus"];

/**
 * Each status in words and its hue. "Accepted" is a quote a person fixed before accepting it: it
 * keeps the review hue (caution) with a tinted border, so it never reads as a clean extraction.
 */
export const STATUS_LABEL: Record<Status, { label: string; tone: string }> = {
  pending: { label: "Reading", tone: "text-text-2" },
  extracted: { label: "Extracted", tone: "text-go" },
  needs_review: { label: "Needs review", tone: "text-caution" },
  accepted: { label: "Accepted after fix", tone: "border-caution/50 text-caution" },
  not_a_quote: { label: "Not a quote", tone: "text-text-2" },
  failed: { label: "Extraction failed", tone: "text-alarm" },
  rejected: { label: "Rejected", tone: "text-text-2" },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_LABEL[status];
  return (
    <Badge data-status={status} className={s.tone}>
      {s.label}
    </Badge>
  );
}

/** Bordered rows, in the order the API returns them. Selecting a row opens it; nothing else. */
export function InboxList({
  items,
  selected,
  onSelect,
}: {
  items: InboxItem[];
  selected: number | null;
  onSelect: (documentId: number) => void;
}) {
  return (
    <ul aria-label="Emails" className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <li key={item.documentId}>
          <button
            type="button"
            aria-current={selected === item.documentId}
            onClick={() => onSelect(item.documentId)}
            className={cn(
              "flex w-full flex-col items-start gap-1 px-3 py-2 text-left outline-none",
              "hover:bg-ink-850 focus-visible:bg-ink-850 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
              selected === item.documentId && "bg-ink-850 shadow-[inset_1px_0_0_var(--beacon)]",
            )}
          >
            <span className="w-full truncate text-xs font-medium text-text-1">
              <UntrustedText text={item.subject} fallback="(no subject)" />
            </span>
            <span className="w-full truncate text-xs text-text-2">
              <UntrustedText text={item.sender} fallback="unknown sender" />
            </span>
            <span className="flex w-full items-center justify-between gap-2">
              <StatusBadge status={item.extractionStatus} />
              <span className="font-mono text-2xs text-text-3">{formatUtc(item.receivedAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
