/** The audit rows of one proposal, oldest first as the API returned them. Text only. */
import { AuditEventList } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatUtc } from "@/lib/format";
import { queryKeys } from "@/lib/queries";

export const auditKey = (recommendationId: number) =>
  [...queryKeys.audit, recommendationId] as const;

/** A compact one-line view of an event's detail. Display only. */
const detailText = (detail: unknown) =>
  detail === null || detail === undefined ? "" : JSON.stringify(detail);

export function AuditTrail({ recommendationId }: { recommendationId: number }) {
  const audit = useQuery({
    queryKey: auditKey(recommendationId),
    queryFn: ({ signal }) =>
      api.get(`/api/audit?recommendationId=${recommendationId}`, AuditEventList, { signal }),
  });
  if (audit.isError) {
    return <p className="text-xs text-text-3">The audit trail could not be loaded.</p>;
  }
  const items = audit.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label="Audit trail" className="flex flex-col gap-1">
      <h4 className="text-xs text-text-2 font-label">Audit trail</h4>
      <ol className="flex flex-col border border-line">
        {items.map((e) => (
          <li
            key={e.id}
            className="grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 border-b border-line px-2 py-1 text-xs last:border-b-0 sm:grid-cols-[6.5rem_auto_minmax(0,1fr)]"
          >
            <time dateTime={e.at} className="font-mono text-2xs text-text-3">
              {formatUtc(e.at)}
            </time>
            <span className="text-text-1">{e.kind}</span>
            <span className="min-w-0 break-words text-text-3 sm:col-start-3">
              {e.actor}
              {detailText(e.detail) ? (
                <span className="font-mono text-2xs"> {detailText(e.detail)}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
