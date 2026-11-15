import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { Fact } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { getPortCongestion, portCongestionTool } from "./port-congestion.js";

const sql = await connectTestDb("ask_port_congestion");

if (!sql) {
  describe("get_port_congestion (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_port_congestion")}`, () => {});
  });
}

describe.skipIf(!sql)("get_port_congestion (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  beforeAll(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const latest = async (unlocode: string) =>
    (
      await db<{ id: number; anchored_count: number; waiting_hours: number; source: string }[]>`
        select c.id, c.anchored_count, c.waiting_hours, c.source from port_congestion c
        join ports p on p.id = c.port_id where p.unlocode = ${unlocode}
        order by c.observed_at desc, c.id desc limit 1`
    )[0];

  it("returns the AIS row for a port in the capture and the seed row for one outside it", async () => {
    const aisPorts = await db<{ unlocode: string }[]>`
      select distinct p.unlocode from port_congestion c join ports p on p.id = c.port_id
      where c.source = 'ais' order by 1`;
    const seedOnly = await db<{ unlocode: string }[]>`
      select p.unlocode from ports p
      where not exists (select 1 from port_congestion c where c.port_id = p.id and c.source = 'ais')
        and exists (select 1 from port_congestion c where c.port_id = p.id and c.source = 'seed')
      order by 1`;
    const a = aisPorts[0];
    const s = seedOnly[0];
    if (!a || !s) throw new Error("fixture needs one AIS-read port and one seed-only port");

    for (const [unlocode, source] of [
      [a.unlocode, "ais"],
      [s.unlocode, "seed"],
    ] as const) {
      const out = await getPortCongestion(ctx(), { port: unlocode });
      for (const f of out.facts) expect(() => Fact.parse(f)).not.toThrow();
      const row = await latest(unlocode);
      expect(row?.source).toBe(source);
      expect(out.facts.find((f) => f.label.endsWith("congestion source"))?.value).toBe(source);
      expect(out.facts.find((f) => f.label.endsWith("vessels at anchor"))?.value).toBe(
        row?.anchored_count,
      );
      expect(out.facts.find((f) => f.label.endsWith("expected waiting time"))?.value).toBe(
        row?.waiting_hours,
      );
      expect(out.facts.find((f) => f.label.endsWith("observed at (UTC)"))).toBeDefined();
    }
  });

  it("an unknown port is a tool error", async () => {
    const c = ctx();
    await expect(getPortCongestion(c, { port: "Atlantis" })).rejects.toThrow(/Atlantis/);
    expect(c.calls[0]).toMatchObject({ isError: true });
  });

  it("the description says the figures are observed at the anchorage", () => {
    expect((portCongestionTool(ctx()) as unknown as { description: string }).description).toMatch(
      /observed at the anchorage/,
    );
  });
});
