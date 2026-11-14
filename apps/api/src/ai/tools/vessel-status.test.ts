import { DEMO_SCENARIO, type Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DOMAIN_CODE_VERSION } from "@pharos/domain";
import { Fact, FactId, FobProjection } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { getVesselStatus, VesselStatusInput, vesselStatusTool } from "./vessel-status.js";

const sql = await connectTestDb("ask_vessel_status");

if (!sql) {
  describe("get_vessel_status (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_vessel_status")}`, () => {});
  });
}

describe.skipIf(!sql)("get_vessel_status (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  beforeAll(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const byId = (facts: Fact[], suffix: string) => {
    const hit = facts.find((f) => f.id.endsWith(suffix));
    expect(hit, `fact ending ${suffix}`).toBeDefined();
    return hit as Fact;
  };

  it("input is strict: only a vessel name or IMO", () => {
    expect(() => VesselStatusInput.parse({ vessel: "Aegean Pioneer", speedKn: 11 })).toThrow();
    expect(() => vesselStatusTool(ctx()).parse?.({ vessel: "" })).toThrow();
  });

  it("returns ROB from the latest noon report, the stored FOB projection, next port and ETA", async () => {
    const c = ctx();
    const result = await getVesselStatus(c, { vessel: "Aegean Pioneer" });
    for (const f of result.facts) expect(() => Fact.parse(f)).not.toThrow();

    const [report] = await db<{ id: number; rob_mt: { LSMGO: number } }[]>`
      select n.id, n.rob_mt from noon_reports n join vessels v on v.id = n.vessel_id
      where v.imo = ${DEMO_SCENARIO.vesselImo} order by n.ts desc limit 1`;
    if (!report) throw new Error("no noon report");
    const rob = byId(result.facts, `_${report.id}_noon_reports.robMt.LSMGO`);
    expect(rob.id).toBe(`f_get_vessel_status_${report.id}_noon_reports.robMt.LSMGO`);
    expect(rob.value).toBe(report.rob_mt.LSMGO);
    expect(rob.unit).toBe("mt");
    expect(rob.provenance).toEqual({
      source: "db",
      table: "noon_reports",
      rowId: report.id,
      field: "robMt.LSMGO",
    });

    const [calc] = await db<
      { id: number; kind: string; outputs: unknown; code_version: string; voyage_id: number }[]
    >`select id, kind, outputs, code_version, voyage_id from calculations order by id desc limit 1`;
    if (!calc) throw new Error("no calculation stored");
    expect(calc.kind).toBe("fob_projection");
    expect(calc.code_version).toBe(DOMAIN_CODE_VERSION);
    const fob = FobProjection.parse(calc.outputs);
    expect(fob.shortfallMt.LSMGO).toBeGreaterThan(0);

    for (const field of ["requiredMt", "safetyMarginMt", "shortfallMt"] as const) {
      const f = byId(result.facts, `_${calc.id}_${field}.LSMGO`);
      expect(f.id).toBe(`f_get_vessel_status_${calc.id}_${field}.LSMGO`);
      expect(f.value).toBe(fob[field].LSMGO);
      expect(f.provenance).toEqual({
        source: "calculation",
        calculationId: calc.id,
        calculator: "projectFuelOnBoard",
        path: `${field}.LSMGO`,
      });
    }

    const imo = result.facts.find((f) => f.provenance.source === "db" && f.label.includes("IMO"));
    expect(imo?.value).toBe(DEMO_SCENARIO.vesselImo);
    const voyage = result.facts.find((f) => f.value === DEMO_SCENARIO.voyageNo);
    expect(voyage).toBeDefined();

    const [next] = await db<{ id: number; eta: Date; name: string; port_id: number }[]>`
      select c.id, c.eta, p.name, p.id as port_id from port_calls c
      join ports p on p.id = c.port_id
      join voyages v on v.id = c.voyage_id
      where v.voyage_no = ${DEMO_SCENARIO.voyageNo} and c.eta >= ${ASK_FIXTURE_NOW.toISOString()}::timestamptz
      order by c.eta limit 1`;
    if (!next) throw new Error("no upcoming port call");
    expect(byId(result.facts, `_${next.id}_port_calls.eta`).value).toBe(
      new Date(next.eta).toISOString(),
    );
    expect(byId(result.facts, `_${next.port_id}_ports.name`).value).toBe(next.name);

    // Every fact went into the conversation ledger, and the call was logged.
    for (const f of result.facts) expect(c.ledger.get(f.id)).toEqual(f);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ tool: "get_vessel_status", isError: false });
  });

  it("resolves the same vessel by IMO, and fact ids are valid FactIds", async () => {
    const result = await getVesselStatus(ctx(), { vessel: `IMO ${DEMO_SCENARIO.vesselImo}` });
    expect(result.facts.find((f) => f.value === DEMO_SCENARIO.vesselImo)).toBeDefined();
    for (const f of result.facts) expect(FactId.safeParse(f.id).success).toBe(true);
  });

  it("reads an IMO only as a standalone 7-digit number", async () => {
    // Eight digits are not an IMO, so the text is taken as a name.
    await expect(getVesselStatus(ctx(), { vessel: `${DEMO_SCENARIO.vesselImo}1` })).rejects.toThrow(
      /No fleet vessel is named/,
    );
  });

  it("fact labels carry no numbers (an uncited number in a label would reach the operator)", async () => {
    const result = await getVesselStatus(ctx(), { vessel: "Aegean Pioneer" });
    for (const f of result.facts) expect(f.label).not.toMatch(/\d/);
  });

  it("fails with a reason for an unknown vessel and logs the failed call", async () => {
    const c = ctx();
    await expect(getVesselStatus(c, { vessel: "MV Nonexistent" })).rejects.toThrow(
      /No fleet vessel is named/,
    );
    expect(c.calls[0]).toMatchObject({ tool: "get_vessel_status", isError: true });
    expect(c.ledger.size).toBe(0);
  });

  it("the tool result text is the ToolResult JSON", async () => {
    const text = await vesselStatusTool(ctx()).run({ vessel: "Aegean Pioneer" });
    expect(typeof text).toBe("string");
    const parsed = JSON.parse(text as string) as { facts: unknown[]; data: unknown };
    expect(parsed.facts.length).toBeGreaterThan(0);
    expect(parsed.data).toBeDefined();
  });
});
