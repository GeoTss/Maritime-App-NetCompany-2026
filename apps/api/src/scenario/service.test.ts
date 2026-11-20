import { DEFAULT_WORLD_SEED, generateWorld, type Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { greatCircleNm } from "@pharos/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareAskFixture } from "../ask/demo-fixture.js";
import { createClock } from "../clock.js";
import { FIXTURE_ANCHOR } from "../read/fixtures.js";
import { planRouteSpeed } from "../routing/plan.js";
import { createScenarioRoutes } from "./routes.js";
import {
  addHazard,
  addWeatherArea,
  patchVessel,
  readScenario,
  resetScenario,
  type ScenarioDeps,
  ScenarioError,
} from "./service.js";

const sql = await connectTestDb("scenario");

if (!sql) {
  describe("demo scenario (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("scenario")}`, () => {});
  });
}

describe.skipIf(!sql)("demo scenario (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const clock = createClock(FIXTURE_ANCHOR);
  const deps: ScenarioDeps = {
    sql: db,
    clock,
    config: { demoControls: true, demoStorm: false, worldSeed: DEFAULT_WORLD_SEED },
  };
  const plan = () => planRouteSpeed({ sql: db, now: clock.now }, { vessel: "Aegean Pioneer" });
  let pioneer = 0;

  beforeAll(async () => {
    await prepareAskFixture(db);
    const view = await readScenario(deps);
    pioneer = view.vessels.find((v) => v.name.endsWith("Aegean Pioneer"))?.id ?? 0;
  });
  afterAll(async () => {
    await db.end();
  });

  const refused = async (p: Promise<unknown>, status: number, message: RegExp) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ScenarioError);
    expect((err as ScenarioError).status).toBe(status);
    expect((err as ScenarioError).message).toMatch(message);
  };

  it("off unless pinned and recorded", async () => {
    const live = { ...deps, clock: createClock(null) };
    const view = await readScenario(live);
    expect(view.enabled).toBe(false);
    expect(view.reason).toMatch(/not pinned/);
    await refused(patchVessel(live, pioneer, { dailyCostUsd: 1 }), 403, /not pinned/);
    const off = { ...deps, config: { ...deps.config, demoControls: false } };
    await refused(
      addHazard(off, { label: "x", lat: 35, lon: 20, radiusNm: 5 }),
      403,
      /DEMO_CONTROLS/,
    );
  });

  it("patch then plan sees it", async () => {
    const view = await patchVessel(deps, pioneer, { robMt: { VLSFO: 300 } });
    expect(view.edited).toBe(true);
    expect(view.vessels.find((v) => v.id === pioneer)?.values.robMt.VLSFO).toBe(300);
    const planned = await plan();
    expect(planned.plan.input.fuel?.robMt.VLSFO).toBe(300);
  });

  it("rejects rob over capacity", async () => {
    const before = (await readScenario(deps)).vessels.find((v) => v.id === pioneer)?.values;
    const cap = before?.tankCapacityMt.VLSFO ?? 0;
    await refused(patchVessel(deps, pioneer, { robMt: { VLSFO: cap + 1 } }), 422, /robMt\.VLSFO/);
    const after = (await readScenario(deps)).vessels.find((v) => v.id === pioneer)?.values;
    expect(after).toEqual(before);
  });

  it("ais ship not editable", async () => {
    await refused(patchVessel(deps, 99_999, { dailyCostUsd: 1 }), 404, /AIS/);
  });

  it("rejects empty area", async () => {
    // Between the 2° grid points: the nearest is about 77 nm away.
    const area = {
      label: "Squall",
      center: { lat: 35, lon: 21 },
      radiusNm: 30,
      waveHeightM: 5,
      waveDirDeg: 270,
      windSpeedKn: 30,
      windDirDeg: 270,
    };
    await refused(addWeatherArea(deps, area), 422, /No forecast point lies inside this area/);
  });

  it("weather area reaches the plan", async () => {
    const before = await plan();
    expect(before.plan.stormCells ?? []).toHaveLength(0);
    await addWeatherArea(deps, {
      label: "Gale west of Crete",
      center: { lat: 35, lon: 21 },
      radiusNm: 150,
      waveHeightM: 8,
      waveDirDeg: 270,
      windSpeedKn: 45,
      windDirDeg: 280,
    });
    const after = await plan();
    const meets =
      (after.plan.stormCells ?? []).length > 0 ||
      after.response.result.options.some((o) => o.reasons.includes("heavy_weather"));
    expect(meets).toBe(true);
  });

  it("a gale the route meets after the forecast still turns it", async () => {
    // The case from the console: Atlantic Meridian (Fujairah to Rotterdam) reaches the South
    // Atlantic weeks after the 10-day forecast ends; a 12 m gale off Angola must still count.
    await addWeatherArea(deps, {
      label: "Gale off Angola",
      center: { lat: -10.87, lon: -1.18 },
      radiusNm: 300,
      waveHeightM: 12,
      waveDirDeg: 200,
      windSpeedKn: 55,
      windDirDeg: 210,
    });
    const planned = await planRouteSpeed(
      { sql: db, now: clock.now },
      { vessel: "Atlantic Meridian" },
    );
    const gale = (planned.plan.stormCells ?? []).filter((c) => c.stationary && c.center.lat < -5);
    expect(gale.length).toBeGreaterThan(0);
    // Round the Cape, the route now keeps clear of every cell of the gale (it went straight
    // through when the gale vanished at the forecast's end).
    const cape = planned.plan.input.candidates.find((c) => c.id === "K");
    expect(cape).toBeDefined();
    for (const cell of gale) {
      const closest = Math.min(...(cape?.points ?? []).map((p) => greatCircleNm(p, cell.center)));
      expect(closest, cell.id).toBeGreaterThan(cell.radiusNm - 5);
    }
    // Whatever still goes through heavy weather is flagged, past the forecast or not.
    for (const o of planned.response.result.options) {
      if (o.maxWaveHeightM > 6) expect(o.reasons).toContain("heavy_weather");
    }
  });

  it("routes answer 422 for a bad body and 200 with the view", async () => {
    const app = createScenarioRoutes(deps);
    const ok = await app.request("/");
    expect(ok.status).toBe(200);
    const bad = await app.request(`/vessels/${pioneer}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consumption: { minSpeedKn: 1 } }),
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { message: string }).message).toMatch(/consumption\.minSpeedKn/);
  });

  it("reset restores the demo", async () => {
    await addHazard(deps, { label: "Container adrift", lat: 36, lon: 18, radiusNm: 5 });
    const view = await resetScenario(deps);
    expect(view.edited).toBe(false);
    expect(view.weatherAreas).toEqual([]);
    expect(view.hazards.filter((h) => h.source === "synthetic").map((h) => h.id)).toEqual([
      "synthetic:1",
    ]);
    const world = generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR });
    const seeded = world.noonReports
      .filter((r) => r.vesselId === pioneer)
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0];
    expect(view.vessels.find((v) => v.id === pioneer)?.values.robMt).toEqual(seeded?.robMt);
  });
});
