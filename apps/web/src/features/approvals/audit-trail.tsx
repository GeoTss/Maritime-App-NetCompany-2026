/**
 * The audit rows of one proposal, oldest first as the API returned them. Each event's detail is
 * shown as labelled key and value pairs (text only, values exactly as returned), not as JSON.
 */
import { AuditEventList } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatUtc } from "@/lib/format";
import { queryKeys } from "@/lib/queries";

export const auditKey = (recommendationId: number) =>
  [...queryKeys.audit, recommendationId] as const;

/** Labels for the detail keys the executor writes; others are made readable from camelCase. */
const KEY_LABEL: Record<string, string> = {
  erpPoNumber: "ERP PO number",
  idempotencyKey: "Idempotency key",
  calculationId: "Calculation",
  candidateId: "Route",
  instructionId: "Instruction",
  orderId: "Order",
  quoteId: "Quote",
  kinds: "Drafted",
  duplicate: "Duplicate push",
};

export function detailLabel(key: string): string {
  const known = KEY_LABEL[key];
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One detail value as text: as returned, lists joined, yes/no for flags. Display only. */
export function detailValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.map(detailValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The detail's pairs, in the order the API wrote them; a non-object detail is one "Detail" pair. */
export function detailPairs(detail: unknown): { key: string; label: string; value: string }[] {
  if (detail === null || detail === undefined) return [];
  if (typeof detail !== "object" || Array.isArray(detail)) {
    return [{ key: "detail", label: "Detail", value: detailValue(detail) }];
  }
  return Object.entries(detail as Record<string, unknown>).map(([key, value]) => ({
    key,
    label: detailLabel(key),
    value: detailValue(value),
  }));
}

export function AuditTrail({
  recommendationId,
  heading = true,
  emptyText = null,
}: {
  recommendationId: number;
  /** False inside a disclosure that already names the trail. */
  heading?: boolean;
  /** Said when no event is recorded yet; null shows nothing. */
  emptyText?: string | null;
}) {
  const audit = useQuery({
    queryKey: auditKey(recommendationId),
    queryFn: ({ signal }) =>
      api.get(`/api/audit?recommendationId=${recommendationId}`, AuditEventList, { signal }),
  });
  if (audit.isError) {
    return <p className="text-xs text-text-2">The audit trail could not be loaded.</p>;
  }
  const items = audit.data?.items ?? [];
  if (items.length === 0) {
    return audit.isSuccess && emptyText ? <p className="text-xs text-text-2">{emptyText}</p> : null;
  }
  return (
    <section aria-label="Audit trail" className="flex flex-col gap-1">
      {heading ? <h4 className="text-xs text-text-2 font-label">Audit trail</h4> : null}
      <ol className="flex flex-col border border-line">
        {items.map((e) => {
          const pairs = detailPairs(e.detail);
          return (
            <li
              key={e.id}
              className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 border-b border-line px-2 py-1 text-xs last:border-b-0 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
            >
              <time dateTime={e.at} className="text-2xs text-text-3">
                {formatUtc(e.at)}
              </time>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-text-1">
                  {e.kind} <span className="text-text-2">by {e.actor}</span>
                </span>
                {pairs.length > 0 ? (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-2xs">
                    {pairs.map((p) => (
                      <div key={p.key} className="contents">
                        <dt className="text-text-2 font-label">{p.label}</dt>
                        <dd className="min-w-0 font-mono break-words text-text-1">{p.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
