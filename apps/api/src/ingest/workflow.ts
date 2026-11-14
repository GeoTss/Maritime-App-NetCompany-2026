/**
 * The ingestion workflow: fixed steps, no agent.
 *
 *   ingestRaw:       parse -> dedupe by sha256 -> insert `documents` + a `pending` extraction
 *   processDocument: extract (LLM 1) -> record the call(s) -> checks in code (`evaluate.ts`)
 *                    -> quote or review
 *
 * The model only transcribes. Every stored number is parsed from the as-written text by
 * `packages/domain`, and every value must be backed by evidence found verbatim in the email.
 */
import { loadWorld, type Sql } from "@pharos/db";
import type { CheckResult, ExtractionOutput, Id, IsoDate } from "@pharos/shared";
import { type ExtractInput, ExtractionError, type Extractor } from "../ai/extract.js";
import { type CallMetrics, recordLlmCall } from "../ai/llm.js";
import { evaluateExtraction } from "./evaluate.js";
import { parseEmail } from "./parse-email.js";

export interface IngestDeps {
  sql: Sql;
  extractor: Extractor;
  /** Clock for row timestamps (and receivedAt when the email has no Date header). */
  now?: () => Date;
  /** Told about extractions that end `failed`; the message is stored on the row either way. */
  log?: (message: string) => void;
}

export type IngestSource = "upload" | "demo_inbox";

export interface IngestResult {
  documentId: Id;
  duplicate: boolean;
}

const clock = (deps: IngestDeps) => (deps.now ?? (() => new Date()))();

/** timestamptz parameter: postgres.js does not serialise a Date in an untyped position. */
const iso = (d: Date): string => d.toISOString();

/** jsonb parameter, sent as JSON text and cast with `::jsonb` at the call site. */
const json = (value: unknown): string => JSON.stringify(value);

/** A quote date (ISO day) as a timestamptz parameter: UTC midnight of that day, or null. */
const dayStart = (day: IsoDate | null): string | null =>
  day === null ? null : `${day}T00:00:00.000Z`;

/**
 * Stores a new email and its `pending` extraction, or returns the existing document for the same
 * bytes (`duplicate: true`). The caller starts `processDocument` for a new document.
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
      insert into documents (kind, source, sha256, sender, subject, filename, body_text, received_at)
      values ('email', ${source}, ${email.sha256}, ${email.sender}, ${email.subject}, null,
              ${email.bodyText}, ${iso(email.receivedAt ?? now)}::timestamptz)
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

interface PendingRow {
  extraction_id: number;
  status: string;
  sender: string | null;
  subject: string | null;
  body_text: string;
  /** postgres.js returns timestamptz as text. */
  received_at: string;
  has_unreadable_attachment: boolean;
}

/**
 * Runs extraction and checks for a document whose latest extraction is `pending`; a no-op
 * otherwise. Never rejects: any error leaves the extraction `failed` with its message.
 */
export async function processDocument(deps: IngestDeps, documentId: Id): Promise<void> {
  const { sql } = deps;
  let extractionId: number | undefined;
  let rawOutput: ExtractionOutput | null = null;
  try {
    const [row] = await sql<PendingRow[]>`
      select e.id as extraction_id, e.status, d.sender, d.subject, d.body_text, d.received_at,
             d.has_unreadable_attachment
      from documents d join extractions e on e.document_id = d.id
      where d.id = ${documentId}
      order by e.id desc limit 1`;
    if (row?.status !== "pending") return;
    extractionId = row.extraction_id;
    const doc: ExtractInput = { sender: row.sender, subject: row.subject, bodyText: row.body_text };

    const output = await extractAndRecord(deps, documentId, doc);
    rawOutput = output;
    const world = await loadWorld(sql);
    const result = evaluateExtraction(world, doc, output, {
      receivedAt: new Date(row.received_at),
      hasUnreadableAttachment: row.has_unreadable_attachment,
    });
    await sql.begin(async (tx) => {
      let quoteId: number | null = null;
      if (result.status === "extracted") {
        const q = result.quote;
        const [quote] = await tx<{ id: number }[]>`
          insert into quotes (supplier_id, port_id, requirement_id, delivery_from, delivery_to,
                              valid_until, currency, barge_fee, status, extraction_id, received_at)
          values (${q.supplierId}, ${q.portId}, ${q.requirementId},
                  ${dayStart(q.deliveryFrom)}::timestamptz, ${dayStart(q.deliveryTo)}::timestamptz,
                  ${dayStart(q.validUntil)}::timestamptz,
                  ${q.currency}, ${q.bargeFee}, 'received', ${row.extraction_id}, ${row.received_at}::timestamptz)
          returning id`;
        if (!quote) throw new Error("quotes insert returned no row");
        quoteId = quote.id;
        for (const line of q.lines) {
          await tx`
            insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
            values (${quoteId}, ${line.grade}, ${line.qtyMt}, ${line.pricePerMt})`;
        }
      }
      await tx`
        update extractions set
          kind = ${output.kind},
          raw_output = ${json(output)}::jsonb,
          field_evidence = ${json(result.fieldEvidence)}::jsonb,
          check_results = ${json(result.checks)}::jsonb,
          status = ${result.status}
        where id = ${row.extraction_id}`;
      return quoteId;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (extractionId === undefined) {
      deps.log?.(`[ingest] document ${documentId}: could not start processing: ${message}`);
      return;
    }
    deps.log?.(`[ingest] document ${documentId}: extraction failed: ${message}`);
    const failed: CheckResult[] = [{ check: "processing", passed: false, detail: message }];
    try {
      await sql`
        update extractions set
          status = 'failed',
          kind = ${rawOutput?.kind ?? null},
          raw_output = ${rawOutput === null ? null : json(rawOutput)}::jsonb,
          check_results = ${json(failed)}::jsonb
        where id = ${extractionId}`;
    } catch (writeErr) {
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
    for (const m of calls) await recordLlmCall(deps.sql, "extract", m, { documentId });
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
