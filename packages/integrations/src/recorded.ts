import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "@pharos/db";
import { shiftWeatherGrid } from "@pharos/domain";
import {
  type AisTraffic,
  type Id,
  LatLon,
  type NavHazard,
  type Port,
  WeatherGrid,
} from "@pharos/shared";
import { z } from "zod";
import { foldObservation, newFoldState } from "./ais/fold.js";
import { foldHazard, type HazardMap } from "./ais/hazards.js";
import {
  CONGESTION_WINDOW_MS,
  congestionFor,
  createAisIngester,
  refreshCongestion,
  upsertHazards,
} from "./ais/ingest.js";
import { normaliseAisMessage } from "./ais/normalise.js";
import { parseCapture } from "./ais/replay.js";
import { upsertSourceStatus } from "./source-status.js";
import { insertWeatherSnapshot } from "./weather/store.js";

export const RECORDED_DIR = fileURLToPath(new URL("../../../fixtures/recorded", import.meta.url));
const CAPTURE_FILE = "ais-capture.jsonl";
const SNAPSHOT_FILE = "weather-snapshot.json";
const SYNTHETIC_FILE = "synthetic-hazards.json";

const SyntheticHazards = z.array(
  z
    .object({
      id: z.string().regex(/^synthetic:\d+$/),
      label: z.string().min(1),
      lat: LatLon.shape.lat,
      lon: LatLon.shape.lon,
      radiusNm: z.number().positive(),
    })
    .strict(),
);

const floorToHour = (d: Date): Date => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);

function readFixture(path: string, hint: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`recorded fixture not found at ${path}; run npm run ${hint}`);
    }
    throw err;
  }
}

/** Capture lines with their times rebased so the last message is at `anchor`. */
function rebasedCapture(dir: string, anchor: Date): { raw: unknown; at: Date }[] {
  const lines = parseCapture(readFixture(join(dir, CAPTURE_FILE), "record:ais"));
  const last = lines.reduce((m, l) => Math.max(m, l.offsetMs), 0);
  return lines.map((l) => ({
    raw: l.message,
    at: new Date(anchor.getTime() - (last - l.offsetMs)),
  }));
}

/** The labelled synthetic demo hazards, observed at `anchor`; none when the file is absent. */
export function syntheticHazards(dir: string, anchor: Date): NavHazard[] {
  let text: string;
  try {
    text = readFileSync(join(dir, SYNTHETIC_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return SyntheticHazards.parse(JSON.parse(text) as unknown).map((h) => ({
    id: h.id,
    kind: "synthetic" as const,
    source: "synthetic" as const,
    mmsi: null,
    lat: h.lat,
    lon: h.lon,
    label: h.label,
    radiusNm: h.radiusNm,
    observedAt: anchor,
  }));
}

function recordedWeather(dir: string, anchor: Date): WeatherGrid {
  const grid = WeatherGrid.parse(
    JSON.parse(readFixture(join(dir, SNAPSHOT_FILE), "record:weather")) as unknown,
  );
  return shiftWeatherGrid(grid, floorToHour(anchor));
}

/** The recorded weather and AIS traffic as they would look at `anchor`, computed without a database. */
export function recordedLiveData(opts: { anchor: Date; ports: Port[]; dir?: string }): {
  weather: WeatherGrid;
  traffic: AisTraffic[];
  hazards: NavHazard[];
  congestion: PortCongestionRow[];
} {
  const dir = opts.dir ?? RECORDED_DIR;
  const state = newFoldState();
  const hazardMap: HazardMap = new Map();
  for (const { raw, at } of rebasedCapture(dir, opts.anchor)) {
    const obs = normaliseAisMessage(raw, at);
    if (!obs) continue;
    if (obs.kind === "position" || obs.kind === "static") foldObservation(state, obs, at);
    else foldHazard(hazardMap, obs, at, (mmsi) => state.rows.get(mmsi));
  }
  const hazards = [...hazardMap.values(), ...syntheticHazards(dir, opts.anchor)].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const traffic = [...state.rows.values()].sort((a, b) => a.mmsi.localeCompare(b.mmsi));
  const recent = traffic.filter(
    (t) => t.updatedAt.getTime() >= opts.anchor.getTime() - CONGESTION_WINDOW_MS,
  );
  return {
    weather: recordedWeather(dir, opts.anchor),
    traffic,
    hazards,
    congestion: congestionFor(opts.ports, recent, opts.anchor),
  };
}

export interface PortCongestionRow {
  portId: Id;
  anchoredCount: number;
  waitingHours: number;
  observedAt: Date;
}

/** Write the recorded weather and AIS capture into the database as if observed at `anchor`. */
export async function loadRecordedSources(
  sql: Sql,
  opts: { anchor: Date; dir?: string },
): Promise<{ snapshotId: Id; vessels: number; congestionRows: number }> {
  const dir = opts.dir ?? RECORDED_DIR;
  const items = rebasedCapture(dir, opts.anchor);
  const grid = recordedWeather(dir, opts.anchor);

  const snapshotId = await insertWeatherSnapshot(sql, {
    grid,
    source: "open-meteo-recorded",
    fetchedAt: opts.anchor,
  });
  const ingester = createAisIngester(sql, {
    now: () => opts.anchor,
    throttleMs: 0,
    fleetIntervalMs: 0,
  });
  await ingester.ingestBatch(items);
  await upsertHazards(sql, syntheticHazards(dir, opts.anchor));
  const congestionRows = await refreshCongestion(sql, opts.anchor);

  const counted = await sql<{ n: number }[]>`select count(*)::int as n from ais_traffic`;
  const n = counted[0]?.n ?? 0;
  for (const source of ["ais", "weather"] as const) {
    await upsertSourceStatus(sql, {
      source,
      mode: "recorded",
      detail: `recorded fixtures loaded at ${opts.anchor.toISOString()}`,
      at: opts.anchor,
    });
  }
  return { snapshotId, vessels: n, congestionRows };
}
