import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWorld } from "./load-world.js";
import { seedDatabase } from "./seed/seed.js";
import { generateWorld } from "./seed/world.js";
import { connectTestDb, testDbLabel } from "./testing.js";

const SEED = 20261114;
const ANCHOR = new Date("2026-11-14T08:00:00.000Z");

const sql = await connectTestDb("load_world");

if (!sql) {
  describe("loadWorld (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("load_world")}`, () => {});
  });
}

describe.skipIf(!sql)("loadWorld (Postgres)", () => {
  if (!sql) return;
  beforeAll(async () => {
    await seedDatabase(sql, { seed: SEED, anchor: ANCHOR, mode: "reset" });
  });
  afterAll(async () => {
    await sql.end();
  });

  it("after seedDatabase(reset) deep-equals generateWorld for the same seed and anchor", async () => {
    const loaded = await loadWorld(sql);
    const generated = generateWorld({ seed: SEED, anchor: ANCHOR });
    // JSON round trip: compares values, not column or key order.
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it("is repeatable", async () => {
    expect(JSON.stringify(await loadWorld(sql))).toBe(JSON.stringify(await loadWorld(sql)));
  });
});
