/**
 * The database state the demo ask is recorded and replayed against: the seeded world (fixture seed
 * and anchor) plus the two demo quotes that pass extraction (Kestrel at Marsaxlokk, Strait Line at
 * Gibraltar), inserted directly as `received` quotes for the open requirement, in that order.
 *
 * Replay keys are hashes of the request bodies, which carry serial ids (calculation ids in fact
 * ids). Building the database the same way every time keeps those ids, and so the keys, stable.
 */
import { DEMO_SCENARIO, generateWorld, type Sql, seedDatabase } from "@pharos/db";
import { loadRecordedSources } from "@pharos/integrations";
import type { Id } from "@pharos/shared";
import { buildDemoEmails, FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";

/** The question Task 9's live smoke asks. */
export const DEMO_QUESTION = "Where should Aegean Pioneer bunker, and who should we buy from?";

/** The agent clock for recording and replay: five minutes after the world anchor. */
export const ASK_FIXTURE_NOW = new Date(FIXTURE_ANCHOR.getTime() + 5 * 60_000);

/** The demo offers that become quotes, in insertion order. */
export const DEMO_QUOTE_SUPPLIERS = ["kestrel", "straitline"] as const;

/** Inserts the two demo quotes (with one line each) and returns their ids in insertion order. */
export async function insertDemoQuotes(sql: Sql): Promise<Id[]> {
  const world = generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR });
  const emails = buildDemoEmails(world);
  const [requirement] = await sql<{ id: number }[]>`
    select r.id from bunker_requirements r join voyages v on v.id = r.voyage_id
    where v.voyage_no = ${DEMO_SCENARIO.voyageNo} and r.grade = ${DEMO_SCENARIO.requirement.grade}
      and r.status = 'open'
    order by r.id limit 1`;
  if (!requirement) throw new Error("demo fixture: no open requirement on the demo voyage");

  const ids: Id[] = [];
  for (const key of DEMO_QUOTE_SUPPLIERS) {
    const email = emails.find((e) => e.option.supplierKey === key);
    if (!email) throw new Error(`demo fixture: no demo email for ${key}`);
    const o = email.option;
    const [quote] = await sql<{ id: number }[]>`
      insert into quotes (supplier_id, port_id, requirement_id, delivery_from, delivery_to,
                          valid_until, currency, barge_fee, status, extraction_id, received_at)
      values ((select id from suppliers where name = ${email.supplierName}),
              (select id from ports where unlocode = ${o.portLocode}),
              ${requirement.id}, null, null, null, ${o.currency}, ${o.bargeFee}, 'received', null,
              ${email.receivedAt.toISOString()}::timestamptz)
      returning id`;
    if (!quote) throw new Error("demo fixture: quotes insert returned no row");
    await sql`
      insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
      values (${quote.id}, ${DEMO_SCENARIO.requirement.grade}, ${o.qtyMt}, ${o.pricePerMt})`;
    ids.push(quote.id);
  }
  return ids;
}

/**
 * Resets the database to the seeded world, loads the recorded AIS capture, weather snapshot and
 * synthetic hazard as observed at the anchor, and inserts the two demo quotes.
 */
export async function prepareAskFixture(sql: Sql): Promise<Id[]> {
  await seedDatabase(sql, { seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
  await loadRecordedSources(sql, { anchor: FIXTURE_ANCHOR });
  return insertDemoQuotes(sql);
}
