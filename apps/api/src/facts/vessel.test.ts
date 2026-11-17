import { currentVoyage, loadWorld, type Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { FUEL_GRADES, VesselDetail } from "@pharos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createToolContext } from "../ai/tools/common.js";
import { getVesselStatus } from "../ai/tools/vessel-status.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../ask/demo-fixture.js";
import { createDbSource } from "../read/db-source.js";

const sql = await connectTestDb("facts_vessel");

if (!sql) {
  describe("vessel facts (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("facts_vessel")}`, () => {});
  });
}

describe.skipIf(!sql)("vessel facts (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const ctx = () => createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });

  // A freshly reset database (identities restarted) for every test, so the serial calculation
  // ids in fact ids are the same on every run.
  beforeEach(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const IDLE_VESSEL = "MT Levant Carrier";

  /** Completes the vessel's voyages, so it has no current voyage. */
  const idle = async (name: string): Promise<void> => {
    await db`
      update voyages set status = 'completed'
      where vessel_id = (select id from vessels where name = ${name})`;
    const world = await loadWorld(db);
    const vessel = world.vessels.find((v) => v.name === name);
    if (!vessel || currentVoyage(world, vessel.id) !== null) {
      throw new Error(`${name} still has a current voyage`);
    }
  };

  // The tool's facts go into every later model request, and recorded replies are keyed on those
  // bytes: this pins them whole.
  it("get_vessel_status facts are unchanged", async () => {
    const aegean = await getVesselStatus(ctx(), { vessel: "MV Aegean Pioneer" });
    expect(JSON.stringify(aegean)).toMatchSnapshot();

    await idle(IDLE_VESSEL);
    const noVoyage = await getVesselStatus(ctx(), { vessel: IDLE_VESSEL });
    expect(JSON.stringify(noVoyage)).toMatchSnapshot();
  });

  const detailOf = async (name: string): Promise<VesselDetail> => {
    const source = createDbSource(db, () => ASK_FIXTURE_NOW);
    const summary = (await source.listVessels()).find((v) => v.name === name);
    const detail = summary ? await source.getVessel(summary.id) : null;
    if (!detail) throw new Error(`no vessel ${name}`);
    return VesselDetail.parse(detail);
  };

  it("detail facts are the tool's facts", async () => {
    const tool = await getVesselStatus(ctx(), { vessel: "MV Aegean Pioneer" });
    const detail = await detailOf("MV Aegean Pioneer");
    const { robMt, voyageNo, nextPort, nextPortEta } = detail.facts;
    if (!robMt || !voyageNo || !nextPort || !nextPortEta) throw new Error("facts are missing");

    const named = [...FUEL_GRADES.map((g) => robMt[g]), voyageNo, nextPort, nextPortEta];
    for (const fact of named) {
      expect(tool.facts.find((f) => f.id === fact.id)).toEqual(fact);
    }
    expect(robMt.LSMGO.value).toBe(detail.robMt.LSMGO);
    expect(voyageNo.value).toBe("AP-2611");
  });

  it("vessel without a voyage", async () => {
    await idle(IDLE_VESSEL);
    const detail = await detailOf(IDLE_VESSEL);
    expect(detail.facts).toEqual({
      robMt: null,
      voyageNo: null,
      nextPort: null,
      nextPortEta: null,
    });
  });
});
