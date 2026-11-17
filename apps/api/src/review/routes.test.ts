import { readFile } from "node:fs/promises";
import { currentVoyage, loadWorld, openRequirements, type Sql, seedDatabase } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import type { ExtractionOutput, QuoteExtraction } from "@pharos/shared";
import { AuditEventView, ReviewDecision, ReviewItem, ReviewReference } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ExtractionError, type Extractor } from "../ai/extract.js";
import { createApp } from "../app.js";
import { type IngestDeps, ingestRaw, processDocument } from "../ingest/workflow.js";
import { createFixtureSource, FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";

const INBOX = new URL("../../../../fixtures/demo-inbox/", import.meta.url);
const kestrelRaw = new Uint8Array(await readFile(new URL("01-kestrel-marsaxlokk.eml", INBOX)));
const straitlineRaw = new Uint8Array(await readFile(new URL("02-straitline-gibraltar.eml", INBOX)));

/** A correct extraction of 01-kestrel-marsaxlokk.eml (values as written). */
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

/** The model misreads the price (728, email says 738): its evidence is not in the email. */
function misreadOutput(): QuoteExtraction {
  const out = kestrelOutput();
  const line = out.lines[0];
  if (!line) throw new Error("fixture has a line");
  line.price = {
    ...line.price,
    value: 728,
    asWritten: "USD 728 per mt",
    evidence: "Price: USD 728 per mt",
  };
  return out;
}

const sql = await connectTestDb("review_routes");

if (!sql) {
  describe("review routes (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("review_routes")}`, () => {});
  });
}
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!sql)("review routes (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const NOW = new Date("2026-11-14T08:05:00.000Z");

  /** What the fake extractor does next; a function so a test can change it before a retry. */
  let produce: () => ExtractionOutput;
  let background: Promise<void>[];
  const extractor: Extractor = {
    model: "claude-haiku-5-5",
    promptVersion: "extract-quote/v2",
    async extract() {
      return { output: produce(), metrics: [] };
    },
  };
  const deps: IngestDeps = { sql: db, extractor, now: () => NOW };
  const app = createApp({
    llmMode: "replay",
    pingDb: async () => true,
    read: createFixtureSource(),
    review: { ...deps, track: (p) => void background.push(p) },
  });

  beforeEach(async () => {
    await seedDatabase(db, { seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
    produce = kestrelOutput;
    background = [];
  });

  /** Delivers an email through the workflow with the current `produce`; returns its ids. */
  async function deliver(raw = kestrelRaw) {
    const { documentId } = await ingestRaw(deps, raw, "upload");
    await processDocument(deps, documentId);
    const [row] = await db<{ id: number; status: string }[]>`
      select id, status from extractions where document_id = ${documentId} order by id desc limit 1`;
    if (!row) throw new Error("no extraction");
    return { documentId, extractionId: row.id, status: row.status };
  }
  /** An email whose extraction ended `needs_review` (price misread). */
  async function deliverDoubtful(raw = kestrelRaw) {
    produce = misreadOutput;
    const d = await deliver(raw);
    expect(d.status).toBe("needs_review");
    return d;
  }
  /** An email whose extraction ended `failed`. */
  async function deliverFailed(raw = kestrelRaw) {
    const failing: Extractor = {
      ...extractor,
      async extract() {
        throw new ExtractionError("model refused (stop_reason refusal)", []);
      },
    };
    const { documentId } = await ingestRaw({ ...deps, extractor: failing }, raw, "upload");
    await processDocument({ ...deps, extractor: failing }, documentId);
    const [row] = await db<{ id: number; status: string }[]>`
      select id, status from extractions where document_id = ${documentId}`;
    expect(row?.status).toBe("failed");
    return { documentId, extractionId: row?.id ?? 0 };
  }

  const post = (path: string, body: unknown = {}, type = "application/json") =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": type },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /** The human's values for the Kestrel email, with the price the email really says. */
  async function correction(overrides: Record<string, unknown> = {}) {
    const world = await loadWorld(db);
    const port = world.ports.find((p) => p.name === "Marsaxlokk");
    const supplier = world.suppliers.find((s) => s.name === "Kestrel Marine Fuels");
    return {
      vesselImo: "9480019",
      portUnlocode: port?.unlocode ?? "",
      supplierId: supplier?.id ?? 0,
      currency: "USD",
      validUntil: "2026-11-20",
      deliveryFrom: null,
      deliveryTo: null,
      bargeFee: 2800,
      lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
      ...overrides,
    };
  }
  const quoteCount = async () =>
    Number((await db`select count(*)::int as n from quotes where extraction_id is not null`)[0]?.n);
  const statusOf = async (id: number) =>
    (await db<{ status: string }[]>`select status from extractions where id = ${id}`)[0]?.status;
  const changesOf = (row: { detail: Record<string, unknown> } | undefined) =>
    ((row?.detail ?? {}) as { changes?: { field: string; from: unknown; to: unknown }[] })
      .changes ?? [];
  // Every row the review writes must parse as an AuditEventView (kind is an AUDIT_KINDS member).
  const auditOf = async (kind: string) => {
    const rows = await db<
      {
        id: number;
        kind: string;
        actor: string;
        detail: Record<string, unknown>;
        at: Date | string;
      }[]
    >`select id, kind, actor, detail, at from audit_events where kind = ${kind} order by id`;
    for (const r of rows) {
      AuditEventView.parse({
        id: r.id,
        recommendationId: null,
        kind: r.kind,
        actor: r.actor,
        detail: r.detail ?? null,
        at: new Date(r.at).toISOString(),
      });
    }
    return rows;
  };

  it("GET /api/review lists the latest needs_review and failed extractions, oldest email first", async () => {
    const failed = await deliverFailed(straitlineRaw);
    const doubtful = await deliverDoubtful(kestrelRaw);
    // A delivered email with a clean extraction does not appear.
    produce = () => ({ kind: "not_a_quote", reason: "x", evidence: "MV Aegean Pioneer" });
    await deliver(new TextEncoder().encode(`${new TextDecoder().decode(kestrelRaw)}\n`));
    await db`update documents set received_at = '2026-11-14T07:00:00Z' where id = ${failed.documentId}`;
    await db`update documents set received_at = '2026-11-14T06:00:00Z' where id = ${doubtful.documentId}`;

    const res = await app.request("/api/review");
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: unknown[] };
    const parsed = items.map((i) => ReviewItem.parse(i));
    expect(parsed.map((i) => i.extractionId)).toEqual([doubtful.extractionId, failed.extractionId]);

    const [review, fail] = parsed;
    expect(review?.failedChecks.length).toBeGreaterThan(0);
    expect(review?.failedChecks.every((c) => !c.passed)).toBe(true);
    expect(review?.normalised.lines).toEqual([{ grade: "LSMGO", qtyMt: 300, pricePerMt: 728 }]);
    expect(review?.evidence).not.toEqual({});
    expect(fail?.failedChecks).toEqual([
      { check: "processing", passed: false, detail: "model refused (stop_reason refusal)" },
    ]);
    expect(fail?.normalised.lines).toEqual([]);
    expect(fail?.normalised.vesselId).toBeNull();
  });

  it("accept stores exactly the human's values, even when they differ from the model's", async () => {
    const { extractionId, documentId } = await deliverDoubtful();
    const body = await correction();
    const res = await post(`/api/review/${extractionId}/accept`, body);
    expect(res.status).toBe(200);
    const decision = ReviewDecision.parse(await res.json());
    expect(decision).toMatchObject({ extractionId, status: "accepted" });

    const [quote] = await db<
      {
        id: number;
        status: string;
        currency: string;
        barge_fee: number;
        valid_until: string;
        delivery_from: string | null;
        extraction_id: number;
        received_at: string;
        requirement_id: number | null;
      }[]
    >`select * from quotes where extraction_id is not null`;
    expect(quote).toMatchObject({
      id: decision.quoteId,
      status: "received",
      currency: "USD",
      barge_fee: 2800,
      delivery_from: null,
      extraction_id: extractionId,
    });
    expect(new Date(quote?.valid_until ?? "").toISOString()).toBe("2026-11-20T00:00:00.000Z");
    const [doc] = await db<{ received_at: string }[]>`
      select received_at from documents where id = ${documentId}`;
    expect(new Date(quote?.received_at ?? "").toISOString()).toBe(
      new Date(doc?.received_at ?? "").toISOString(),
    );
    const lines = await db`
      select grade, qty_mt, price_per_mt from quote_lines where quote_id = ${decision.quoteId}`;
    expect(lines.map((l) => ({ ...l }))).toEqual([
      { grade: "LSMGO", qty_mt: 300, price_per_mt: 738 },
    ]);
    expect(await statusOf(extractionId)).toBe("accepted");

    // Linked to the first open requirement of that grade on the vessel's current voyage.
    const world = await loadWorld(db);
    const vessel = world.vessels.find((v) => v.imo === "9480019");
    const voyage = vessel ? currentVoyage(world, vessel.id) : null;
    const expected = voyage ? openRequirements(world, voyage.id, "LSMGO")[0] : undefined;
    expect(expected).toBeDefined();
    expect(quote?.requirement_id).toBe(expected?.id);
  });

  it("accept writes an audit row whose diff lists only the fields the human changed", async () => {
    const { extractionId } = await deliverDoubtful();
    await post(`/api/review/${extractionId}/accept`, await correction());
    const [row] = await auditOf("extraction.accepted");
    expect(row?.actor).toBe("operator");
    expect(row?.detail).toMatchObject({ extractionId });
    const changes = changesOf(row);
    expect(changes).toEqual([
      {
        field: "validUntil",
        from: null,
        to: "2026-11-20",
      },
      {
        field: "lines",
        from: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 728 }],
        to: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
      },
    ]);
  });

  it("a second accept gives 409 and leaves one quote", async () => {
    const { extractionId } = await deliverDoubtful();
    const body = await correction();
    expect((await post(`/api/review/${extractionId}/accept`, body)).status).toBe(200);
    const again = await post(`/api/review/${extractionId}/accept`, body);
    expect(again.status).toBe(409);
    expect(await quoteCount()).toBe(1);
    expect(await auditOf("extraction.accepted")).toHaveLength(1);
  });

  it("two concurrent accepts store one quote", async () => {
    const { extractionId } = await deliverDoubtful();
    const body = await correction();
    const results = await Promise.all([
      post(`/api/review/${extractionId}/accept`, body),
      post(`/api/review/${extractionId}/accept`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await quoteCount()).toBe(1);
  });

  it("reject is final: later accept, reject and retry all give 409", async () => {
    const { extractionId } = await deliverDoubtful();
    const res = await post(`/api/review/${extractionId}/reject`);
    expect(res.status).toBe(200);
    expect(ReviewDecision.parse(await res.json())).toMatchObject({
      extractionId,
      status: "rejected",
      quoteId: null,
    });
    expect(await statusOf(extractionId)).toBe("rejected");
    expect((await post(`/api/review/${extractionId}/accept`, await correction())).status).toBe(409);
    expect((await post(`/api/review/${extractionId}/reject`)).status).toBe(409);
    expect((await post(`/api/review/${extractionId}/retry`)).status).toBe(409);
    expect(await quoteCount()).toBe(0);
    expect(await auditOf("extraction.rejected")).toHaveLength(1);
    const listed = (await (await app.request("/api/review")).json()) as { items: unknown[] };
    expect(listed.items).toEqual([]);
  });

  it("retry on a failed extraction reprocesses it with the extractor to extracted", async () => {
    const { documentId, extractionId } = await deliverFailed();
    produce = kestrelOutput;
    const res = await post(`/api/review/${extractionId}/retry`);
    expect(res.status).toBe(202);
    const decision = ReviewDecision.parse(await res.json());
    expect(decision.status).toBe("pending");
    expect(decision.extractionId).not.toBe(extractionId);
    await Promise.all(background);

    const rows = await db<{ id: number; status: string; model: string; prompt_version: string }[]>`
      select id, status, model, prompt_version from extractions
      where document_id = ${documentId} order by id`;
    expect(rows).toEqual([
      {
        id: extractionId,
        status: "failed",
        model: "claude-haiku-5-5",
        prompt_version: "extract-quote/v2",
      },
      {
        id: decision.extractionId,
        status: "extracted",
        model: "claude-haiku-5-5",
        prompt_version: "extract-quote/v2",
      },
    ]);
    expect(await quoteCount()).toBe(1);
    expect(await auditOf("extraction.retried")).toHaveLength(1);
    // The superseded failed row can no longer be decided, and the queue no longer lists it.
    expect((await post(`/api/review/${extractionId}/retry`)).status).toBe(409);
    expect((await post(`/api/review/${extractionId}/reject`)).status).toBe(409);
    const listed = (await (await app.request("/api/review")).json()) as { items: unknown[] };
    expect(listed.items).toEqual([]);
  });

  it("retry on a needs_review extraction gives 409 and queues nothing", async () => {
    const { extractionId, documentId } = await deliverDoubtful();
    expect((await post(`/api/review/${extractionId}/retry`)).status).toBe(409);
    const [n] =
      await db`select count(*)::int as n from extractions where document_id = ${documentId}`;
    expect(Number(n?.n)).toBe(1);
    expect(background).toHaveLength(0);
  });

  it("every POST needs a JSON content-type, bodies without one included (415)", async () => {
    const { extractionId } = await deliverDoubtful();
    const body = JSON.stringify(await correction());
    for (const action of ["accept", "reject", "retry"]) {
      for (const type of [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
      ]) {
        const res = await post(`/api/review/${extractionId}/${action}`, body, type);
        expect(res.status, `${action} as ${type}`).toBe(415);
      }
    }
    expect(await statusOf(extractionId)).toBe("needs_review");
    expect(await quoteCount()).toBe(0);
  });

  it("an unknown IMO gives 422 with a message and writes nothing", async () => {
    const { extractionId } = await deliverDoubtful();
    const res = await post(
      `/api/review/${extractionId}/accept`,
      await correction({ vesselImo: "1234567" }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain("1234567");
    expect(await quoteCount()).toBe(0);
    expect(await statusOf(extractionId)).toBe("needs_review");
    expect(await auditOf("extraction.accepted")).toHaveLength(0);
  });

  it("an unknown port or supplier gives 422", async () => {
    const { extractionId } = await deliverDoubtful();
    expect(
      (
        await post(
          `/api/review/${extractionId}/accept`,
          await correction({ portUnlocode: "ZZZZZ" }),
        )
      ).status,
    ).toBe(422);
    expect(
      (await post(`/api/review/${extractionId}/accept`, await correction({ supplierId: 99999 })))
        .status,
    ).toBe(422);
    expect(await quoteCount()).toBe(0);
  });

  it("a malformed or invalid accept body gives 400; an unknown extraction 404", async () => {
    const { extractionId } = await deliverDoubtful();
    expect((await post(`/api/review/${extractionId}/accept`, "{nope")).status).toBe(400);
    expect(
      (await post(`/api/review/${extractionId}/accept`, await correction({ bargeFee: -1 }))).status,
    ).toBe(400);
    expect((await post("/api/review/999999/accept", await correction())).status).toBe(404);
    expect((await post("/api/review/abc/reject")).status).toBe(404);
    expect(await quoteCount()).toBe(0);
  });

  it("a failed extraction can be accepted with the human's values", async () => {
    const { extractionId } = await deliverFailed();
    const res = await post(`/api/review/${extractionId}/accept`, await correction());
    expect(res.status).toBe(200);
    expect(await quoteCount()).toBe(1);
    const [row] = await auditOf("extraction.accepted");
    // Nothing was read from the email, so every field is a change.
    const fields = changesOf(row).map((c) => c.field);
    expect(fields).toEqual(
      expect.arrayContaining(["vesselId", "portId", "supplierId", "currency", "bargeFee", "lines"]),
    );
  });

  it("an old failed row with no error shows its stored processing check", async () => {
    const { extractionId } = await deliverFailed();
    await db`
      update extractions set error = null,
        check_results = '[{"check":"processing","passed":false,"detail":"old message"}]'::jsonb
      where id = ${extractionId}`;
    const { items } = (await (await app.request("/api/review")).json()) as {
      items: { failedChecks: unknown[] }[];
    };
    expect(items[0]?.failedChecks).toEqual([
      { check: "processing", passed: false, detail: "old message" },
    ]);
  });

  it("GET /api/review/reference offers the vessels, ports and suppliers", async () => {
    const res = await app.request("/api/review/reference");
    expect(res.status).toBe(200);
    const body = ReviewReference.parse(await res.json());
    expect(body.vessels.map((v) => v.imo)).toContain("9480019");
    expect(body.ports.length).toBeGreaterThan(0);
    expect(body.suppliers.map((s) => s.name)).toContain("Kestrel Marine Fuels");
  });

  it('GET / contains "Review queue"', async () => {
    const html = await (await app.request("/")).text();
    expect(html).toContain("Review queue");
  });
});
