/**
 * The database state the demo ask is recorded and replayed against: the seeded world (fixture seed
 * and anchor) plus the two demo quotes that pass extraction (Kestrel at Marsaxlokk, Strait Line at
 * Gibraltar), inserted directly as `received` quotes for the open requirement, in that order.
 *
 * Replay keys are hashes of the request bodies, which carry serial ids (calculation ids in fact
 * ids). Building the database the same way every time keeps those ids, and so the keys, stable.
 */
import {
  DEFAULT_WORLD_SEED,
  DEMO_SCENARIO,
  generateWorld,
  pinnedNow,
  type Sql,
  seedDatabase,
} from "@pharos/db";
import { loadRecordedSources } from "@pharos/integrations";
import type { Id } from "@pharos/shared";
import { buildDemoEmails, FIXTURE_ANCHOR } from "../read/fixtures.js";

/** The question Task 9's live smoke asks. */
export const DEMO_QUESTION = "Where should Aegean Pioneer bunker, and who should we buy from?";

/** The agent clock for recording and replay: five minutes after the world anchor (a pinned clock). */
export const ASK_FIXTURE_NOW = pinnedNow(FIXTURE_ANCHOR);

/** The demo offers that become quotes, in insertion order. */
export const DEMO_QUOTE_SUPPLIERS = ["kestrel", "straitline"] as const;

/** Inserts the two demo quotes (with one line each) and returns their ids in insertion order. */
export async function insertDemoQuotes(sql: Sql): Promise<Id[]> {
  const world = generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR });
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
 * Track 3: the two security offers of demo emails 04 and 05 for MT Atlantic Meridian's Fujairah
 * departure, as the pipeline stores them once extracted (validity at the start of its day). Only
 * the Q&A world adds them (`insertDemoSecurityQuotes`); the demo ask keeps the two fuel quotes.
 */
export const DEMO_SECURITY_QUOTES = [
  {
    provider: "Tridentis Marine Protection",
    vesselName: "MT Atlantic Meridian",
    embark: "AEFJR",
    disembark: "DJJIB",
    teamSize: 4,
    dayRate: 1250,
    fixedFees: 6000,
    minDays: 4,
    currency: "USD",
    validUntil: "2026-11-20",
  },
  {
    provider: "Harbourline Security Services",
    vesselName: "MT Atlantic Meridian",
    embark: "AEFJR",
    disembark: "ZADUR",
    teamSize: 3,
    dayRate: 1100,
    fixedFees: 5000,
    minDays: 5,
    currency: "USD",
    validUntil: "2026-11-21",
  },
] as const;

/** Inserts DEMO_SECURITY_QUOTES (received at the anchor) and returns their ids in order. */
export async function insertDemoSecurityQuotes(sql: Sql): Promise<Id[]> {
  const ids: Id[] = [];
  for (const q of DEMO_SECURITY_QUOTES) {
    const [row] = await sql<{ id: number }[]>`
      insert into security_quotes (provider_id, vessel_imo, embark_port_id, disembark_port_id,
                                   team_size, day_rate, fixed_fees, min_days, currency,
                                   valid_until, status, extraction_id, received_at)
      values ((select id from security_providers where name = ${q.provider}),
              (select imo from vessels where name = ${q.vesselName}),
              (select id from ports where unlocode = ${q.embark}),
              (select id from ports where unlocode = ${q.disembark}),
              ${q.teamSize}, ${q.dayRate}, ${q.fixedFees}, ${q.minDays}, ${q.currency},
              ${`${q.validUntil}T00:00:00.000Z`}::timestamptz, 'received', null,
              ${FIXTURE_ANCHOR.toISOString()}::timestamptz)
      returning id`;
    if (!row) throw new Error("demo fixture: security_quotes insert returned no row");
    ids.push(row.id);
  }
  return ids;
}

/**
 * Resets the database to the seeded world, loads the recorded AIS capture, weather snapshot and
 * synthetic hazard as observed at the anchor, and inserts the two demo quotes.
 */
export async function prepareAskFixture(sql: Sql): Promise<Id[]> {
  await seedDatabase(sql, { seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
  await loadRecordedSources(sql, { anchor: FIXTURE_ANCHOR });
  return insertDemoQuotes(sql);
}
