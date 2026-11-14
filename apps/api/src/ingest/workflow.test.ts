import { readFile } from "node:fs/promises";
import { DEMO_SCENARIO, generateWorld, type Sql, seedDatabase } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { parseAmount } from "@pharos/domain";
import type { ExtractionOutput, QuoteExtraction } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureLlmCall } from "../ai/call-capture.js";
import { createLlmExtractor, ExtractionError, type Extractor } from "../ai/extract.js";
import { type CallMetrics, createLlm } from "../ai/llm.js";
import { DEFAULT_RECORDINGS_DIR } from "../config.js";
import { buildDemoEmails, FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";
import { DEMO_RECORDING_CONFIG } from "./record-demo-extractions.js";
import { type IngestDeps, ingestRaw, processDocument } from "./workflow.js";

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
  const demo = buildDemoEmails(generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR }));
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

const sql = await connectTestDb("ingest_workflow");

if (!sql) {
  describe("ingestion workflow (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("ingest_workflow")}`, () => {});
  });
}

describe.skipIf(!sql)("ingestion workflow (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const NOW = new Date("2026-11-14T08:05:00.000Z");
  const deps = (extractor: Extractor): IngestDeps => ({ sql: db, extractor, now: () => NOW });

  beforeEach(async () => {
    await seedDatabase(db, { seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
  });
  afterAll(async () => {
    await db.end();
  });

  const extractionOf = async (documentId: number) => {
    const rows = await db`
      select id, status, kind, model, prompt_version, check_results, field_evidence, raw_output
      from extractions where document_id = ${documentId} order by id`;
    expect(rows).toHaveLength(1);
    return rows[0] as {
      id: number;
      status: string;
      kind: string | null;
      model: string;
      prompt_version: string;
      check_results: { check: string; passed: boolean; detail: string | null }[];
      field_evidence: Record<string, string | null>;
      raw_output: unknown;
    };
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
    expect(failedChecks(ex.check_results)).toEqual(["supplier_resolved"]);
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
    expect(ex.status).toBe("failed");
    expect(ex.check_results).toEqual([
      { check: "processing", passed: false, detail: "model refused (stop_reason refusal)" },
    ]);
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
    const demo = buildDemoEmails(generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR }));
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
    expect(ex.check_results[0]?.detail).toContain("LLM replay miss");
  });
});
