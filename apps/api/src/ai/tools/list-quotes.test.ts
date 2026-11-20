import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { toUsd } from "@pharos/domain";
import { type Fact, FactId, ListQuotesInput, type ToolResult } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { listQuotes, listQuotesDef } from "./list-quotes.js";

const sql = await connectTestDb("ask_list_quotes");

if (!sql) {
  describe("list_quotes (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_list_quotes")}`, () => {});
  });
}

type QuoteData = { supplier: string; port: string; expired: boolean; status: string };
const quotesOf = (r: ToolResult) => (r.data as { quotes: QuoteData[] }).quotes;
const suppliersOf = (r: ToolResult) => quotesOf(r).map((q) => `${q.supplier} @ ${q.port}`);

describe.skipIf(!sql)("list_quotes (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
  /** The demo quotes: Kestrel at Marsaxlokk (USD), then Strait Line at Gibraltar (USD). */
  let kestrelId: number;
  let straitId: number;

  beforeEach(async () => {
    [kestrelId, straitId] = (await prepareAskFixture(db)) as [number, number];
  });
  afterAll(async () => {
    await db.end();
  });

  const fact = (r: ToolResult, id: string): Fact => {
    const hit = r.facts.find((f) => f.id === id);
    expect(hit, id).toBeDefined();
    return hit as Fact;
  };
  const lineId = async (quoteId: number) => {
    const [line] = await db<{ id: number }[]>`
      select id from quote_lines where quote_id = ${quoteId} order by id limit 1`;
    if (!line) throw new Error(`quote ${quoteId} has no line`);
    return line.id;
  };

  it("input is strict", () => {
    expect(() => ListQuotesInput.parse({ pricePerMt: 700 })).toThrow();
    expect(() => listQuotesDef.inputSchema.parse({ grade: "MGO" })).toThrow();
  });

  it("lists the received demo quotes with citable facts per quote and per line", async () => {
    const result = await listQuotes(ctx(), {});
    expect(suppliersOf(result)).toEqual([
      "Kestrel Marine Fuels @ Marsaxlokk",
      "Strait Line Fuels @ Gibraltar",
    ]);
    const line = await lineId(kestrelId);
    const q = "Kestrel Marine Fuels quote at Marsaxlokk";
    const l = `${q}, LSMGO`;
    expect(fact(result, `f_list_quotes_${line}_quote_lines.pricePerMt`)).toEqual({
      id: `f_list_quotes_${line}_quote_lines.pricePerMt`,
      label: `${l}: price per mt`,
      value: 738,
      unit: "USD/mt",
      provenance: { source: "db", table: "quote_lines", rowId: line, field: "pricePerMt" },
    });
    expect(fact(result, `f_list_quotes_${line}_quote_lines.qtyMt`)).toMatchObject({
      label: `${l}: quantity offered`,
      value: 300,
      unit: "mt",
    });
    expect(fact(result, `f_list_quotes_${line}_quote_lines.grade`)).toMatchObject({
      label: `${l}: grade`,
      value: "LSMGO",
    });
    expect(fact(result, `f_list_quotes_${kestrelId}_quotes.bargeFee`)).toMatchObject({
      label: `${q}: barge fee`,
      value: 2800,
      unit: "USD",
      provenance: { source: "db", table: "quotes", rowId: kestrelId, field: "bargeFee" },
    });
    expect(fact(result, `f_list_quotes_${kestrelId}_quotes.supplier`)).toMatchObject({
      label: `${q}: supplier`,
      value: "Kestrel Marine Fuels",
      provenance: { source: "db", table: "suppliers", field: "name" },
    });
    expect(fact(result, `f_list_quotes_${kestrelId}_quotes.port`)).toMatchObject({
      label: `${q}: port`,
      value: "Marsaxlokk",
      provenance: { source: "db", table: "ports", field: "name" },
    });
    expect(fact(result, `f_list_quotes_${kestrelId}_quotes.status`).value).toBe("received");
    expect(fact(result, `f_list_quotes_${kestrelId}_quotes.expired`)).toMatchObject({
      label: `${q}: expired`,
      value: false,
    });
    // No validity stated, so no valid-until fact; USD quotes need no USD conversion.
    expect(result.facts.some((f) => f.id === `f_list_quotes_${kestrelId}_quotes.validUntil`)).toBe(
      false,
    );
    expect(result.facts.some((f) => f.id.endsWith("priceUsdPerMt"))).toBe(false);
    expect(JSON.stringify(result.data)).toMatch(/includeExpired/);
  });

  it("hides an expired quote and shows it, marked expired, with includeExpired", async () => {
    // Valid until the day before the clock's day: expired. (Stored at the day's start, UTC.)
    await db`update quotes set valid_until = '2026-11-13T00:00:00Z' where id = ${straitId}`;
    const hidden = await listQuotes(ctx(), {});
    expect(suppliersOf(hidden)).toEqual(["Kestrel Marine Fuels @ Marsaxlokk"]);
    expect(hidden.facts.some((f) => f.id.startsWith(`f_list_quotes_${straitId}_quotes.`))).toBe(
      false,
    );

    const shown = await listQuotes(ctx(), { includeExpired: true });
    const strait = quotesOf(shown).find((q) => q.supplier === "Strait Line Fuels");
    expect(strait?.expired).toBe(true);
    expect(fact(shown, `f_list_quotes_${straitId}_quotes.expired`)).toMatchObject({
      value: true,
      provenance: { source: "db", table: "quotes", rowId: straitId, field: "validUntil" },
    });
    expect(fact(shown, `f_list_quotes_${straitId}_quotes.validUntil`)).toMatchObject({
      label: "Strait Line Fuels quote at Gibraltar: valid until (UTC date)",
      value: "2026-11-13",
    });
    // The seeded history (ordered and expired competitors, validity days ago) shows up too.
    expect(quotesOf(shown).length).toBeGreaterThan(2);
    expect(quotesOf(shown).filter((q) => !q.expired)).toHaveLength(1);
  });

  it("a quote stays valid through its last day", async () => {
    await db`update quotes set valid_until = '2026-11-14T00:00:00Z' where id = ${straitId}`;
    const result = await listQuotes(ctx(), {});
    expect(suppliersOf(result)).toContain("Strait Line Fuels @ Gibraltar");
    expect(fact(result, `f_list_quotes_${straitId}_quotes.expired`).value).toBe(false);
  });

  it("quotes awaiting review or rejected are never listed", async () => {
    await db`update quotes set status = 'needs_review' where id = ${kestrelId}`;
    await db`update quotes set status = 'rejected' where id = ${straitId}`;
    const result = await listQuotes(ctx(), { includeExpired: true });
    expect(suppliersOf(result)).not.toContain("Kestrel Marine Fuels @ Marsaxlokk");
    expect(suppliersOf(result)).not.toContain("Strait Line Fuels @ Gibraltar");
  });

  it("a EUR price also comes in USD via the domain FX helper, with its lineage", async () => {
    const result = await listQuotes(ctx(), { includeExpired: true, port: "Algeciras" });
    expect(suppliersOf(result)).toEqual(["Nordwind Bunker Services @ Algeciras"]);
    const [row] = await db<{ quote_id: number; line_id: number; price: number }[]>`
      select q.id as quote_id, l.id as line_id, l.price_per_mt as price
      from quotes q join quote_lines l on l.quote_id = q.id
      join ports p on p.id = q.port_id where p.unlocode = 'ESALG'`;
    const [rate] = await db<{ id: number; value: number }[]>`
      select id, value from reference_rates where key = 'EURUSD'`;
    if (!row || !rate) throw new Error("fixture rows missing");
    const price = fact(result, `f_list_quotes_${row.line_id}_quote_lines.pricePerMt`);
    expect(price).toMatchObject({ value: row.price, unit: "EUR/mt" });
    const fx = fact(result, `f_list_quotes_${rate.id}_reference_rates.value`);
    expect(fx).toMatchObject({
      label: "EUR to USD exchange rate",
      value: rate.value,
      unit: "USD/EUR",
      provenance: { source: "db", table: "reference_rates", rowId: rate.id, field: "value" },
    });
    expect(fact(result, `f_list_quotes_${row.line_id}_quote_lines.priceUsdPerMt`)).toEqual({
      id: `f_list_quotes_${row.line_id}_quote_lines.priceUsdPerMt`,
      label: "Nordwind Bunker Services quote at Algeciras, VLSFO: price per mt in USD",
      value: toUsd(row.price, rate.value),
      unit: "USD/mt",
      provenance: { source: "derived", operation: "multiply", operands: [price.id, fx.id] },
    });
    expect(fact(result, `f_list_quotes_${row.quote_id}_quotes.bargeFee`).unit).toBe("EUR");
  });

  it("filters by port (name or UN/LOCODE), grade and vessel", async () => {
    expect(suppliersOf(await listQuotes(ctx(), { port: "gigib" }))).toEqual([
      "Strait Line Fuels @ Gibraltar",
    ]);
    expect(suppliersOf(await listQuotes(ctx(), { port: "Marsaxlokk" }))).toEqual([
      "Kestrel Marine Fuels @ Marsaxlokk",
    ]);
    expect(quotesOf(await listQuotes(ctx(), { grade: "VLSFO" }))).toEqual([]);
    expect(suppliersOf(await listQuotes(ctx(), { vessel: "Aegean Pioneer" }))).toHaveLength(2);
    // Thessaly Star's history: Kestrel (ordered) and Meridian (expired) at Piraeus, both past validity.
    expect(quotesOf(await listQuotes(ctx(), { vessel: "Thessaly Star" }))).toEqual([]);
    const history = await listQuotes(ctx(), { vessel: "Thessaly Star", includeExpired: true });
    expect(quotesOf(history).map((q) => [q.supplier, q.status])).toEqual([
      ["Kestrel Marine Fuels", "ordered"],
      ["Meridian Bunkering", "expired"],
    ]);
  });

  it("an unknown port is a tool error", async () => {
    await expect(listQuotes(ctx(), { port: "Atlantis" })).rejects.toThrow(/Atlantis/);
  });

  it("facts are valid and their labels carry no numbers", async () => {
    const result = await listQuotes(ctx(), { includeExpired: true });
    for (const f of result.facts) {
      expect(() => FactId.parse(f.id)).not.toThrow();
      expect(f.label).not.toMatch(/\d/);
    }
    // Fact ids are unique within one result.
    expect(new Set(result.facts.map((f) => f.id)).size).toBe(result.facts.length);
  });

  it("lists security quotes (Track 3) unless a grade is asked, never one for another vessel", async () => {
    const id = async (sqlText: string) => (await db.unsafe<{ id: number }[]>(sqlText))[0]?.id ?? 0;
    const fjr = await id("select id from ports where unlocode = 'AEFJR'");
    const djb = await id("select id from ports where unlocode = 'DJJIB'");
    const tri = await id("select id from security_providers where erp_code = 'SEC-TRI'");
    const add = (imo: string | null, status: string) => db`
      insert into security_quotes (provider_id, vessel_imo, embark_port_id, disembark_port_id,
        team_size, day_rate, fixed_fees, min_days, currency, valid_until, status, extraction_id,
        received_at)
      values (${tri}, ${imo}, ${fjr}, ${djb}, 4, 1250, 6500, 4, 'USD', null, ${status}, null,
        ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    await add(null, "received");
    await add("0000000", "received");
    await add(null, "needs_review");
    const [am] = await db<
      { imo: string }[]
    >`select imo from vessels where name = 'MT Atlantic Meridian'`;
    const r = await listQuotes(ctx(), { vessel: am?.imo ?? "" });
    const sec = (r.data as { securityQuotes?: { provider: string; embark: string }[] })
      .securityQuotes;
    expect(sec).toEqual([
      expect.objectContaining({ provider: "Tridentis Marine Protection", embark: "Fujairah" }),
    ]);
    expect(r.facts.some((f) => f.label.endsWith("day rate for the team") && f.value === 1250)).toBe(
      true,
    );
    const graded = await listQuotes(ctx(), { grade: "LSMGO" });
    expect((graded.data as { securityQuotes?: unknown }).securityQuotes).toBeUndefined();
  });
});
