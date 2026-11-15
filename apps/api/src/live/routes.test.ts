import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import {
  AisTrafficList,
  type Fact,
  HazardZoneList,
  PortCongestionList,
  RoutePlanResponse,
  SourceStatusList,
  WeatherView,
} from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createToolContext } from "../ai/tools/common.js";
import { planRouteSpeedFacts } from "../ai/tools/route-speed.js";
import { createApp } from "../app.js";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../ask/demo-fixture.js";
import { createFixtureSource } from "../read/fixtures.js";
import { TRAFFIC_LIMIT } from "./routes.js";

const sql = await connectTestDb("live_routes");

if (!sql) {
  describe("live routes (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("live_routes")}`, () => {});
  });
}

describe.skipIf(!sql)("live routes (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const app = createApp({
    llmMode: "replay",
    pingDb: async () => true,
    read: createFixtureSource(),
    live: { sql: db, now: () => ASK_FIXTURE_NOW },
  });

  beforeAll(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const post = (body: unknown, contentType: string | null = "application/json") =>
    app.request("/api/route-plan", {
      method: "POST",
      headers: contentType ? { "content-type": contentType } : {},
      body: JSON.stringify(body),
    });

  it("POST /api/route-plan answers 200 with candidates and a result", async () => {
    const res = await post({ vessel: "Aegean Pioneer" });
    expect(res.status).toBe(200);
    const body = RoutePlanResponse.parse(await res.json());
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.result.options).toHaveLength(body.candidates.length);
    const [row] = await db<{ kind: string }[]>`
      select kind from calculations where id = ${body.calculationId}`;
    expect(row?.kind).toBe("route_speed");
  });

  it("POST /api/route-plan serves the facts plan_route_speed returns for the same input", async () => {
    // Each plan stores its own calculation, so ids differ; compare with the id taken out.
    const keyed = (facts: Fact[], id: number) =>
      facts.map((f) => {
        const p = f.provenance;
        return {
          ...f,
          id: f.id.replace(`f_plan_route_speed_${id}_`, "f_plan_route_speed_CALC_"),
          value: f.label === "Route calculation id" ? "CALC" : f.value,
          provenance:
            p.source === "calculation"
              ? { ...p, calculationId: 0 }
              : p.source === "db" && p.table === "calculations"
                ? { ...p, rowId: 0 }
                : p,
        };
      });
    for (const input of [{ vessel: "Thessaly Star" }, { vessel: "Aegean Pioneer" }]) {
      const res = await post(input);
      expect(res.status).toBe(200);
      const body = RoutePlanResponse.parse(await res.json());
      const tool = await planRouteSpeedFacts(
        createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW }),
        input,
      );
      const { calculationId } = tool.data as { calculationId: number };
      expect(body.facts.length).toBeGreaterThan(20);
      expect(keyed(body.facts, body.calculationId)).toEqual(keyed(tool.facts, calculationId));
      // Every number the map would show is a fact: the best option's figures are among them.
      const best = body.result.options.find((o) => o.candidateId === body.result.bestCandidateId);
      for (const v of [best?.distanceNm, best?.totalCostUsd, body.result.savingVsBaselineUsd]) {
        expect(body.facts.some((f) => f.value === v)).toBe(true);
      }
    }
  });

  it("POST /api/route-plan is 415 without a JSON content type and 422 for an unknown ship", async () => {
    expect((await post({ vessel: "Aegean Pioneer" }, "text/plain")).status).toBe(415);
    expect((await post({ vessel: "Aegean Pioneer" }, null)).status).toBe(415);
    const res = await post({ vessel: "No Such Ship" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toMatch(/No Such Ship/);
    expect((await post({ nope: 1 })).status).toBe(400);
  });

  it("GET /api/traffic parses and is bounded and newest first", async () => {
    const res = await app.request("/api/traffic");
    expect(res.status).toBe(200);
    const { items: views } = AisTrafficList.parse(await res.json());
    expect(views.length).toBeGreaterThan(0);
    expect(views.length).toBeLessThanOrEqual(TRAFFIC_LIMIT);
    const times = views.map((v) => Date.parse(v.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("GET /api/congestion returns one latest row per port", async () => {
    const { items: views } = PortCongestionList.parse(
      await (await app.request("/api/congestion")).json(),
    );
    expect(views.length).toBeGreaterThan(0);
    expect(new Set(views.map((v) => v.portId)).size).toBe(views.length);
  });

  it("GET /api/weather?step=n parses; a bad step is 400; no snapshot is 404", async () => {
    const view = WeatherView.parse(await (await app.request("/api/weather")).json());
    expect(view.step).toBe(0);
    // The forecast's first hour (stored as model_run), named for what it is.
    expect(view.forecastStart).toBe(view.startAt);
    expect(view).not.toHaveProperty("modelRun");
    expect(view.points.length).toBeGreaterThan(0);
    const later = WeatherView.parse(await (await app.request("/api/weather?step=3")).json());
    expect(later.step).toBe(3);
    expect((await app.request(`/api/weather?step=${view.steps}`)).status).toBe(400);
    expect((await app.request("/api/weather?step=x")).status).toBe(400);
    const empty = await connectTestDb("live_routes_empty");
    if (!empty) return;
    try {
      await empty`truncate weather_snapshots restart identity cascade`;
      const bare = createApp({
        llmMode: "replay",
        pingDb: async () => true,
        read: createFixtureSource(),
        live: { sql: empty, now: () => ASK_FIXTURE_NOW },
      });
      expect((await bare.request("/api/weather")).status).toBe(404);
    } finally {
      await empty.end();
    }
  });

  it("GET /api/sources and GET /api/hazards parse", async () => {
    const { items: parsed } = SourceStatusList.parse(
      await (await app.request("/api/sources")).json(),
    );
    expect(parsed.map((s) => s.source).sort()).toEqual(["ais", "weather"]);
    expect(parsed.every((s) => s.mode === "recorded")).toBe(true);
    const { items: views } = HazardZoneList.parse(await (await app.request("/api/hazards")).json());
    const synthetic = views.find((h) => h.id === "synthetic:1");
    expect(synthetic?.zoneRadiusNm).toBeGreaterThan(0);
  });

  it("is not mounted without deps.live", async () => {
    const bare = createApp({
      llmMode: "replay",
      pingDb: async () => true,
      read: createFixtureSource(),
    });
    expect((await bare.request("/api/traffic")).status).not.toBe(200);
  });
});
