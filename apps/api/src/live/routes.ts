/**
 * Live-data routes for the map and the route planner: POST /route-plan, GET /traffic, /congestion,
 * /weather, /hazards and /sources (mounted under /api). Read-only except that planning stores one
 * calculation.
 */
import type { Sql } from "@pharos/db";
import { activeHazardZones } from "@pharos/domain";
import { latestWeatherSnapshot } from "@pharos/integrations";
import {
  type AisTrafficView,
  NavHazardView,
  PlanRouteSpeedInput,
  type PortCongestionView,
  type SourceStatusView,
  type WeatherView,
} from "@pharos/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireContentType } from "../http/require-content-type.js";
import { planRouteSpeed, RoutePlanError } from "../routing/plan.js";

export const TRAFFIC_LIMIT = 2000;

export interface LiveDeps {
  sql: Sql;
  now: () => Date;
}

/** An active hazard with the radius of its keep-out zone. */
export const HazardZoneView = NavHazardView.extend({ zoneRadiusNm: z.number().positive() });
export type HazardZoneView = z.infer<typeof HazardZoneView>;

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
      const { response } = await planRouteSpeed(deps, parsed.data);
      return c.json(response);
    } catch (e) {
      if (e instanceof RoutePlanError) {
        return c.json({ error: "route_plan_failed", message: e.message }, 422);
      }
      throw e;
    }
  });

  app.get("/traffic", async (c) => {
    const rows = await sql<
      {
        mmsi: string;
        name: string | null;
        ship_type: string | null;
        lat: number;
        lon: number;
        sog_kn: number | null;
        nav_status: string | null;
        destination: string | null;
        updated_at: string | Date;
      }[]
    >`select mmsi, name, ship_type, lat, lon, sog_kn, nav_status, destination, updated_at
      from ais_traffic order by updated_at desc, mmsi limit ${TRAFFIC_LIMIT}`;
    const items: AisTrafficView[] = rows.map((r) => ({
      mmsi: r.mmsi,
      name: r.name,
      shipType: r.ship_type,
      lat: r.lat,
      lon: r.lon,
      sogKn: r.sog_kn,
      navStatus: r.nav_status,
      destination: r.destination,
      updatedAt: iso(r.updated_at),
    }));
    return c.json({ items });
  });

  app.get("/hazards", async (c) => {
    const rows = await sql<
      {
        id: string;
        kind: NavHazardView["kind"];
        source: NavHazardView["source"];
        mmsi: string | null;
        lat: number;
        lon: number;
        label: string;
        radius_nm: number | null;
        observed_at: string | Date;
      }[]
    >`select id, kind, source, mmsi, lat, lon, label, radius_nm, observed_at
      from nav_hazards order by id`;
    const hazards = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      mmsi: r.mmsi,
      lat: r.lat,
      lon: r.lon,
      label: r.label,
      radiusNm: r.radius_nm,
      observedAt: new Date(r.observed_at),
    }));
    const radius = new Map(activeHazardZones(hazards, deps.now()).map((z) => [z.id, z.radiusNm]));
    const items: HazardZoneView[] = hazards.flatMap((h) => {
      const zoneRadiusNm = radius.get(h.id);
      return zoneRadiusNm === undefined
        ? []
        : [{ ...h, observedAt: h.observedAt.toISOString(), zoneRadiusNm }];
    });
    return c.json({ items });
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
    return c.json({ items });
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
    const view: WeatherView = {
      snapshotId: snapshot.id,
      source: snapshot.source,
      modelRun: snapshot.modelRun.toISOString(),
      fetchedAt: snapshot.fetchedAt.toISOString(),
      startAt: grid.startAt,
      stepHours: grid.stepHours,
      steps,
      step,
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
    return c.json({ items });
  });

  return app;
}
