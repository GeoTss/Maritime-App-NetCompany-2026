/**
 * The messages the executor drafted. Read-only: Pharos never sends anything, so there is no send
 * control here. Subjects and bodies are text only.
 */
import { DraftedMessage, IsoDateTime, listOf } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { DataTag } from "@/components/source-badge";
import { UntrustedText } from "@/components/untrusted-text";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

/** The wire form: the API serialises the timestamp as an ISO string. */
const DraftView = DraftedMessage.omit({ createdAt: true }).extend({ createdAt: IsoDateTime });
const DraftList = listOf(DraftView);

const KIND: Record<z.infer<typeof DraftView>["kind"], string> = {
  supplier_confirmation: "To the supplier",
  master_instruction: "To the master",
};

export function DraftsList({ recommendationId }: { recommendationId: number }) {
  const drafts = useQuery({
    queryKey: queryKeys.drafts(recommendationId),
    queryFn: ({ signal }) =>
      api.get(`/api/recommendations/${recommendationId}/drafts`, DraftList, { signal }),
  });
  const items = drafts.data?.items ?? [];
  if (drafts.isError) {
    return <p className="text-xs text-text-3">The drafted messages could not be loaded.</p>;
  }
  if (items.length === 0) return null;
  return (
    <section aria-label="Drafted messages" className="flex flex-col gap-2">
      <h4 className="text-xs text-text-2 font-label">Drafted messages</h4>
      {items.map((d) => (
        <article key={d.id} className="flex flex-col gap-1 border border-line bg-ink-950 p-2">
          <header className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-text-2">{KIND[d.kind]}</span>
            <DataTag kind="draft" className="ml-auto" />
          </header>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs">
            <dt className="text-text-3">To</dt>
            <dd className="min-w-0 break-words text-text-1">
              <UntrustedText text={d.to} />
            </dd>
            <dt className="text-text-3">Subject</dt>
            <dd className="min-w-0 break-words text-text-1">
              <UntrustedText text={d.subject} />
            </dd>
          </dl>
          <UntrustedText
            text={d.body}
            className="max-w-[72ch] whitespace-pre-wrap break-words text-xs/relaxed text-text-2"
          />
        </article>
      ))}
    </section>
  );
}
