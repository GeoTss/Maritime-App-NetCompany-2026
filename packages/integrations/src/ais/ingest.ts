import type { Sql } from "@pharos/db";
import {
  ANCHORAGE_RADIUS_NM,
  MAX_WAITING_HOURS,
  portCongestion,
  WAIT_HOURS_PER_ANCHORED_VESSEL,
} from "@pharos/domain";
import type { AisObservation, AisTraffic, Id, NavHazard, Port } from "@pharos/shared";
import { foldObservation, type HeldStatic, newFoldState } from "./fold.js";
import { foldHazard, type HazardMap } from "./hazards.js";
import { normaliseAisMessage } from "./normalise.js";

const CHUNK = 1000;
/** Traffic older than this does not count towards a port's congestion. */
export const CONGESTION_WINDOW_MS = 30 * 60_000;

export interface PortCongestionReading {
  portId: Id;
  anchoredCount: number;
  waitingHours: number;
  observedAt: Date;
}

/** Congestion per port from traffic rows, through the domain; only ports with a vessel in range. */
export function congestionFor(
  ports: Port[],
  traffic: Pick<AisTraffic, "lat" | "lon" | "sogKn" | "navStatus">[],
  observedAt: Date,
): PortCongestionReading[] {
  const out: PortCongestionReading[] = [];
  for (const port of ports) {
    const r = portCongestion({
      port: { lat: port.lat, lon: port.lon },
      radiusNm: ANCHORAGE_RADIUS_NM,
      hoursPerAnchoredVessel: WAIT_HOURS_PER_ANCHORED_VESSEL,
      maxWaitingHours: MAX_WAITING_HOURS,
      vessels: traffic.map((t) => ({
        lat: t.lat,
        lon: t.lon,
        sogKn: t.sogKn,
        navStatus: t.navStatus,
      })),
    });
    if (r.inRangeCount >= 1) {
      out.push({
        portId: port.id,
        anchoredCount: r.anchoredCount,
        waitingHours: r.waitingHours,
        observedAt,
      });
    }
  }
  return out;
}

/** Insert hazard rows; a hazard with the same id is replaced by the newer observation. */
export async function upsertHazards(sql: Sql, hazards: NavHazard[]): Promise<void> {
  for (let i = 0; i < hazards.length; i += CHUNK) {
    const rows = hazards.slice(i, i + CHUNK).map((h) => ({
      id: h.id,
      kind: h.kind,
      source: h.source,
      mmsi: h.mmsi,
      lat: h.lat,
      lon: h.lon,
      label: h.label,
      radius_nm: h.radiusNm,
      observed_at: h.observedAt.toISOString(),
    }));
    await sql`insert into nav_hazards ${sql(rows as never[])}
      on conflict (id) do update set
        kind = excluded.kind, source = excluded.source, mmsi = excluded.mmsi,
        lat = excluded.lat, lon = excluded.lon, label = excluded.label,
        radius_nm = excluded.radius_nm, observed_at = excluded.observed_at`;
  }
}

export interface AisIngester {
  ingest(raw: unknown): Promise<void>;
  /** Same as `ingest` for many messages, each stamped with its own receipt time, in bulk writes. */
  ingestBatch(items: { raw: unknown; at: Date }[]): Promise<void>;
  stats(): { accepted: number; dropped: number };
}

export function createAisIngester(
  sql: Sql,
  opts: { now: () => Date; throttleMs?: number; fleetIntervalMs?: number },
): AisIngester {
  const throttleMs = opts.throttleMs ?? 30_000;
  const fleetIntervalMs = opts.fleetIntervalMs ?? 600_000;
  const lastTraffic = new Map<string, number>();
  const lastFleet = new Map<string, number>();
  const pendingStatic = new Map<string, HeldStatic>();
  let accepted = 0;
  let dropped = 0;
  let fleet: Promise<Map<string, { id: number; source: string }>> | null = null;

  const loadFleet = () => {
    fleet ??= sql<{ id: number; mmsi: string; tracking_source: string }[]>`
      select id, mmsi, tracking_source from vessels`.then(
      (rows) => new Map(rows.map((r) => [r.mmsi, { id: r.id, source: r.tracking_source }])),
    );
    return fleet;
  };

  async function ingestBatch(items: { raw: unknown; at: Date }[]): Promise<void> {
    const state = newFoldState(pendingStatic);
    const fleetRows: Record<string, unknown>[] = [];
    const staticTouched = new Set<string>();
    const fleetMap = await loadFleet();

    const normalised: { obs: AisObservation; at: Date }[] = [];
    for (const { raw, at } of items) {
      const obs = normaliseAisMessage(raw, at);
      if (!obs) {
        dropped++;
        continue;
      }
      accepted++;
      normalised.push({ obs, at });
    }

    // Senders of safety messages: their last known position from before this batch.
    const known = new Map<string, { lat: number; lon: number }>();
    const senders = [
      ...new Set(normalised.flatMap(({ obs }) => (obs.kind === "safety" ? [obs.mmsi] : []))),
    ];
    if (senders.length > 0) {
      const found = await sql<{ mmsi: string; lat: number; lon: number }[]>`
        select mmsi, lat, lon from ais_traffic where mmsi in ${sql(senders)}`;
      for (const r of found) known.set(r.mmsi, { lat: r.lat, lon: r.lon });
    }
    const hazards: HazardMap = new Map();
    const positionOf = (mmsi: string) => state.rows.get(mmsi) ?? known.get(mmsi);

    for (const { obs, at } of normalised) {
      if (obs.kind !== "position" && obs.kind !== "static") {
        foldHazard(hazards, obs, at, positionOf);
        continue;
      }
      const atMs = at.getTime();
      if (obs.kind === "static") {
        foldObservation(state, obs, at);
        staticTouched.add(obs.mmsi);
        continue;
      }
      const last = lastTraffic.get(obs.mmsi);
      if (last === undefined || atMs - last >= throttleMs) {
        lastTraffic.set(obs.mmsi, atMs);
        foldObservation(state, obs, at);
      }
      const vessel = fleetMap.get(obs.mmsi);
      if (vessel) {
        const lf = lastFleet.get(obs.mmsi);
        if (lf === undefined || atMs - lf >= fleetIntervalMs) {
          lastFleet.set(obs.mmsi, atMs);
          fleetRows.push({
            vessel_id: vessel.id,
            ts: at.toISOString(),
            lat: obs.lat,
            lon: obs.lon,
            sog_kn: obs.sogKn ?? 0,
            cog: obs.cogDeg ?? 0,
            nav_status: obs.navStatus ?? "not defined",
            source: vessel.source,
          });
        }
      }
    }

    const rows = [...state.rows.values()].map((t) => ({
      mmsi: t.mmsi,
      name: t.name,
      ship_type: t.shipType,
      lat: t.lat,
      lon: t.lon,
      sog_kn: t.sogKn,
      nav_status: t.navStatus,
      destination: t.destination,
      draught_m: t.draughtM,
      cog_deg: t.cogDeg,
      updated_at: t.updatedAt.toISOString(),
    }));

    for (let i = 0; i < rows.length; i += CHUNK) {
      await sql`insert into ais_traffic ${sql(rows.slice(i, i + CHUNK) as never[])}
        on conflict (mmsi) do update set
          name = coalesce(excluded.name, ais_traffic.name),
          ship_type = coalesce(excluded.ship_type, ais_traffic.ship_type),
          lat = excluded.lat, lon = excluded.lon, sog_kn = excluded.sog_kn,
          nav_status = excluded.nav_status,
          cog_deg = excluded.cog_deg,
          draught_m = coalesce(excluded.draught_m, ais_traffic.draught_m),
          destination = coalesce(excluded.destination, ais_traffic.destination),
          updated_at = excluded.updated_at`;
    }

    // Remaining static data goes to rows that already exist; the rest stays held in memory.
    const mmsis = [...staticTouched].filter((m) => pendingStatic.has(m));
    if (mmsis.length > 0) {
      const infos = mmsis.map((m) => pendingStatic.get(m) as HeldStatic);
      const updated = await sql<{ mmsi: string }[]>`
        update ais_traffic t set
          name = coalesce(v.name, t.name),
          ship_type = coalesce(v.ship_type, t.ship_type),
          destination = coalesce(v.destination, t.destination),
          draught_m = coalesce(v.draught_m, t.draught_m)
        from unnest(${mmsis}::text[], ${infos.map((i) => i.name)}::text[],
          ${infos.map((i) => i.shipType)}::text[],
          ${infos.map((i) => i.destination)}::text[],
          ${infos.map((i) => i.draughtM)}::double precision[]
        ) as v(mmsi, name, ship_type, destination, draught_m)
        where t.mmsi = v.mmsi
        returning t.mmsi`;
      for (const r of updated) pendingStatic.delete(r.mmsi);
    }

    await upsertHazards(sql, [...hazards.values()]);

    for (let i = 0; i < fleetRows.length; i += CHUNK) {
      await sql`insert into vessel_positions ${sql(fleetRows.slice(i, i + CHUNK) as never[])}`;
    }
  }

  return {
    ingest: (raw) => ingestBatch([{ raw, at: opts.now() }]),
    ingestBatch,
    stats: () => ({ accepted, dropped }),
  };
}

/** Insert one `ais` congestion row per port with traffic from the last 30 minutes in range. */
export async function refreshCongestion(sql: Sql, now: Date): Promise<number> {
  const since = new Date(now.getTime() - CONGESTION_WINDOW_MS);
  const ports = await sql<Port[]>`
    select id, unlocode, name, country, lat, lon, is_eu as "isEu", in_eca as "inEca",
           approach_nm as "approachNm" from ports order by id`;
  const traffic = await sql<Pick<AisTraffic, "lat" | "lon" | "sogKn" | "navStatus">[]>`
    select lat, lon, sog_kn as "sogKn", nav_status as "navStatus" from ais_traffic
    where updated_at >= ${since.toISOString()}::timestamptz and updated_at <= ${now.toISOString()}::timestamptz`;
  const readings = congestionFor(ports, traffic, now);
  if (readings.length === 0) return 0;
  await sql`insert into port_congestion ${sql(
    readings.map((r) => ({
      port_id: r.portId,
      observed_at: r.observedAt.toISOString(),
      anchored_count: r.anchoredCount,
      waiting_hours: r.waitingHours,
      source: "ais",
    })) as never[],
  )}`;
  return readings.length;
}
