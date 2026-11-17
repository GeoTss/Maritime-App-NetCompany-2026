import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createToolContext } from "../ai/tools/common.js";
import { planBunkering } from "../ai/tools/plan-bunkering.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../ask/demo-fixture.js";

const sql = await connectTestDb("facts_bunker");

if (!sql) {
  describe("bunker facts (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("facts_bunker")}`, () => {});
  });
}

describe.skipIf(!sql)("bunker facts (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  // A freshly reset database (identities restarted) for every test, so the serial calculation
  // ids in fact ids are the same on every run.
  let quoteIds: number[];
  beforeEach(async () => {
    quoteIds = await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  /**
   * A second open grade on the demo voyage: a VLSFO requirement, and Kestrel's quote (linked to
   * the LSMGO requirement) also offering VLSFO, so both plans have an option.
   */
  const addVlsfo = async () => {
    const [kestrelId] = quoteIds;
    await db`
      insert into bunker_requirements (voyage_id, grade, qty_mt, status, created_at)
      values ((select id from voyages where voyage_no = 'AP-2611'), 'VLSFO', 200, 'open',
              ${ASK_FIXTURE_NOW.toISOString()}::timestamptz)`;
    await db`
      insert into quote_lines (quote_id, grade, qty_mt, price_per_mt)
      values (${kestrelId ?? 0}, 'VLSFO', 200, 590)`;
  };

  // The tool's facts go into every later model request, and recorded replies are keyed on those
  // bytes: this pins them whole.
  it("plan_bunkering facts are unchanged", async () => {
    const single = await planBunkering(ctx(), { vessel: "MV Aegean Pioneer" });
    expect(JSON.stringify(single)).toMatchSnapshot();

    quoteIds = await prepareAskFixture(db);
    await addVlsfo();
    const twoGrades = await planBunkering(ctx(), { vessel: "MV Aegean Pioneer" });
    expect((twoGrades.data as { plans: unknown[] }).plans).toHaveLength(2);
    expect(JSON.stringify(twoGrades)).toMatchSnapshot();
  });
});
