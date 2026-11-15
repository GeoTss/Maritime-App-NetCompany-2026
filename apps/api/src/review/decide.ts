/**
 * The human review queue: list the extractions waiting for a person, and apply the person's
 * decision. The model only proposes; a quote is stored here only from the human's own values.
 *
 *   listReviewItems   latest extraction per document that is `needs_review` or `failed`
 *   acceptExtraction  store the quote from the human's values, mark the extraction `accepted`
 *   rejectExtraction  mark it `rejected`
 *   retryExtraction   `failed` only: a new `pending` extraction (the route starts processing)
 *
 * Every decision locks the extraction row and re-checks that it is still the document's latest
 * and still waiting, so two decisions on one row cannot both succeed.
 */
import { currentVoyage, loadWorld, openRequirements, type Sql } from "@pharos/db";
import {
  type CheckResult,
  ExtractionOutput,
  type Id,
  type NormalisedView,
  type ReviewCorrection,
  type ReviewDecision,
  type ReviewItem,
  type ReviewReference,
} from "@pharos/shared";
import { z } from "zod";
import { emptyNormalisedView, normaliseExtraction } from "../ingest/evaluate.js";
import type { IngestDeps } from "../ingest/workflow.js";

export type ReviewDeps = IngestDeps;

export type ReviewErrorCode = "not_found" | "conflict" | "unprocessable";

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

/** Who decided: there is no login in the prototype. */
export const REVIEWER = "operator";

/** The connection inside `sql.begin` (postgres.js `TransactionSql`). */
type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0];

const iso = (d: Date | string): string => new Date(d).toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const clock = (deps: ReviewDeps) => (deps.now ?? (() => new Date()))();
const dayStart = (day: string | null): string | null =>
  day === null ? null : `${day}T00:00:00.000Z`;

const REVIEWABLE = new Set(["needs_review", "failed"]);

const Evidence = z.record(z.string(), z.string().nullable());
const Checks = z.array(
  z.object({ check: z.string(), passed: z.boolean(), detail: z.string().nullable() }),
);

interface ReviewRow {
  id: number;
  document_id: number;
  status: string;
  raw_output: unknown;
  field_evidence: unknown;
  check_results: unknown;
  error: string | null;
  sender: string | null;
  subject: string | null;
  body_text: string;
  received_at: string;
}

/** Why a failed extraction failed: its stored error, else (older rows) its processing check. */
function failedChecks(row: ReviewRow, checks: CheckResult[]): CheckResult[] {
  if (row.status === "failed") {
    if (row.error !== null) return [{ check: "processing", passed: false, detail: row.error }];
    const processing = checks.filter((c) => c.check === "processing");
    if (processing.length > 0) return processing;
    return [{ check: "processing", passed: false, detail: null }];
  }
  return checks.filter((c) => !c.passed);
}

function normalisedOf(
  world: Awaited<ReturnType<typeof loadWorld>>,
  row: ReviewRow,
): NormalisedView {
  const output = ExtractionOutput.safeParse(row.raw_output);
  if (!output.success) return emptyNormalisedView();
  return normaliseExtraction(
    world,
    { sender: row.sender, subject: row.subject, bodyText: row.body_text },
    output.data,
    new Date(row.received_at),
  );
}

/** The latest extraction per document that is waiting for a person, oldest email first. */
export async function listReviewItems(sql: Sql): Promise<ReviewItem[]> {
  const rows = await sql<ReviewRow[]>`
    select e.id, e.document_id, e.status, e.raw_output, e.field_evidence, e.check_results, e.error,
           d.sender, d.subject, d.body_text, d.received_at
    from extractions e join documents d on d.id = e.document_id
    where e.status in ('needs_review', 'failed')
      and e.id = (select max(id) from extractions where document_id = d.id)
    order by d.received_at, e.id`;
  if (rows.length === 0) return [];
  const world = await loadWorld(sql);
  return rows.map((row) => {
    const checks = Checks.safeParse(row.check_results ?? []);
    const evidence = Evidence.safeParse(row.field_evidence ?? {});
    return {
      extractionId: row.id,
      documentId: row.document_id,
      subject: row.subject ?? "",
      sender: row.sender ?? "",
      receivedAt: iso(row.received_at),
      failedChecks: failedChecks(row, checks.success ? checks.data : []),
      normalised: normalisedOf(world, row),
      evidence: evidence.success ? evidence.data : {},
    };
  });
}

/** The choices the Accept form offers: what a correction's IMO, UN/LOCODE and supplier id can be. */
export async function reviewReference(sql: Sql): Promise<ReviewReference> {
  const world = await loadWorld(sql);
  return {
    vessels: world.vessels.map((v) => ({ id: v.id, imo: v.imo, name: v.name })),
    ports: world.ports.map((p) => ({ id: p.id, unlocode: p.unlocode, name: p.name })),
    suppliers: world.suppliers.map((s) => ({ id: s.id, name: s.name })),
  };
}

/** Locks the extraction and checks it is the document's latest and still waiting for a person. */
async function lockReviewable(tx: Tx, id: Id, only?: "failed"): Promise<ReviewRow> {
  const [row] = await tx<ReviewRow[]>`
    select e.id, e.document_id, e.status, e.raw_output, e.field_evidence, e.check_results, e.error,
           d.sender, d.subject, d.body_text, d.received_at
    from extractions e join documents d on d.id = e.document_id
    where e.id = ${id} for update of e`;
  if (!row) throw new ReviewError("not_found", `Extraction ${id} does not exist.`);
  if (only ? row.status !== only : !REVIEWABLE.has(row.status)) {
    throw new ReviewError(
      "conflict",
      `Extraction ${id} is ${row.status}; ${only ? "only a failed extraction can be retried" : "only needs_review or failed can be decided"}.`,
    );
  }
  const [latest] = await tx<{ id: number }[]>`
    select max(id) as id from extractions where document_id = ${row.document_id}`;
  if (latest?.id !== row.id) {
    throw new ReviewError("conflict", `Extraction ${id} was superseded by a newer extraction.`);
  }
  return row;
}

async function audit(
  tx: Tx,
  kind: string,
  detail: Record<string, unknown>,
  at: Date,
): Promise<void> {
  await tx`
    insert into audit_events (recommendation_id, kind, actor, detail, at)
    values (null, ${kind}, ${REVIEWER}, ${json(detail)}::jsonb, ${iso(at)}::timestamptz)`;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** Each field of the human's values that differs from what the code read from the email. */
export function correctionDiff(
  normalised: NormalisedView,
  resolved: { vesselId: Id; portId: Id; supplierId: Id },
  c: ReviewCorrection,
): FieldChange[] {
  const pairs: [string, unknown, unknown][] = [
    ["vesselId", normalised.vesselId, resolved.vesselId],
    ["portId", normalised.portId, resolved.portId],
    ["supplierId", normalised.supplierId, resolved.supplierId],
    ["currency", normalised.currency, c.currency],
    ["validUntil", normalised.validUntil, c.validUntil],
    ["deliveryFrom", normalised.deliveryFrom, c.deliveryFrom],
    ["deliveryTo", normalised.deliveryTo, c.deliveryTo],
    ["bargeFee", normalised.bargeFee, c.bargeFee],
    ["lines", normalised.lines, c.lines],
  ];
  return pairs
    .filter(([, from, to]) => json(from) !== json(to))
    .map(([field, from, to]) => ({ field, from, to }));
}

/** Accepts the extraction with the person's values: one quote, exactly as submitted. */
export async function acceptExtraction(
  deps: ReviewDeps,
  id: Id,
  c: ReviewCorrection,
): Promise<ReviewDecision> {
  const { sql } = deps;
  const world = await loadWorld(sql);
  return sql.begin(async (tx) => {
    const row = await lockReviewable(tx, id);

    const vessel = world.vessels.find((v) => v.imo === c.vesselImo);
    if (!vessel) throw new ReviewError("unprocessable", `No fleet vessel has IMO ${c.vesselImo}.`);
    const port = world.ports.find((p) => p.unlocode === c.portUnlocode);
    if (!port) throw new ReviewError("unprocessable", `No port has UN/LOCODE ${c.portUnlocode}.`);
    const supplier = world.suppliers.find((s) => s.id === c.supplierId);
    if (!supplier) throw new ReviewError("unprocessable", `No supplier has id ${c.supplierId}.`);

    // The first line whose grade the vessel's current voyage still needs.
    const voyage = currentVoyage(world, vessel.id);
    let requirementId: number | null = null;
    if (voyage) {
      for (const line of c.lines) {
        const open = openRequirements(world, voyage.id, line.grade)[0];
        if (open) {
          requirementId = open.id;
          break;
        }
      }
    }

    const [quote] = await tx<{ id: number }[]>`
      insert into quotes (supplier_id, port_id, requirement_id, delivery_from, delivery_to,
                          valid_until, currency, barge_fee, status, extraction_id, received_at)
      values (${supplier.id}, ${port.id}, ${requirementId},
              ${dayStart(c.deliveryFrom)}::timestamptz, ${dayStart(c.deliveryTo)}::timestamptz,
              ${dayStart(c.validUntil)}::timestamptz,
              ${c.currency}, ${c.bargeFee}, 'received', ${row.id}, ${iso(row.received_at)}::timestamptz)
      returning id`;
    if (!quote) throw new Error("quotes insert returned no row");
    for (const line of c.lines) {
      await tx`
        insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
        values (${quote.id}, ${line.grade}, ${line.qtyMt}, ${line.pricePerMt})`;
    }
    await tx`update extractions set status = 'accepted' where id = ${row.id}`;
    const changes = correctionDiff(
      normalisedOf(world, row),
      { vesselId: vessel.id, portId: port.id, supplierId: supplier.id },
      c,
    );
    await audit(
      tx,
      "extraction.accepted",
      { extractionId: row.id, documentId: row.document_id, quoteId: quote.id, changes },
      clock(deps),
    );
    return { extractionId: row.id, status: "accepted", quoteId: quote.id };
  });
}

/** Rejects the extraction: no quote is stored. */
export async function rejectExtraction(deps: ReviewDeps, id: Id): Promise<ReviewDecision> {
  return deps.sql.begin(async (tx) => {
    const row = await lockReviewable(tx, id);
    await tx`update extractions set status = 'rejected' where id = ${row.id}`;
    await audit(
      tx,
      "extraction.rejected",
      { extractionId: row.id, documentId: row.document_id, previousStatus: row.status },
      clock(deps),
    );
    return { extractionId: row.id, status: "rejected", quoteId: null };
  });
}

/**
 * Queues a new extraction for a failed one's document. The caller starts `processDocument` for
 * the returned `documentId` once this has committed. The result names the new `pending` row.
 */
export async function retryExtraction(
  deps: ReviewDeps,
  id: Id,
): Promise<ReviewDecision & { documentId: Id }> {
  return deps.sql.begin(async (tx) => {
    const row = await lockReviewable(tx, id, "failed");
    const now = clock(deps);
    const [created] = await tx<{ id: number }[]>`
      insert into extractions
        (document_id, kind, raw_output, field_evidence, check_results, status, model, prompt_version, created_at)
      values (${row.document_id}, null, null, ${json({})}::jsonb, ${json([])}::jsonb, 'pending',
              ${deps.extractor.model}, ${deps.extractor.promptVersion}, ${iso(now)}::timestamptz)
      returning id`;
    if (!created) throw new Error("extractions insert returned no row");
    await audit(
      tx,
      "extraction.retried",
      { extractionId: row.id, documentId: row.document_id, newExtractionId: created.id },
      now,
    );
    return {
      extractionId: created.id,
      documentId: row.document_id,
      status: "pending",
      quoteId: null,
    };
  });
}
