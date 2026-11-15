import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { Fact, FactId, ListFleetInput } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { listFleet, listFleetTool } from "./list-fleet.js";

const sql = await connectTestDb("ask_list_fleet");

if (!sql) {
  describe("list_fleet (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_list_fleet")}`, () => {});
  });
}

describe.skipIf(!sql)("list_fleet (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  beforeAll(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  it("input takes no fields", () => {
    expect(() => ListFleetInput.parse({ vessel: "Aegean Pioneer" })).toThrow();
    expect(listFleetTool(ctx()).parse?.({})).toEqual({});
  });

  it("returns the 8 seed vessels, each with name, IMO, current voyage number and status", async () => {
    const result = await listFleet(ctx(), {});
    const data = result.data as {
      vessels: { name: string; imo: string; voyageNo: string | null; voyageStatus: string }[];
    };
    expect(data.vessels).toHaveLength(8);
    const vessels = await db<{ id: number; name: string; imo: string }[]>`
      select id, name, imo from vessels order by id`;
    expect(data.vessels.map((v) => v.name)).toEqual(vessels.map((v) => v.name));

    const pioneer = vessels.find((v) => v.name === "MV Aegean Pioneer");
    if (!pioneer) throw new Error("no demo vessel");
    const [voyage] = await db<{ id: number }[]>`select id from voyages where voyage_no = 'AP-2611'`;
    const byId = new Map(result.facts.map((f) => [f.id, f]));
    expect(byId.get(`f_list_fleet_${pioneer.id}_vessels.name`)).toMatchObject({
      label: "MV Aegean Pioneer: vessel name",
      value: "MV Aegean Pioneer",
      unit: null,
      provenance: { source: "db", table: "vessels", rowId: pioneer.id, field: "name" },
    });
    expect(byId.get(`f_list_fleet_${pioneer.id}_vessels.imo`)).toMatchObject({
      label: "MV Aegean Pioneer: IMO number",
      value: pioneer.imo,
      provenance: { source: "db", table: "vessels", rowId: pioneer.id, field: "imo" },
    });
    expect(byId.get(`f_list_fleet_${voyage?.id}_voyages.voyageNo`)).toMatchObject({
      label: "MV Aegean Pioneer: current voyage number",
      value: "AP-2611",
      provenance: { source: "db", table: "voyages", rowId: voyage?.id, field: "voyageNo" },
    });
    expect(byId.get(`f_list_fleet_${voyage?.id}_voyages.status`)).toMatchObject({
      label: "MV Aegean Pioneer: current voyage status",
      value: "underway",
      provenance: { source: "db", table: "voyages", rowId: voyage?.id, field: "status" },
    });
    // Four facts per vessel (every seed vessel has a current voyage).
    expect(result.facts).toHaveLength(32);
  });

  it("facts are valid, db-sourced, and carry no numbers other than the IMO", async () => {
    const result = await listFleet(ctx(), {});
    for (const f of result.facts) {
      expect(() => Fact.parse(f)).not.toThrow();
      expect(FactId.safeParse(f.id).success).toBe(true);
      expect(f.provenance.source).toBe("db");
      expect(typeof f.value).not.toBe("number");
      expect(f.label).not.toMatch(/\d/);
    }
  });
});
