/**
 * The ingestion workflow: fixed steps, no agent.
 *
 *   ingestRaw:       parse (body + attachment text) -> dedupe by sha256
 *                    -> insert `documents` + a `pending` extraction
 *   processDocument: claim the latest extraction -> extract (LLM 1) -> record the call(s)
 *                    -> checks in code (`evaluate.ts`) -> quote or review
 *
 * The model only transcribes. Every stored number is parsed from the as-written text by
 * `packages/domain`, and every value must be backed by evidence found verbatim in the email.
 */
import { loadWorld, type Sql } from "@pharos/db";
import type { ExtractionOutput, Id, IsoDate } from "@pharos/shared";
import { type ExtractInput, ExtractionError, type Extractor } from "../ai/extract.js";
import { type CallMetrics, recordLlmCall } from "../ai/llm.js";
import { evaluateExtraction } from "./evaluate.js";
import { parseEmail } from "./parse-email.js";

export interface IngestDeps {
  sql: Sql;
  extractor: Extractor;
  /** Clock for row timestamps (and receivedAt when the email has no Date header). */
  now: () => Date;
  /** Told about extractions that end `failed`; the message is stored on the row either way. */
  log?: (message: string) => void;
}

export type IngestSource = "upload" | "demo_inbox";

export interface IngestResult {
  documentId: Id;
  duplicate: boolean;
}

const clock = (deps: IngestDeps) => deps.now();

/** timestamptz parameter: postgres.js does not serialise a Date in an untyped position. */
const iso = (d: Date): string => d.toISOString();

/** jsonb parameter, sent as JSON text and cast with `::jsonb` at the call site. */
const json = (value: unknown): string => JSON.stringify(value);

/** A quote date (ISO day) as a timestamptz parameter: UTC midnight of that day, or null. */
const dayStart = (day: IsoDate | null): string | null =>
  day === null ? null : `${day}T00:00:00.000Z`;

/**
 * Stores a new email and its `pending` extraction, or returns the existing document for the same
 * bytes (`duplicate: true`). The stored text is the body followed by each readable attachment's
 * section; an attachment that yielded no text sets `has_unreadable_attachment`. The caller starts
 * `processDocument` for a new document.
 */
export async function ingestRaw(
  deps: IngestDeps,
  raw: Uint8Array,
  source: IngestSource,
): Promise<IngestResult> {
  const { sql } = deps;
  const email = await parseEmail(raw);
  const existing = await sql<{ id: number }[]>`
    select id from documents where sha256 = ${email.sha256}`;
  if (existing[0]) return { documentId: existing[0].id, duplicate: true };

  const now = clock(deps);
  return sql.begin(async (tx) => {
    const inserted = await tx<{ id: number }[]>`
      insert into documents (kind, source, sha256, sender, subject, filename, body_text, received_at,
                             has_unreadable_attachment)
      values ('email', ${source}, ${email.sha256}, ${email.sender}, ${email.subject}, null,
              ${email.bodyText}, ${iso(email.receivedAt ?? now)}::timestamptz,
              ${email.hasUnreadableAttachment})
      on conflict (sha256) do nothing
      returning id`;
    const doc = inserted[0];
    if (!doc) {
      // Lost a race with a concurrent delivery of the same bytes.
      const [winner] = await tx<{ id: number }[]>`
        select id from documents where sha256 = ${email.sha256}`;
      if (!winner) throw new Error("document vanished after a sha256 conflict");
      return { documentId: winner.id, duplicate: true };
    }
    await tx`
      insert into extractions
        (document_id, kind, raw_output, field_evidence, check_results, status, model, prompt_version, created_at)
      values (${doc.id}, null, null, ${json({})}::jsonb, ${json([])}::jsonb, 'pending',
              ${deps.extractor.model}, ${deps.extractor.promptVersion}, ${iso(now)}::timestamptz)`;
    return { documentId: doc.id, duplicate: false };
  });
}

/** The error stored on an extraction the API was processing when it stopped. */
export const INTERRUPTED_ERROR = "interrupted: the API restarted during processing";

/**
 * Boot sweep: a `pending` extraction that was claimed can only still be pending if the process
 * that claimed it stopped mid-way, so it is marked `failed` (it then waits in the review queue
 * for a retry). Unclaimed pending extractions are left for `processDocument`. Assumes one API
 * process: run it before this process starts any processing. Returns how many rows it failed.
 */
export async function failInterruptedExtractions(sql: Sql): Promise<number> {
  const failed = await sql`
    update extractions set status = 'failed', error = ${INTERRUPTED_ERROR}
    where status = 'pending' and claimed_at is not null
    returning id`;
  return failed.length;
}

interface DocumentRow {
  sender: string | null;
  subject: string | null;
  body_text: string;
  /** postgres.js returns timestamptz as text. */
  received_at: string;
  has_unreadable_attachment: boolean;
}

/**
 * Claims the document's latest extraction in one statement, so of any number of concurrent
 * callers exactly one gets the row, and a row inserted meanwhile (a retry) is never passed over
 * for an older one. Returns the claimed extraction id, or undefined when the latest extraction
 * is not pending or is already claimed.
 */
async function claimLatestExtraction(
  sql: Sql,
  documentId: Id,
  now: Date,
): Promise<number | undefined> {
  const [claimed] = await sql<{ id: number }[]>`
    update extractions set claimed_at = ${iso(now)}::timestamptz
    where id = (select max(id) from extractions where document_id = ${documentId})
      and status = 'pending' and claimed_at is null
    returning id`;
  return claimed?.id;
}

/**
 * Runs extraction and checks for the document's latest extraction once this call has claimed
 * it; a no-op when that extraction is not pending or is already claimed (so the extractor is
 * never called twice for one row). Never rejects: an error after the claim leaves the
 * extraction `failed` with the message in `error`.
 *
 * Both final writes apply only while the row is still `pending`. If another writer (the boot
 * sweep, a reviewer) has already settled it, this call's result is discarded and logged: no
 * quote is stored and that row's status and error are kept.
 */
export async function processDocument(deps: IngestDeps, documentId: Id): Promise<void> {
  const { sql } = deps;
  let extractionId: number | undefined;
  let rawOutput: ExtractionOutput | null = null;
  const discarded = (what: string) =>
    deps.log?.(
      `[ingest] document ${documentId}: extraction ${extractionId} is no longer pending; ${what}`,
    );
  try {
    extractionId = await claimLatestExtraction(sql, documentId, clock(deps));
    if (extractionId === undefined) return;
    const claimedId = extractionId;
    const [row] = await sql<DocumentRow[]>`
      select sender, subject, body_text, received_at, has_unreadable_attachment
      from documents where id = ${documentId}`;
    if (!row) throw new Error(`document ${documentId} not found`);
    const doc: ExtractInput = { sender: row.sender, subject: row.subject, bodyText: row.body_text };

    const output = await extractAndRecord(deps, documentId, doc);
    rawOutput = output;
    const world = await loadWorld(sql);
    const result = evaluateExtraction(world, doc, output, {
      receivedAt: new Date(row.received_at),
      hasUnreadableAttachment: row.has_unreadable_attachment,
    });
    const stored = await sql.begin(async (tx) => {
      // The status write goes first and only while the row is pending: when it matches nothing,
      // the transaction has written nothing and no quote is inserted.
      const updated = await tx`
        update extractions set
          kind = ${output.kind},
          raw_output = ${json(output)}::jsonb,
          field_evidence = ${json(result.fieldEvidence)}::jsonb,
          check_results = ${json(result.checks)}::jsonb,
          status = ${result.status}
        where id = ${claimedId} and status = 'pending'
        returning id`;
      if (updated.length === 0) return false;
      if (result.status === "extracted") {
        const q = result.quote;
        const [quote] = await tx<{ id: number }[]>`
          insert into quotes (supplier_id, port_id, requirement_id, delivery_from, delivery_to,
                              valid_until, currency, barge_fee, status, extraction_id, received_at)
          values (${q.supplierId}, ${q.portId}, ${q.requirementId},
                  ${dayStart(q.deliveryFrom)}::timestamptz, ${dayStart(q.deliveryTo)}::timestamptz,
                  ${dayStart(q.validUntil)}::timestamptz,
                  ${q.currency}, ${q.bargeFee}, 'received', ${claimedId}, ${row.received_at}::timestamptz)
          returning id`;
        if (!quote) throw new Error("quotes insert returned no row");
        for (const line of q.lines) {
          await tx`
            insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
            values (${quote.id}, ${line.grade}, ${line.qtyMt}, ${line.pricePerMt})`;
        }
      }
      return true;
    });
    if (!stored) discarded(`its ${result.status} result was discarded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (extractionId === undefined) {
      deps.log?.(`[ingest] document ${documentId}: could not start processing: ${message}`);
      return;
    }
    deps.log?.(`[ingest] document ${documentId}: extraction failed: ${message}`);
    try {
      // check_results is left as inserted: nothing was stored, and the reason is in `error`.
      const marked = await sql`
        update extractions set
          status = 'failed',
          error = ${message},
          kind = ${rawOutput?.kind ?? null},
          raw_output = ${rawOutput === null ? null : json(rawOutput)}::jsonb
        where id = ${extractionId} and status = 'pending'
        returning id`;
      if (marked.length === 0) discarded("its failure was not recorded over its current status");
    } catch (writeErr) {
      // The row stays pending and claimed: the next boot sweep marks it failed.
      deps.log?.(
        `[ingest] document ${documentId}: could not mark extraction failed: ${(writeErr as Error).message}`,
      );
    }
  }
}

/** Calls the extractor and records every model call it made, also when it then failed. */
async function extractAndRecord(
  deps: IngestDeps,
  documentId: Id,
  doc: ExtractInput,
): Promise<ExtractionOutput> {
  const record = async (calls: CallMetrics[]) => {
    for (const m of calls) {
      await recordLlmCall(deps.sql, "extract", m, { documentId, at: clock(deps) });
    }
  };
  try {
    const { output, metrics } = await deps.extractor.extract(doc);
    await record(metrics);
    return output;
  } catch (err) {
    if (err instanceof ExtractionError) await record(err.metrics);
    throw err;
  }
}
