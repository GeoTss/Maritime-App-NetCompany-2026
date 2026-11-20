import { readFile } from "node:fs/promises";
import {
  DEFAULT_WORLD_SEED,
  DEMO_SCENARIO,
  generateWorld,
  type Sql,
  seedDatabase,
} from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { parseAmount } from "@pharos/domain";
import type { ExtractionOutput, QuoteExtraction } from "@pharos/shared";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureLlmCall } from "../ai/call-capture.js";
import { createLlmExtractor, ExtractionError, type Extractor } from "../ai/extract.js";
import { type CallMetrics, createLlm } from "../ai/llm.js";
import { DEFAULT_RECORDINGS_DIR } from "../config.js";
import { buildDemoEmails, FIXTURE_ANCHOR } from "../read/fixtures.js";
import { writtenIn } from "./evaluate.js";
import { DEMO_RECORDING_CONFIG } from "./record-demo-extractions.js";
import {
  failInterruptedExtractions,
  INTERRUPTED_ERROR,
  type IngestDeps,
  ingestRaw,
  processDocument,
} from "./workflow.js";

const INBOX = new URL("../../../../fixtures/demo-inbox/", import.meta.url);
const kestrelRaw = new Uint8Array(await readFile(new URL("01-kestrel-marsaxlokk.eml", INBOX)));

const METRICS: CallMetrics = {
  requestKey: "fake-request-key",
  model: "claude-haiku-5-5",
  latencyMs: 0,
  usage: { input_tokens: 1000, output_tokens: 200 },
  stopReason: "end_turn",
  mode: "replay",
};

/** What a correct extraction of 01-kestrel-marsaxlokk.eml looks like (values as written). */
function kestrelOutput(): QuoteExtraction {
  const none = { asWritten: null, evidence: null };
  return {
    kind: "quote",
    supplierName: { value: "Kestrel Marine Fuels", evidence: "Kestrel Marine Fuels trading desk" },
    vesselName: {
      value: "MV Aegean Pioneer",
      evidence: "Vessel: MV Aegean Pioneer (IMO 9480019)",
    },
    vesselImo: { value: "9480019", evidence: "Vessel: MV Aegean Pioneer (IMO 9480019)" },
    port: { value: "Marsaxlokk", evidence: "Port: Marsaxlokk" },
    deliveryFrom: none,
    deliveryTo: none,
    validUntil: none,
    bargeFee: {
      value: 2800,
      currency: "USD",
      perUnit: "lump sum",
      asWritten: "USD 2,800 lump sum",
      evidence: "Barge fee: USD 2,800 lump sum",
    },
    lines: [
      {
        grade: { value: "LSMGO", evidence: "Quantity: 300 mt LSMGO" },
        quantity: {
          value: 300,
          unit: "mt",
          asWritten: "300 mt",
          evidence: "Quantity: 300 mt LSMGO",
        },
        price: {
          value: 738,
          currency: "USD",
          perUnit: "per mt",
          asWritten: "USD 738 per mt",
          evidence: "Price: USD 738 per mt",
        },
      },
    ],
    notes: null,
  };
}

function fakeExtractor(produce: () => ExtractionOutput | Promise<ExtractionOutput>): Extractor & {
  calls: number;
} {
  const fake = {
    model: "claude-haiku-5-5",
    promptVersion: "extract-quote/v1",
    calls: 0,
    async extract() {
      fake.calls += 1;
      return { output: await produce(), metrics: [METRICS] };
    },
  };
  return fake;
}

describe("demo email as-written values parse with the domain normaliser", () => {
  const demo = buildDemoEmails(generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR }));
  for (const key of ["kestrel", "straitline"] as const) {
    it(`${key}: price, quantity and barge fee`, () => {
      const e = demo.find((d) => d.option.supplierKey === key);
      expect(e).toBeDefined();
      if (!e) return;
      expect(parseAmount(e.parts.priceAsWritten)).toBe(e.option.pricePerMt);
      expect(parseAmount(e.parts.qtyAsWritten)).toBe(e.option.qtyMt);
      expect(parseAmount(e.parts.bargeAsWritten)).toBe(e.option.bargeFee);
    });
  }
});

describe("writtenIn", () => {
  it("finds the raw string in the field's as-written text, case- and whitespace-folded", () => {
    expect(writtenIn("USD", "USD 738 per mt")).toBe(true);
    expect(writtenIn("per  MT", "USD 738 per mt")).toBe(true);
    expect(writtenIn("PMT", "USD 712 PMT")).toBe(true);
    expect(writtenIn("$", "$738/mt")).toBe(true);
    expect(writtenIn("/mt", "$738/mt")).toBe(true);
  });
  it("respects word boundaries and rejects absent or null strings", () => {
    expect(writtenIn("mt", "USD 712 PMT")).toBe(false);
    expect(writtenIn("USD", "USDT 712 per mt")).toBe(false);
    expect(writtenIn("USD", "EUR 690 per mt")).toBe(false);
    expect(writtenIn(null, "USD 738")).toBe(false);
    expect(writtenIn(" ", "USD 738")).toBe(false);
    expect(writtenIn("USD", null)).toBe(false);
  });
  it("does not fall back to the evidence line: a unit elsewhere on it is not the field's", () => {
    // "120 m3 at USD 728 per mt": "mt" is on the line, but not in the quantity "120 m3".
    expect(writtenIn("mt", "120 m3")).toBe(false);
    expect(writtenIn("EUR", "690 / mt")).toBe(false);
  });
});

const sql = await connectTestDb("ingest_workflow");

if (!sql) {
  describe("ingestion workflow (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("ingest_workflow")}`, () => {});
  });
}
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!sql)("ingestion workflow (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const NOW = new Date("2026-11-14T08:05:00.000Z");
  const deps = (extractor: Extractor): IngestDeps => ({ sql: db, extractor, now: () => NOW });

  beforeEach(async () => {
    await seedDatabase(db, { seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
  });

  interface ExtractionRow {
    id: number;
    status: string;
    kind: string | null;
    model: string;
    prompt_version: string;
    check_results: { check: string; passed: boolean; detail: string | null }[];
    field_evidence: Record<string, string | null>;
    raw_output: unknown;
    error: string | null;
    claimed_at: string | null;
  }
  const extractionsOf = (documentId: number) => db<ExtractionRow[]>`
    select id, status, kind, model, prompt_version, check_results, field_evidence, raw_output,
           error, claimed_at
    from extractions where document_id = ${documentId} order by id`;
  const extractionOf = async (documentId: number) => {
    const rows = await extractionsOf(documentId);
    expect(rows).toHaveLength(1);
    return rows[0] as ExtractionRow;
  };
  const failedChecks = (checks: { check: string; passed: boolean }[]) =>
    checks.filter((c) => !c.passed).map((c) => c.check);
  /** Quotes created by ingestion (the seed has its own quotes, with no extraction). */
  const quoteCount = async () =>
    Number((await db`select count(*)::int as n from quotes where extraction_id is not null`)[0]?.n);

  it("clean Kestrel email becomes a received quote with normalised USD 738/mt, 300 mt LSMGO, barge 2800, port MTMLA, supplier Kestrel", async () => {
    const d = deps(fakeExtractor(kestrelOutput));
    const { documentId, duplicate } = await ingestRaw(d, kestrelRaw, "demo_inbox");
    expect(duplicate).toBe(false);

    const [doc] =
      await db`select kind, source, sender, subject, received_at from documents where id = ${documentId}`;
    expect(doc).toMatchObject({
      kind: "email",
      source: "demo_inbox",
      sender: "bunkers@kestrel-fuels.example",
      subject: "LSMGO offer - MV Aegean Pioneer - Marsaxlokk",
    });
    expect((await extractionOf(documentId)).status).toBe("pending");

    await processDocument(d, documentId);

    const ex = await extractionOf(documentId);
    expect(ex.check_results.filter((c) => !c.passed)).toEqual([]);
    expect(ex).toMatchObject({
      status: "extracted",
      kind: "quote",
      model: "claude-haiku-5-5",
      prompt_version: "extract-quote/v1",
    });
    expect(ex.raw_output).toEqual(kestrelOutput());
    expect(ex.field_evidence["lines.0.price"]).toBe("Price: USD 738 per mt");
    const names = ex.check_results.map((c) => c.check);
    for (const check of [
      "currency_known",
      "unit_known",
      "grade_known",
      "quantity_unambiguous",
      "vessel_resolved",
      "port_resolved",
      "supplier_resolved",
      "price_within_band",
      "requirement_found",
      "evidence_found:lines.0.price",
      "evidence_found:vesselImo",
    ]) {
      expect(names).toContain(check);
    }

    const quotes = await db`
      select q.id, q.status, q.currency, q.barge_fee, q.requirement_id, q.extraction_id, q.received_at,
             s.name as supplier, p.unlocode as port
      from quotes q join suppliers s on s.id = q.supplier_id join ports p on p.id = q.port_id
      where q.extraction_id is not null`;
    expect(quotes).toHaveLength(1);
    const q = quotes[0];
    expect(q).toMatchObject({
      status: "received",
      currency: "USD",
      barge_fee: 2800,
      supplier: "Kestrel Marine Fuels",
      port: "MTMLA",
      extraction_id: ex.id,
    });
    expect(new Date(String(q?.received_at)).toISOString()).toBe("2026-11-14T03:00:00.000Z");

    const [req] = await db`
      select r.id from bunker_requirements r join voyages v on v.id = r.voyage_id
      where v.voyage_no = ${DEMO_SCENARIO.voyageNo} and r.grade = 'LSMGO' and r.status = 'open'`;
    expect(q?.requirement_id).toBe(req?.id);

    const lines =
      await db`select grade, qty_mt, price_per_mt from quote_lines where quote_id = ${q?.id}`;
    expect(lines).toEqual([{ grade: "LSMGO", qty_mt: 300, price_per_mt: 738 }]);

    const calls = await db`select purpose, model, document_id, request_key from llm_calls`;
    expect(calls).toEqual([
      {
        purpose: "extract",
        model: "claude-haiku-5-5",
        document_id: documentId,
        request_key: "fake-request-key",
      },
    ]);
  });

  it("redelivery is idempotent", async () => {
    const extractor = fakeExtractor(kestrelOutput);
    const d = deps(extractor);
    const first = await ingestRaw(d, kestrelRaw, "demo_inbox");
    await processDocument(d, first.documentId);
    const again = await ingestRaw(d, kestrelRaw, "upload");
    expect(again).toEqual({ documentId: first.documentId, duplicate: true });
    // Processing an already-processed document is a no-op too.
    await processDocument(d, first.documentId);
    expect(extractor.calls).toBe(1);
    expect(Number((await db`select count(*)::int as n from documents`)[0]?.n)).toBe(1);
    expect(await quoteCount()).toBe(1);
    await extractionOf(first.documentId);
  });

  it("concurrent delivery of the same bytes stores one document", async () => {
    const d = deps(fakeExtractor(kestrelOutput));
    const results = await Promise.all([
      ingestRaw(d, kestrelRaw, "upload"),
      ingestRaw(d, kestrelRaw, "upload"),
    ]);
    expect(new Set(results.map((r) => r.documentId)).size).toBe(1);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
  });

  it("not_a_quote output stores no quote", async () => {
    const d = deps(
      fakeExtractor(() => ({
        kind: "not_a_quote",
        reason: "Greeting only; no fuel offer.",
        evidence: "Dear Bunker Desk,",
      })),
    );
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex).toMatchObject({ status: "not_a_quote", kind: "not_a_quote" });
    expect(await quoteCount()).toBe(0);
  });

  it("unknown vessel → needs_review with vessel_resolved failed", async () => {
    const out = kestrelOutput();
    // Evidence is genuine (the model mis-transcribed nothing); the vessel simply isn't in the fleet.
    const raw = new TextEncoder().encode(
      new TextDecoder()
        .decode(kestrelRaw)
        .replaceAll("MV Aegean Pioneer (IMO 9480019)", "MV Flying Dutchman"),
    );
    out.vesselName = { value: "MV Flying Dutchman", evidence: "Vessel: MV Flying Dutchman" };
    out.vesselImo = { value: null, evidence: null };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toContain("vessel_resolved");
    expect(failedChecks(ex.check_results)).not.toContain("evidence_found:vesselName");
    expect(await quoteCount()).toBe(0);
  });

  it("evidence not in source → needs_review", async () => {
    const out = kestrelOutput();
    const line = out.lines[0];
    if (!line) throw new Error("fixture has a line");
    line.price = {
      ...line.price,
      value: 728,
      asWritten: "USD 728 per mt",
      evidence: "Price: USD 728 per mt",
    };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toEqual(["evidence_found:lines.0.price"]);
    expect(await quoteCount()).toBe(0);
  });

  it("a value that differs from its as-written text → needs_review", async () => {
    const out = kestrelOutput();
    const line = out.lines[0];
    if (!line) throw new Error("fixture has a line");
    line.price = { ...line.price, value: 783 };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toContain("amounts_parsed");
  });

  /** The Kestrel email with one line of its body replaced. */
  const kestrelWith = (from: string, to: string) => {
    const text = new TextDecoder().decode(kestrelRaw);
    expect(text).toContain(from);
    return new TextEncoder().encode(text.replace(from, to));
  };

  it("currency not in as-written text → needs_review", async () => {
    // The email prices in EUR; the model claims USD while copying the EUR text verbatim.
    const raw = kestrelWith("Price: USD 738 per mt", "Price: EUR 738 per mt");
    const out = kestrelOutput();
    const line = out.lines[0];
    if (!line) throw new Error("fixture has a line");
    line.price = {
      value: 738,
      currency: "USD",
      perUnit: "per mt",
      asWritten: "EUR 738 per mt",
      evidence: "Price: EUR 738 per mt",
    };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    // Without a verified currency the band check cannot run, so it reports "not checked".
    expect(failedChecks(ex.check_results)).toEqual(["currency_known", "price_within_band"]);
    expect(await quoteCount()).toBe(0);
  });

  it("quantity unit not in as-written text → needs_review", async () => {
    // The email quotes a volume; the model claims mass units.
    const raw = kestrelWith("Quantity: 300 mt LSMGO", "Quantity: 300 m3 LSMGO");
    const out = kestrelOutput();
    const line = out.lines[0];
    if (!line) throw new Error("fixture has a line");
    line.grade = { value: "LSMGO", evidence: "Quantity: 300 m3 LSMGO" };
    line.quantity = {
      value: 300,
      unit: "mt",
      asWritten: "300 m3",
      evidence: "Quantity: 300 m3 LSMGO",
    };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toEqual(["unit_known"]);
  });

  it("price perUnit not in as-written text → needs_review", async () => {
    const raw = kestrelWith("Price: USD 738 per mt", "Price: USD 738 per m3");
    const out = kestrelOutput();
    const line = out.lines[0];
    if (!line) throw new Error("fixture has a line");
    line.price = {
      value: 738,
      currency: "USD",
      perUnit: "per mt",
      asWritten: "USD 738 per m3",
      evidence: "Price: USD 738 per m3",
    };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toEqual(["unit_known"]);
  });

  it("not_a_quote with evidence not in the email → needs_review, no quote", async () => {
    const d = deps(
      fakeExtractor(() => ({
        kind: "not_a_quote",
        reason: "Newsletter.",
        evidence: "Unsubscribe from our monthly newsletter",
      })),
    );
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex).toMatchObject({ status: "needs_review", kind: "not_a_quote" });
    expect(failedChecks(ex.check_results)).toEqual(["evidence_found:notAQuote"]);
    expect(await quoteCount()).toBe(0);
  });

  it("quantity null (as-written range) → needs_review", async () => {
    const raw = new TextEncoder().encode(
      new TextDecoder()
        .decode(kestrelRaw)
        .replace("Quantity: 300 mt LSMGO", "Quantity: 300/350 mt LSMGO"),
    );
    const out = kestrelOutput();
    const line = out.lines[0];
    if (!line) throw new Error("fixture has a line");
    line.grade = { value: "LSMGO", evidence: "Quantity: 300/350 mt LSMGO" };
    line.quantity = {
      value: null,
      unit: "mt",
      asWritten: "300/350 mt",
      evidence: "Quantity: 300/350 mt LSMGO",
    };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toEqual(["quantity_unambiguous"]);
    expect(await quoteCount()).toBe(0);
  });

  it("a sender outside the supplier list → needs_review with supplier_resolved failed", async () => {
    const raw = new TextEncoder().encode(
      new TextDecoder()
        .decode(kestrelRaw)
        .replace("bunkers@kestrel-fuels.example", "bunkers@kestrel-fuels.example.net"),
    );
    const d = deps(fakeExtractor(kestrelOutput));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    // R16: the quote still names Kestrel Marine Fuels while the look-alike domain names nobody.
    expect(failedChecks(ex.check_results)).toEqual(["supplier_resolved", "supplier_name_matches"]);
  });

  it("an extracted quote stores its validity and delivery window as UTC midnights", async () => {
    const raw = kestrelWith(
      "Barge fee: USD 2,800 lump sum",
      "Barge fee: USD 2,800 lump sum\nDelivery: 18-19 Nov\nValid until: 15 Nov 2026",
    );
    const out = kestrelOutput();
    out.deliveryFrom = { asWritten: "18-19 Nov", evidence: "Delivery: 18-19 Nov" };
    out.validUntil = { asWritten: "15 Nov 2026", evidence: "Valid until: 15 Nov 2026" };
    const d = deps(fakeExtractor(() => out));
    const { documentId } = await ingestRaw(d, raw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(failedChecks(ex.check_results)).toEqual([]);
    const [q] = await db<{ delivery_from: string; delivery_to: string; valid_until: string }[]>`
      select delivery_from, delivery_to, valid_until from quotes where extraction_id = ${ex.id}`;
    expect(
      [q?.delivery_from, q?.delivery_to, q?.valid_until].map((v) =>
        new Date(String(v)).toISOString(),
      ),
    ).toEqual(["2026-11-18T00:00:00.000Z", "2026-11-19T00:00:00.000Z", "2026-11-15T00:00:00.000Z"]);
  });

  it("a document flagged with an unreadable attachment → needs_review with attachment_text_found failed", async () => {
    const d = deps(fakeExtractor(kestrelOutput));
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await db`update documents set has_unreadable_attachment = true where id = ${documentId}`;
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("needs_review");
    expect(failedChecks(ex.check_results)).toEqual(["attachment_text_found"]);
    expect(await quoteCount()).toBe(0);
  });

  it("an extractor error marks the extraction failed with the message and still records the call", async () => {
    const extractor: Extractor = {
      model: "claude-haiku-5-5",
      promptVersion: "extract-quote/v1",
      async extract() {
        throw new ExtractionError("model refused (stop_reason refusal)", [METRICS]);
      },
    };
    const d = deps(extractor);
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    const ex = await extractionOf(documentId);
    expect(ex).toMatchObject({ status: "failed", error: "model refused (stop_reason refusal)" });
    // The message lives in the error column; check_results no longer carries a "processing" check.
    expect(ex.check_results).toEqual([]);
    expect(await quoteCount()).toBe(0);
    expect(Number((await db`select count(*)::int as n from llm_calls`)[0]?.n)).toBe(1);
  });

  it("replay: both demo emails become received quotes matching DEMO_SCENARIO", async () => {
    const llm = createLlm({
      mode: "replay",
      recordingsDir: DEFAULT_RECORDINGS_DIR,
      onCall: captureLlmCall,
    });
    const d = deps(createLlmExtractor(llm, DEMO_RECORDING_CONFIG));
    const demo = buildDemoEmails(
      generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR }),
    );
    const cases = [
      ["01-kestrel-marsaxlokk.eml", "kestrel"],
      ["02-straitline-gibraltar.eml", "straitline"],
    ] as const;
    for (const [file, key] of cases) {
      const raw = new Uint8Array(await readFile(new URL(file, INBOX)));
      const { documentId } = await ingestRaw(d, raw, "demo_inbox");
      await processDocument(d, documentId);
      const ex = await extractionOf(documentId);
      expect(
        ex.check_results.filter((c) => !c.passed),
        file,
      ).toEqual([]);
      expect(ex.status, file).toBe("extracted");

      const option = DEMO_SCENARIO.options.find((o) => o.supplierKey === key);
      const email = demo.find((e) => e.option.supplierKey === key);
      const [q] = await db`
        select q.id, q.status, q.currency, q.barge_fee, s.name as supplier, p.unlocode as port
        from quotes q join suppliers s on s.id = q.supplier_id join ports p on p.id = q.port_id
        where q.extraction_id = ${ex.id}`;
      expect(q, file).toMatchObject({
        status: "received",
        currency: option?.currency,
        barge_fee: option?.bargeFee,
        supplier: email?.supplierName,
        port: option?.portLocode,
      });
      const lines =
        await db`select grade, qty_mt, price_per_mt from quote_lines where quote_id = ${q?.id}`;
      expect(lines, file).toEqual([
        {
          grade: DEMO_SCENARIO.requirement.grade,
          qty_mt: option?.qtyMt,
          price_per_mt: option?.pricePerMt,
        },
      ]);
    }
    const calls = await db`select mode, purpose from llm_calls order by id`;
    expect(calls).toEqual([
      { mode: "replay", purpose: "extract" },
      { mode: "replay", purpose: "extract" },
    ]);
  });

  it("an unexpected error (e.g. a replay miss) also marks the extraction failed", async () => {
    const d = deps(
      fakeExtractor(() => {
        throw new Error("LLM replay miss: no recording for request key abc");
      }),
    );
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await expect(processDocument(d, documentId)).resolves.toBeUndefined();
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("failed");
    expect(ex.error).toContain("LLM replay miss");
    expect(ex.check_results).toEqual([]);
  });

  it("two concurrent processDocument calls on one document make one extraction call and one quote", async () => {
    const extractor = fakeExtractor(async () => {
      // Hold the first call inside the extractor so the second one runs while it is in flight.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return kestrelOutput();
    });
    const d = deps(extractor);
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await Promise.all([processDocument(d, documentId), processDocument(d, documentId)]);
    expect(extractor.calls).toBe(1);
    expect(await quoteCount()).toBe(1);
    const ex = await extractionOf(documentId);
    expect(ex.status).toBe("extracted");
    expect(ex.claimed_at).not.toBeNull();
    expect(Number((await db`select count(*)::int as n from llm_calls`)[0]?.n)).toBe(1);
  });

  it("a pending extraction another worker has claimed is left alone, without an extractor call", async () => {
    const extractor = fakeExtractor(kestrelOutput);
    const d = deps(extractor);
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await db`update extractions set claimed_at = now() where document_id = ${documentId}`;
    await processDocument(d, documentId);
    expect(extractor.calls).toBe(0);
    expect((await extractionOf(documentId)).status).toBe("pending");
    expect(await quoteCount()).toBe(0);
  });

  it("works on the document's latest extraction: a retry row is processed, the failed one is kept", async () => {
    const failing: Extractor = {
      model: "claude-haiku-5-5",
      promptVersion: "extract-quote/v1",
      async extract() {
        throw new ExtractionError("truncated (stop_reason max_tokens)", [METRICS]);
      },
    };
    const { documentId } = await ingestRaw(deps(failing), kestrelRaw, "upload");
    await processDocument(deps(failing), documentId);
    // What a retry does (Task 8): a new pending extraction for the same document.
    await db`
      insert into extractions
        (document_id, kind, raw_output, field_evidence, check_results, status, model, prompt_version, created_at)
      values (${documentId}, null, null, '{}'::jsonb, '[]'::jsonb, 'pending', 'claude-haiku-5-5',
              'extract-quote/v1', now())`;
    const extractor = fakeExtractor(kestrelOutput);
    await processDocument(deps(extractor), documentId);
    expect(extractor.calls).toBe(1);
    const [first, latest] = await extractionsOf(documentId);
    expect(first).toMatchObject({ status: "failed", error: "truncated (stop_reason max_tokens)" });
    expect(latest).toMatchObject({ status: "extracted", error: null });
    expect(await quoteCount()).toBe(1);
    // The latest is no longer pending, so another call does nothing.
    await processDocument(deps(extractor), documentId);
    expect(extractor.calls).toBe(1);
  });

  it("boot sweep: a claimed pending extraction (interrupted) becomes failed; unclaimed and finished rows are untouched", async () => {
    const extractor = fakeExtractor(kestrelOutput);
    const d = deps(extractor);
    const done = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, done.documentId);
    const interrupted = await ingestRaw(
      d,
      kestrelWith("Port: Marsaxlokk", "Port: Valletta"),
      "upload",
    );
    await db`update extractions set claimed_at = now() where document_id = ${interrupted.documentId}`;
    const waiting = await ingestRaw(
      d,
      kestrelWith("Quantity: 300 mt", "Quantity: 310 mt"),
      "upload",
    );

    expect(await failInterruptedExtractions(db)).toBe(1);

    expect(await extractionOf(interrupted.documentId)).toMatchObject({
      status: "failed",
      error: INTERRUPTED_ERROR,
    });
    expect(INTERRUPTED_ERROR).toBe("interrupted: the API restarted during processing");
    expect(await extractionOf(waiting.documentId)).toMatchObject({
      status: "pending",
      claimed_at: null,
      error: null,
    });
    expect(await extractionOf(done.documentId)).toMatchObject({ status: "extracted", error: null });
    // Run again: nothing left to sweep.
    expect(await failInterruptedExtractions(db)).toBe(0);
  });

  it("claims only the latest extraction: an older pending row stays pending and unclaimed", async () => {
    const extractor = fakeExtractor(kestrelOutput);
    const d = deps(extractor);
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await db`
      insert into extractions
        (document_id, kind, raw_output, field_evidence, check_results, status, model, prompt_version, created_at)
      values (${documentId}, null, null, '{}'::jsonb, '[]'::jsonb, 'pending', 'claude-haiku-5-5',
              'extract-quote/v1', now())`;
    await processDocument(d, documentId);
    await processDocument(d, documentId);
    expect(extractor.calls).toBe(1);
    const [older, latest] = await extractionsOf(documentId);
    expect(older).toMatchObject({ status: "pending", claimed_at: null });
    expect(latest?.status).toBe("extracted");
    expect(latest?.claimed_at).not.toBeNull();
  });

  /** Deps whose log lines are kept, to check what processDocument reported. */
  const loggingDeps = (extractor: Extractor) => {
    const logged: string[] = [];
    return { d: { ...deps(extractor), log: (m: string) => logged.push(m) }, logged };
  };

  it("a row failed behind processDocument's back mid-call stays failed: no quote, its error kept", async () => {
    // The sweep (or any other writer) fails the claimed row while the model call is in flight.
    const extractor = fakeExtractor(async () => {
      expect(await failInterruptedExtractions(db)).toBe(1);
      return kestrelOutput();
    });
    const { d, logged } = loggingDeps(extractor);
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    expect(extractor.calls).toBe(1);
    const ex = await extractionOf(documentId);
    expect(ex).toMatchObject({
      status: "failed",
      error: INTERRUPTED_ERROR,
      kind: null,
      raw_output: null,
      check_results: [],
    });
    expect(await quoteCount()).toBe(0);
    expect(logged.join("\n")).toMatch(/no longer pending/);
  });

  it("a failure after the row was failed elsewhere does not overwrite that row's error", async () => {
    const extractor: Extractor = {
      model: "claude-haiku-5-5",
      promptVersion: "extract-quote/v1",
      async extract() {
        await failInterruptedExtractions(db);
        throw new ExtractionError("truncated (stop_reason max_tokens)", [METRICS]);
      },
    };
    const { d, logged } = loggingDeps(extractor);
    const { documentId } = await ingestRaw(d, kestrelRaw, "upload");
    await processDocument(d, documentId);
    expect(await extractionOf(documentId)).toMatchObject({
      status: "failed",
      error: INTERRUPTED_ERROR,
    });
    expect(logged.join("\n")).toMatch(/no longer pending/);
  });
});

describe.skipIf(!sql)("ingestion workflow: attachments (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const NOW = new Date("2026-11-14T08:05:00.000Z");

  beforeEach(async () => {
    await seedDatabase(db, { seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
  });

  /** A 1x1 PNG: the page of a scanned quote, with no text layer. */
  const PNG_1X1 = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

  async function pdf(content: { text?: string; image?: boolean }): Promise<Uint8Array> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage();
    if (content.image) {
      const png = await doc.embedPng(PNG_1X1);
      page.drawImage(png, { x: 50, y: 400, width: 400, height: 300 });
    }
    if (content.text) {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText(content.text, { font, size: 12, x: 50, y: 700 });
    }
    return doc.save();
  }

  /** The Kestrel email body with one PDF attachment. */
  function kestrelWithPdf(pdfBytes: Uint8Array): Uint8Array {
    const text = new TextDecoder().decode(kestrelRaw).replace(/\r\n/g, "\n");
    const split = text.indexOf("\n\n");
    const headers = text
      .slice(0, split)
      .split("\n")
      .filter((h) => !/^Content-(Type|Transfer-Encoding):/i.test(h));
    const body = text.slice(split + 2);
    return new TextEncoder().encode(
      [
        ...headers,
        'Content-Type: multipart/mixed; boundary="B"',
        "",
        "--B",
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
        "--B",
        'Content-Type: application/pdf; name="quote.pdf"',
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="quote.pdf"',
        "",
        Buffer.from(pdfBytes).toString("base64"),
        "--B--",
        "",
      ].join("\r\n"),
    );
  }

  const documentOf = async (documentId: number) => {
    const [doc] = await db<{ body_text: string; has_unreadable_attachment: boolean }[]>`
      select body_text, has_unreadable_attachment from documents where id = ${documentId}`;
    return doc;
  };

  it("an image-only PDF is flagged at ingest; processing ends needs_review with attachment_text_found failed, not failed", async () => {
    const extractor = fakeExtractor(kestrelOutput);
    const d: IngestDeps = { sql: db, extractor, now: () => NOW };
    const { documentId } = await ingestRaw(d, kestrelWithPdf(await pdf({ image: true })), "upload");
    const doc = await documentOf(documentId);
    expect(doc?.has_unreadable_attachment).toBe(true);
    expect(doc?.body_text).toContain("Price: USD 738 per mt");
    expect(doc?.body_text).not.toContain("--- attachment:");

    await processDocument(d, documentId);
    expect(extractor.calls).toBe(1);
    const [ex] = await db<
      {
        status: string;
        error: string | null;
        check_results: { check: string; passed: boolean }[];
      }[]
    >`
      select status, error, check_results from extractions where document_id = ${documentId}`;
    expect(ex?.status).toBe("needs_review");
    expect(ex?.error).toBeNull();
    expect(ex?.check_results.filter((c) => !c.passed).map((c) => c.check)).toEqual([
      "attachment_text_found",
    ]);
    expect(
      Number(
        (await db`select count(*)::int as n from quotes where extraction_id is not null`)[0]?.n,
      ),
    ).toBe(0);
  });

  it("a PDF with text is stored as an attachment section of the document text, not flagged", async () => {
    const d: IngestDeps = { sql: db, extractor: fakeExtractor(kestrelOutput), now: () => NOW };
    const { documentId } = await ingestRaw(
      d,
      kestrelWithPdf(await pdf({ text: "Delivery: 18-19 Nov" })),
      "upload",
    );
    const doc = await documentOf(documentId);
    expect(doc?.has_unreadable_attachment).toBe(false);
    expect(doc?.body_text).toMatch(
      /Kestrel Marine Fuels trading desk\n\n--- attachment: quote\.pdf ---\nDelivery: 18-19 Nov$/,
    );
  });
});
