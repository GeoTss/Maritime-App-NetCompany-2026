/**
 * The inbox: supplier emails on the left, and for the open one the email text beside the quote
 * read from it. Reads are GETs; the only POSTs are the operator's explicit inputs: deliver the
 * next demo email, upload an .eml, retry, and (behind a dialog) accept or reject a held quote.
 */
import { Mail01Icon, MailAdd01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DeliverResult,
  InboxItem,
  InboxItemDetail,
  listOf,
  type ReviewCorrection,
  ReviewDecision,
  ReviewItem,
  ReviewReference,
  UploadResult,
} from "@pharos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { type CommandGroupDef, useRegisterCommands } from "@/components/command-menu";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, describeFailure, isApiFailure } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { ChecksList } from "./checks-list";
import { DocumentView } from "./document-view";
import { ExtractionPanel } from "./extraction-panel";
import { InboxList, StatusBadge } from "./inbox-list";
import { ReviewForm } from "./review-form";
import { UploadDrop } from "./upload-drop";

const InboxItems = listOf(InboxItem);
const ReviewItems = listOf(ReviewItem);

const POLL_MS = 2500;

export function InboxPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedParam = Number(params.get("document"));
  const selected = Number.isInteger(selectedParam) && selectedParam > 0 ? selectedParam : null;
  const select = (id: number | null) => setParams(id === null ? {} : { document: String(id) });

  const [empty, setEmpty] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);

  const list = useQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ signal }) => api.get("/api/inbox", InboxItems, { signal }),
    refetchInterval: (q) =>
      q.state.data?.items.some((i) => i.extractionStatus === "pending") ? POLL_MS : false,
  });
  const items = list.data?.items ?? [];

  // "Quote extracted" when an email this session saw pending finishes reading.
  const seen = useRef(new Map<number, string>());
  useEffect(() => {
    for (const item of items) {
      const before = seen.current.get(item.documentId);
      if (before === "pending" && item.extractionStatus !== "pending") {
        if (item.extractionStatus === "failed") toast.error("Extraction failed");
        else if (item.extractionStatus === "not_a_quote") toast("Read as not a quote");
        else toast.success("Quote extracted");
      }
      seen.current.set(item.documentId, item.extractionStatus);
    }
  }, [items]);

  const detail = useQuery({
    queryKey: queryKeys.inboxItem(selected ?? 0),
    enabled: selected !== null,
    queryFn: ({ signal }) => api.get(`/api/inbox/${selected}`, InboxItemDetail, { signal }),
    refetchInterval: (q) => (q.state.data?.extractionStatus === "pending" ? POLL_MS : false),
  });
  const needsReview = detail.data?.extractionStatus === "needs_review";

  const review = useQuery({
    queryKey: queryKeys.review,
    enabled: needsReview,
    queryFn: ({ signal }) => api.get("/api/review", ReviewItems, { signal }),
  });
  const reference = useQuery({
    queryKey: queryKeys.reviewReference,
    enabled: needsReview,
    queryFn: ({ signal }) => api.get("/api/review/reference", ReviewReference, { signal }),
  });
  const reviewItem = review.data?.items.find((r) => r.documentId === selected) ?? null;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.inbox });
    await client.invalidateQueries({ queryKey: queryKeys.review });
  };

  const deliver = useMutation({
    mutationFn: () => api.post("/api/inbox/deliver-next", {}, DeliverResult),
    onSuccess: async (result) => {
      if (result.remaining === 0) setEmpty("All demo emails have been delivered.");
      const fresh = await client.fetchQuery({
        queryKey: queryKeys.inbox,
        queryFn: ({ signal }) => api.get("/api/inbox", InboxItems, { signal }),
        staleTime: 0,
      });
      const arrived = fresh.items.find((i) => i.documentId === result.documentId);
      toast.success(result.duplicate ? "Email was already in the inbox" : "Email delivered", {
        description: arrived?.subject ?? `Document ${result.documentId}`,
      });
      select(result.documentId);
    },
    onError: (err) => {
      if (isApiFailure(err) && err.error === "inbox_empty") {
        setEmpty("No demo emails left to deliver.");
        return;
      }
      toast.error("Could not deliver the next email", { description: describeFailure(err) });
    },
  });

  const deliverNext = deliver.mutate;
  const deliverPending = deliver.isPending;

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.upload("/api/inbox/upload", file, "message/rfc822", UploadResult),
    onSuccess: async (result) => {
      await refresh();
      toast.success(result.duplicate ? "Email was already in the inbox" : "Email delivered");
      select(result.documentId);
    },
    onError: (err) =>
      toast.error("Could not upload that email", { description: describeFailure(err) }),
  });

  const afterDecision = async (message: string, documentId: number | null) => {
    await refresh();
    if (documentId !== null) {
      await client.invalidateQueries({ queryKey: queryKeys.inboxItem(documentId) });
    }
    toast.success(message);
  };

  const accept = useMutation({
    mutationFn: (v: { extractionId: number; body: ReviewCorrection }) =>
      api.post(`/api/review/${v.extractionId}/accept`, v.body, ReviewDecision),
    onSuccess: () => afterDecision("Correction accepted", selected),
    onError: (err) =>
      toast.error("Could not accept the correction", { description: describeFailure(err) }),
  });
  const reject = useMutation({
    mutationFn: (extractionId: number) =>
      api.post(`/api/review/${extractionId}/reject`, {}, ReviewDecision),
    onSuccess: () => afterDecision("Quote rejected", selected),
    onError: (err) =>
      toast.error("Could not reject the quote", { description: describeFailure(err) }),
  });
  const retry = useMutation({
    mutationFn: (extractionId: number) =>
      api.post(`/api/review/${extractionId}/retry`, {}, ReviewDecision),
    onSuccess: () => afterDecision("Reading the email again", selected),
    onError: (err) => toast.error("Could not retry", { description: describeFailure(err) }),
  });

  const commands = useMemo<CommandGroupDef>(
    () => ({
      id: "inbox",
      heading: "Inbox",
      items: [
        {
          id: "inbox-deliver-next",
          label: "Deliver next email",
          keywords: ["inbox", "demo", "supplier", "quote"],
          icon: MailAdd01Icon,
          onSelect: () => {
            if (!empty && !deliverPending) deliverNext();
          },
        },
      ],
    }),
    [empty, deliverPending, deliverNext],
  );
  useRegisterCommands(commands);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[19rem_minmax(0,1fr)]">
      <aside
        aria-label="Inbox"
        className="flex min-h-0 flex-col gap-2 overflow-auto border-r border-line py-3"
      >
        <div className="flex flex-col gap-2 px-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-title text-lg font-medium text-text-1">Inbox</h1>
            <DataTag kind="simulated" />
          </div>
          <Button disabled={deliver.isPending || empty !== null} onClick={() => deliver.mutate()}>
            <HugeiconsIcon icon={MailAdd01Icon} strokeWidth={2} data-icon="inline-start" />
            Deliver next email
          </Button>
          {empty ? (
            <p data-testid="deliver-reason" className="text-xs text-text-2">
              {empty}
            </p>
          ) : null}
          <UploadDrop busy={upload.isPending} onFile={(f) => upload.mutate(f)} />
        </div>

        {list.isPending ? (
          <div className="flex flex-col gap-1 px-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : list.isError ? (
          <ErrorState
            error={list.error}
            title="The inbox could not be loaded"
            onRetry={() => list.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Mail01Icon}
            title="No emails yet"
            description="Deliver the next demo email or drop an .eml file to see the quote read from it."
          />
        ) : (
          <InboxList items={items} selected={selected} onSelect={select} />
        )}
      </aside>

      <div className="min-h-0 min-w-0 overflow-auto">
        {selected === null ? (
          <EmptyState
            icon={Mail01Icon}
            title="Open an email"
            description="Its text appears here beside the quote read from it. Hover a value to see the sentence it came from."
          />
        ) : detail.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-40" />
          </div>
        ) : detail.isError ? (
          <ErrorState
            error={detail.error}
            title="This email could not be opened"
            onRetry={() => detail.refetch()}
          />
        ) : (
          <DetailView
            key={detail.data.documentId}
            detail={detail.data}
            evidence={evidence}
            onEvidence={setEvidence}
            reviewItem={reviewItem}
            reviewLoading={needsReview && (review.isPending || reference.isPending)}
            reviewError={review.error ?? reference.error}
            reference={reference.data ?? null}
            busy={accept.isPending || reject.isPending}
            retrying={retry.isPending}
            onAccept={(body) =>
              reviewItem && accept.mutate({ extractionId: reviewItem.extractionId, body })
            }
            onReject={() => reviewItem && reject.mutate(reviewItem.extractionId)}
            onRetry={(id) => retry.mutate(id)}
          />
        )}
      </div>
    </div>
  );
}

type DetailData = InboxItemDetail;

function DetailView({
  detail,
  evidence,
  onEvidence,
  reviewItem,
  reviewLoading,
  reviewError,
  reference,
  busy,
  retrying,
  onAccept,
  onReject,
  onRetry,
}: {
  detail: DetailData;
  evidence: string | null;
  onEvidence: (e: string | null) => void;
  reviewItem: ReviewItem | null;
  reviewLoading: boolean;
  reviewError: unknown;
  reference: ReviewReference | null;
  busy: boolean;
  retrying: boolean;
  onAccept: (body: ReviewCorrection) => void;
  onReject: () => void;
  onRetry: (extractionId: number) => void;
}) {
  const status = detail.extractionStatus;
  const extractionId = detail.extractionId;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <StatusBadge status={status} />
        {status === "pending" ? (
          <span role="status" className="text-xs text-text-2">
            Reading the email. This usually takes a few seconds.
          </span>
        ) : null}
      </div>

      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-line">
        <div className="min-h-0 max-lg:max-h-[24rem] lg:max-h-[calc(100vh-14rem)] lg:overflow-hidden">
          <DocumentView
            subject={detail.subject}
            sender={detail.sender}
            bodyText={detail.bodyText}
            evidence={evidence}
          />
        </div>
        <div className="min-w-0">
          <h2 className="border-b border-line px-3 py-2 font-title text-sm font-medium text-text-1">
            Quote read from the email
          </h2>
          {detail.extraction ? (
            <ExtractionPanel
              extraction={detail.extraction}
              bodyText={detail.bodyText}
              onEvidence={onEvidence}
            />
          ) : status === "failed" ? (
            <div role="alert" className="flex flex-col items-start gap-2 px-3 py-3 text-xs">
              <p className="font-medium text-alarm">No quote could be read from this email</p>
              <p className="max-w-[60ch] text-text-2 [overflow-wrap:anywhere]">
                {detail.error ?? "The extraction stopped without a message."}
              </p>
              <Button
                variant="outline"
                disabled={extractionId === null || retrying}
                onClick={() => extractionId !== null && onRetry(extractionId)}
              >
                <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} data-icon="inline-start" />
                Retry extraction
              </Button>
              {extractionId === null ? (
                <p className="text-text-3">There is no extraction to retry for this email.</p>
              ) : null}
            </div>
          ) : status === "pending" ? (
            <p className="px-3 py-3 text-xs text-text-2">The quote will appear here when read.</p>
          ) : (
            <p className="px-3 py-3 text-xs text-text-2">Nothing was extracted from this email.</p>
          )}
          <h2 className="border-y border-line px-3 py-2 font-title text-sm font-medium text-text-1">
            Checks
          </h2>
          <ChecksList checks={detail.checkResults} />
        </div>
      </div>

      {status === "needs_review" ? (
        <div className="border-t border-line">
          {reviewLoading ? (
            <Skeleton className="m-3 h-32" />
          ) : reviewError ? (
            <ErrorState error={reviewError} title="The review form could not be loaded" />
          ) : reviewItem && reference ? (
            <ReviewForm
              detail={detail}
              review={reviewItem}
              reference={reference}
              busy={busy}
              onAccept={onAccept}
              onReject={onReject}
            />
          ) : (
            <EmptyState
              title="This quote is no longer waiting for review"
              description="Another decision already settled it. Reopen the email to see its new status."
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
