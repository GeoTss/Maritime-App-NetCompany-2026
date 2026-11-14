/**
 * The ingestion workflow: fixed steps, no agent.
 *
 *   ingestRaw:       parse -> dedupe by sha256 -> insert `documents` + a `pending` extraction
 *   processDocument: extract (LLM 1) -> record the call(s) -> checks in code -> quote or review
 *
 * The model only transcribes. Every stored number is parsed from the as-written text by
 * `packages/domain`, and every value must be backed by evidence found verbatim in the email.
 */
import { loadWorld, type Sql, type World } from "@pharos/db";
import {
  evidenceSupports,
  normaliseCurrency,
  normaliseGrade,
  normaliseMassUnit,
  normalisePerUnit,
  parseAmount,
} from "@pharos/domain";
import type {
  CheckResult,
  Currency,
  ExtractionOutput,
  FuelGrade,
  Id,
  QuoteExtraction,
} from "@pharos/shared";
import { type ExtractInput, ExtractionError, type Extractor, sourceText } from "../ai/extract.js";
import { type CallMetrics, recordLlmCall } from "../ai/llm.js";
import { parseEmail } from "./parse-email.js";
import {
  openRequirement,
  priceWithinBand,
  resolvePort,
  resolveSupplier,
  resolveVessel,
} from "./resolve.js";

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
      select e.id as extraction_id, e.status, d.sender, d.subject, d.body_text, d.received_at
      from documents d join extractions e on e.document_id = d.id
      where d.id = ${documentId}
      order by e.id desc limit 1`;
    if (row?.status !== "pending") return;
    extractionId = row.extraction_id;
    const doc: ExtractInput = { sender: row.sender, subject: row.subject, bodyText: row.body_text };

    const output = await extractAndRecord(deps, documentId, doc);
    rawOutput = output;
    const world = await loadWorld(sql);
    const result = evaluateExtraction(world, doc, output);
    await sql.begin(async (tx) => {
      let quoteId: number | null = null;
      if (result.status === "extracted") {
        const q = result.quote;
        const [quote] = await tx<{ id: number }[]>`
          insert into quotes (supplier_id, port_id, requirement_id, delivery_from, delivery_to,
                              valid_until, currency, barge_fee, status, extraction_id, received_at)
          values (${q.supplierId}, ${q.portId}, ${q.requirementId}, null, null, null,
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

// ---------- checks (pure) ----------

export interface NormalisedQuote {
  supplierId: Id;
  portId: Id;
  requirementId: Id;
  currency: Currency;
  bargeFee: number;
  lines: { grade: FuelGrade; qtyMt: number; pricePerMt: number }[];
}

export type Evaluation = {
  fieldEvidence: Record<string, string | null>;
  checks: CheckResult[];
} & (
  | { status: "extracted"; quote: NormalisedQuote }
  | { status: "needs_review" }
  | { status: "not_a_quote" }
);

interface EvidenceItem {
  path: string;
  evidence: string | null;
  /** The text the evidence must contain; null when the field is absent (no check). */
  mustContain: string | null;
  present: boolean;
}

function evidenceItems(q: QuoteExtraction): EvidenceItem[] {
  const text = (path: string, f: { value: string | null; evidence: string | null }) => ({
    path,
    evidence: f.evidence,
    mustContain: f.value,
    present: f.value !== null,
  });
  const written = (
    path: string,
    f: { asWritten: string | null; evidence: string | null; value?: number | null },
  ) => ({
    path,
    evidence: f.evidence,
    mustContain: f.asWritten,
    present: f.asWritten !== null || (f.value ?? null) !== null,
  });
  return [
    text("supplierName", q.supplierName),
    text("vesselName", q.vesselName),
    text("vesselImo", q.vesselImo),
    text("port", q.port),
    written("deliveryFrom", q.deliveryFrom),
    written("deliveryTo", q.deliveryTo),
    written("validUntil", q.validUntil),
    written("bargeFee", q.bargeFee),
    ...q.lines.flatMap((l, i) => [
      text(`lines.${i}.grade`, l.grade),
      written(`lines.${i}.quantity`, l.quantity),
      written(`lines.${i}.price`, l.price),
    ]),
  ];
}

/** The number in the as-written text, if it parses and equals the transcribed value. */
function readAmount(f: { value: number | null; asWritten: string | null }): number | null {
  if (f.value === null || f.asWritten === null) return null;
  const parsed = parseAmount(f.asWritten);
  return parsed !== null && parsed === f.value ? parsed : null;
}

const check = (name: string, failures: string[]): CheckResult => ({
  check: name,
  passed: failures.length === 0,
  detail: failures.length === 0 ? null : failures.join(" "),
});

/** Runs every check on one extraction; a quote is produced only when all of them pass. */
export function evaluateExtraction(
  world: World,
  doc: ExtractInput,
  output: ExtractionOutput,
): Evaluation {
  const source = sourceText(doc);
  if (output.kind === "not_a_quote") {
    const found = evidenceSupports(source, output.evidence, null);
    return {
      status: "not_a_quote",
      fieldEvidence: { notAQuote: output.evidence },
      checks: [
        check("evidence_found:notAQuote", found ? [] : ["Evidence not found in the email."]),
      ],
    };
  }

  const items = evidenceItems(output);
  const fieldEvidence = Object.fromEntries(items.map((i) => [i.path, i.evidence]));
  const checks: CheckResult[] = items
    .filter((i) => i.present)
    .map((i) =>
      check(
        `evidence_found:${i.path}`,
        evidenceSupports(source, i.evidence, i.mustContain)
          ? []
          : [`Evidence for ${i.path} is missing, not verbatim in the email, or lacks the value.`],
      ),
    );

  const lines = output.lines;
  const barge = output.bargeFee;
  const bargePresent = barge.value !== null || barge.asWritten !== null;

  // currency_known: one recognised currency across every price and the barge fee.
  const currencyFailures: string[] = [];
  const currencies = [
    ...lines.map((l, i) => [`lines.${i}.price`, l.price.currency] as const),
    ...(bargePresent ? [["bargeFee", barge.currency] as const] : []),
  ].map(([path, raw]) => {
    const c = normaliseCurrency(raw);
    if (c === null) currencyFailures.push(`Currency "${raw ?? ""}" of ${path} is not recognised.`);
    return c;
  });
  const known = [...new Set(currencies.filter((c): c is Currency => c !== null))];
  if (known.length > 1) currencyFailures.push(`The quote mixes currencies (${known.join(", ")}).`);
  const currency = currencyFailures.length === 0 ? (known[0] ?? null) : null;
  checks.push(check("currency_known", currencyFailures));

  // unit_known: quantities in mass, prices per mt, the barge fee a lump sum.
  const unitFailures: string[] = [];
  lines.forEach((l, i) => {
    if (normaliseMassUnit(l.quantity.unit) === null) {
      unitFailures.push(
        `Quantity unit "${l.quantity.unit ?? ""}" of line ${i} is not a mass unit.`,
      );
    }
    if (normalisePerUnit(l.price.perUnit) !== "per_mt") {
      unitFailures.push(`Price of line ${i} is not per mt ("${l.price.perUnit ?? ""}").`);
    }
  });
  if (bargePresent && normalisePerUnit(barge.perUnit) !== "lump_sum") {
    unitFailures.push(`Barge fee is not a lump sum ("${barge.perUnit ?? ""}").`);
  }
  checks.push(check("unit_known", unitFailures));

  // grade_known: every line's grade recognised, no grade twice.
  const grades = lines.map((l) => normaliseGrade(l.grade.value));
  const gradeFailures = grades.flatMap((g, i) =>
    g === null ? [`Grade "${lines[i]?.grade.value ?? ""}" of line ${i} is not recognised.`] : [],
  );
  if (new Set(grades.filter((g) => g !== null)).size < grades.filter((g) => g !== null).length) {
    gradeFailures.push("A grade appears on more than one line.");
  }
  checks.push(check("grade_known", gradeFailures));

  // quantity_unambiguous: a single number, as written, greater than zero.
  const quantities = lines.map((l) => readAmount(l.quantity));
  checks.push(
    check(
      "quantity_unambiguous",
      quantities.flatMap((q, i) =>
        q === null || q <= 0
          ? [
              `Quantity of line ${i} is not a single amount ("${lines[i]?.quantity.asWritten ?? ""}").`,
            ]
          : [],
      ),
    ),
  );

  // amounts_parsed: prices and barge fee parse from the as-written text to the transcribed value.
  const prices = lines.map((l) => readAmount(l.price));
  const bargeFee = readAmount(barge);
  const amountFailures = prices.flatMap((p, i) =>
    p === null || p <= 0
      ? [`Price of line ${i} does not read as "${lines[i]?.price.asWritten ?? ""}".`]
      : [],
  );
  if (!bargePresent) amountFailures.push("No barge fee is quoted.");
  else if (bargeFee === null || bargeFee < 0) {
    amountFailures.push(`Barge fee does not read as "${barge.asWritten ?? ""}".`);
  }
  checks.push(check("amounts_parsed", amountFailures));

  const vessel = resolveVessel(world, {
    name: output.vesselName.value,
    imo: output.vesselImo.value,
  });
  checks.push(check("vessel_resolved", vessel.detail ? [vessel.detail] : []));
  const port = resolvePort(world, output.port.value);
  checks.push(check("port_resolved", port.detail ? [port.detail] : []));
  const supplier = resolveSupplier(world, doc.sender);
  checks.push(check("supplier_resolved", supplier.detail ? [supplier.detail] : []));

  // price_within_band: ±15 % of the port's latest market price for the grade.
  checks.push(
    check(
      "price_within_band",
      lines.flatMap((_, i) => {
        const grade = grades[i];
        const price = prices[i];
        if (!port.port || !grade || price == null || !currency) {
          return [`Line ${i} not checked: needs a resolved port, grade, price and currency.`];
        }
        const band = priceWithinBand(world, port.port.id, grade, price, currency);
        return band.passed ? [] : [band.detail ?? `Line ${i} price is outside the band.`];
      }),
    ),
  );

  // requirement_found: an open requirement for each grade on the vessel's current voyage.
  const requirements = grades.map((g) =>
    vessel.vessel && g ? openRequirement(world, vessel.vessel.id, g) : null,
  );
  checks.push(
    check(
      "requirement_found",
      requirements.flatMap((r, i) =>
        r === null
          ? [
              vessel.vessel && grades[i]
                ? `No open ${grades[i]} requirement on ${vessel.vessel.name}'s current voyage.`
                : `Line ${i} not checked: needs a resolved vessel and grade.`,
            ]
          : [],
      ),
    ),
  );

  const allPassed = checks.every((c) => c.passed);
  const requirementId = requirements[0]?.id;
  if (
    !allPassed ||
    !supplier.supplier ||
    !port.port ||
    !currency ||
    bargeFee === null ||
    requirementId === undefined
  ) {
    return { status: "needs_review", fieldEvidence, checks };
  }
  return {
    status: "extracted",
    fieldEvidence,
    checks,
    quote: {
      supplierId: supplier.supplier.id,
      portId: port.port.id,
      requirementId,
      currency,
      bargeFee,
      lines: lines.map((_, i) => ({
        grade: grades[i] as FuelGrade,
        qtyMt: quantities[i] as number,
        pricePerMt: prices[i] as number,
      })),
    },
  };
}
