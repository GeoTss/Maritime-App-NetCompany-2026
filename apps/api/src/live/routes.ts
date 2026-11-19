/**
 * Live-data routes for the map and the route planner: POST /route-plan, GET /traffic, /congestion,
 * /weather, /hazards, /security-areas, /security-quotes and /sources (mounted under /api). Read-only  except that planning stores one
 * calculation.
 */
import type { CongestionMode, Sql } from "@pharos/db";
import { activeHazardZones, forecastStepAt } from "@pharos/domain";
import { latestWeatherSnapshot } from "@pharos/integrations";
import {
  type AisTrafficList,
  type AisTrafficView,
  type HazardZoneList,
  type HazardZoneView,
  PlanRouteSpeedInput,
  type PortCongestionList,
  type PortCongestionView,
  type RoutePlanResponse,
  type SecurityArea,
  type SecurityAreaList,
  type SecurityQuoteList,
  type SourceStatusList,
  type SourceStatusView,
  type WeatherView,
} from "@pharos/shared";
import { Hono } from "hono";
import { requireContentType } from "../http/require-content-type.js";
import { routePlanFacts } from "../routing/facts.js";
import {
  loadHazards,
  planRouteSpeed,
  RoutePlanError,
  type TrafficRow,
  toTraffic,
} from "../routing/plan.js";

export const TRAFFIC_LIMIT = 2000;

/** Danger areas rank by level, then by what they need: a no-go, an armed team, the premium. */
const LEVEL_RANK: readonly SecurityArea["level"][] = [
  "CRITICAL",
  "SEVERE",
  "SUBSTANTIAL",
  "MODERATE",
  "LOW",
  "LISTED",
];
const POLICY_RANK: readonly SecurityArea["policy"][] = [
  "avoid",
  "guards",
  "premium",
  "escort",
  "measures",
];

export interface LiveDeps {
  sql: Sql;
  now: () => Date;
  /** Port waits for route plans: "seed" on the pinned demo clock (the default), else "latest". */
  congestion?: CongestionMode;
}

const iso = (d: string | Date): string => new Date(d).toISOString();

export function createLiveRoutes(deps: LiveDeps) {
  const app = new Hono();
  const { sql } = deps;

  app.post("/route-plan", requireContentType("application/json"), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    }
    const parsed = PlanRouteSpeedInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", message: "Send { vessel, destination? } as JSON." },
        400,
      );
    }
    try {
      const planned = await planRouteSpeed(deps, parsed.data);
      const response: RoutePlanResponse = { ...planned.response, facts: routePlanFacts(planned) };
      return c.json(response);
    } catch (e) {
      if (e instanceof RoutePlanError) {
        return c.json({ error: "route_plan_failed", message: e.message }, 422);
      }
      throw e;
    }
  });

  app.get("/traffic", async (c) => {
    const rows = await sql<TrafficRow[]>`
      select * from ais_traffic order by updated_at desc, mmsi limit ${TRAFFIC_LIMIT}`;
    const items: AisTrafficView[] = rows.map((r) => {
      const t = toTraffic(r);
      return { ...t, updatedAt: t.updatedAt.toISOString() };
    });
    return c.json({ items } satisfies AisTrafficList);
  });

  app.get("/hazards", async (c) => {
    const hazards = await loadHazards(sql);
    const radius = new Map(activeHazardZones(hazards, deps.now()).map((z) => [z.id, z.radiusNm]));
    const items: HazardZoneView[] = hazards.flatMap((h) => {
      const zoneRadiusNm = radius.get(h.id);
      return zoneRadiusNm === undefined
        ? []
        : [{ ...h, observedAt: h.observedAt.toISOString(), zoneRadiusNm }];
    });
    return c.json({ items } satisfies HazardZoneList);
  });

  // Track 3: the danger areas, ranked most-needed first (level, then what the area needs).
  app.get("/security-areas", async (c) => {
    const rows = await sql<SecurityArea[]>`
      select id, name, level, policy, boxes, as_of as "asOf", source, note from security_areas`;
    const items = [...rows].sort(
      (a, b) =>
        LEVEL_RANK.indexOf(a.level) - LEVEL_RANK.indexOf(b.level) ||
        POLICY_RANK.indexOf(a.policy) - POLICY_RANK.indexOf(b.policy) ||
        a.name.localeCompare(b.name),
    );
    return c.json({ items } satisfies SecurityAreaList);
  });

  app.get("/security-quotes", async (c) => {
    const rows = await sql<
      {
        id: number;
        provider_name: string;
        embark_port_name: string;
        disembark_port_name: string;
        team_size: number;
        day_rate: number;
        fixed_fees: number;
        min_days: number;
        currency: "USD" | "EUR";
        valid_until: string | Date | null;
        status: SecurityQuoteList["items"][number]["status"];
        received_at: string | Date;
      }[]
    >`select q.id, p.name as provider_name, e.name as embark_port_name,
             d.name as disembark_port_name, q.team_size, q.day_rate, q.fixed_fees, q.min_days,
             q.currency, q.valid_until, q.status, q.received_at
      from security_quotes q
        join security_providers p on p.id = q.provider_id
        join ports e on e.id = q.embark_port_id
        join ports d on d.id = q.disembark_port_id
      order by q.id`;
    const items = rows.map((r) => ({
      id: r.id,
      providerName: r.provider_name,
      embarkPortName: r.embark_port_name,
      disembarkPortName: r.disembark_port_name,
      teamSize: r.team_size,
      dayRate: r.day_rate,
      fixedFees: r.fixed_fees,
      minDays: r.min_days,
      currency: r.currency,
      validUntil: r.valid_until === null ? null : new Date(r.valid_until).toISOString(),
      status: r.status,
      receivedAt: new Date(r.received_at).toISOString(),
    }));
    return c.json({ items } satisfies SecurityQuoteList);
  });

  app.get("/congestion", async (c) => {
    const rows = await sql<
      {
        port_id: number;
        name: string;
        unlocode: string;
        anchored_count: number;
        waiting_hours: number;
        observed_at: string | Date;
        source: "seed" | "ais";
      }[]
    >`select distinct on (g.port_id) g.port_id, p.name, p.unlocode, g.anchored_count,
             g.waiting_hours, g.observed_at, g.source
      from port_congestion g join ports p on p.id = g.port_id
      order by g.port_id, g.observed_at desc, g.id desc`;
    const items: PortCongestionView[] = rows.map((r) => ({
      portId: r.port_id,
      portName: r.name,
      unlocode: r.unlocode,
      anchoredCount: r.anchored_count,
      waitingHours: r.waiting_hours,
      observedAt: iso(r.observed_at),
      source: r.source,
    }));
    return c.json({ items } satisfies PortCongestionList);
  });

  app.get("/weather", async (c) => {
    const snapshot = await latestWeatherSnapshot(sql);
    if (!snapshot) {
      return c.json({ error: "not_found", message: "There is no weather snapshot yet." }, 404);
    }
    const { grid } = snapshot;
    const steps = grid.points[0]?.waveHeightM.length ?? 0;
    const raw = c.req.query("step");
    const step = raw === undefined ? 0 : Number(raw);
    if (!Number.isInteger(step) || step < 0 || step >= steps) {
      return c.json(
        {
          error: "invalid_request",
          message: `step must be a whole number from 0 to ${steps - 1}.`,
        },
        400,
      );
    }
    const stepTimes = Array.from({ length: steps }, (_, k) =>
      forecastStepAt(grid, k).toISOString(),
    );
    const view: WeatherView = {
      snapshotId: snapshot.id,
      source: snapshot.source,
      forecastStart: snapshot.modelRun.toISOString(),
      fetchedAt: snapshot.fetchedAt.toISOString(),
      startAt: grid.startAt,
      stepHours: grid.stepHours,
      steps,
      step,
      validAt: stepTimes[step] as string,
      stepTimes,
      points: grid.points.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        waveHeightM: p.waveHeightM[step] ?? null,
        waveDirDeg: p.waveDirDeg[step] ?? null,
        windSpeedKn: p.windSpeedKn[step] ?? null,
        windDirDeg: p.windDirDeg[step] ?? null,
      })),
    };
    return c.json(view);
  });

  app.get("/sources", async (c) => {
    const rows = await sql<
      {
        source: "ais" | "weather";
        mode: "live" | "recorded";
        detail: string | null;
        updated_at: string | Date;
      }[]
    >`select source, mode, detail, updated_at from source_status order by source`;
    const items: SourceStatusView[] = rows.map((r) => ({
      source: r.source,
      mode: r.mode,
      detail: r.detail,
      updatedAt: iso(r.updated_at),
    }));
    return c.json({ items } satisfies SourceStatusList);
  });

  return app;
}
