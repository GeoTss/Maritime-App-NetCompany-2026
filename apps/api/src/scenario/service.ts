/**
 * Demo scenario controls: a presenter's direct edits to the pinned demo world (fleet vessels'
 * stats, synthetic hazards, weather areas) and one reset back to the recorded demo. No agent tool
 * and no proposal reaches this: it is demo data, never an order or a voyage (rule 3). Edits work
 * only with DEMO_CONTROLS=on, the clock pinned and the weather recorded; a route plan reads the
 * edited world on its next request, and the maths stays in packages/domain.
 */
import { type Sql, seedDatabase } from "@pharos/db";
import {
  ensurePinnedSources,
  latestWeatherSnapshot,
  loadWeatherAreas,
  pointsInArea,
} from "@pharos/integrations";
import {
  ConsumptionCurve,
  FUEL_GRADES,
  type GradeAmounts,
  type Id,
  type NavHazardView,
  type ScenarioHazardInput,
  type ScenarioVesselPatch,
  type ScenarioVesselValues,
  type ScenarioView,
  type ScenarioWeatherAreaInput,
  type VesselStores,
} from "@pharos/shared";
import type { Clock } from "../clock.js";
import type { AppConfig } from "../config.js";

export interface ScenarioDeps {
  sql: Sql;
  clock: Clock;
  config: Pick<AppConfig, "demoControls" | "demoStorm" | "worldSeed">;
}

/** A refused edit: 403 when edits are off, 404 for an unknown vessel or hazard, 422 when invalid. */
export class ScenarioError extends Error {
  constructor(
    readonly status: 403 | 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

const json = (v: unknown) => JSON.stringify(v);

export async function scenarioGate(
  deps: ScenarioDeps,
): Promise<{ enabled: boolean; reason: string | null }> {
  if (!deps.config.demoControls) {
    return { enabled: false, reason: "Demo controls are off on this stack (DEMO_CONTROLS)." };
  }
  if (!deps.clock.pinned) {
    return { enabled: false, reason: "The clock is not pinned to the demo, so the world is live." };
  }
  const [row] = await deps.sql<{ mode: string }[]>`
    select mode from source_status where source = 'weather'`;
  if (row?.mode !== "recorded") {
    return { enabled: false, reason: "The weather is live, so there is no recorded demo to edit." };
  }
  return { enabled: true, reason: null };
}

async function requireEnabled(deps: ScenarioDeps): Promise<void> {
  const gate = await scenarioGate(deps);
  if (!gate.enabled) throw new ScenarioError(403, gate.reason ?? "Demo controls are off.");
}

async function markEdited(deps: ScenarioDeps): Promise<void> {
  await deps.sql`update world_meta set scenario_edited_at = ${deps.clock.now().toISOString()}::timestamptz where id = 1`;
}

interface VesselRow {
  id: number;
  name: string;
  tank_capacity_mt: GradeAmounts;
  consumption_curve: ConsumptionCurve;
  daily_cost_usd: number;
  hull_value_usd: number | null;
  stores: VesselStores | null;
  rob_mt: GradeAmounts | null;
  report_id: number | null;
}

async function vesselRows(sql: Sql, id?: Id): Promise<VesselRow[]> {
  // The latest noon report by time is the one a route plan reads the fuel on board from.
  return sql<VesselRow[]>`
    select v.id, v.name, v.tank_capacity_mt, v.consumption_curve, v.daily_cost_usd,
           v.hull_value_usd, v.stores, r.rob_mt, r.id as report_id
    from vessels v
    left join lateral (
      select id, rob_mt from noon_reports where vessel_id = v.id order by ts desc, id desc limit 1
    ) r on true
    ${id === undefined ? sql`` : sql`where v.id = ${id}`}
    order by v.id`;
}

const valuesOf = (r: VesselRow): ScenarioVesselValues => ({
  robMt: r.rob_mt ?? { LSMGO: 0, VLSFO: 0, HSFO: 0 },
  tankCapacityMt: r.tank_capacity_mt,
  consumption: {
    refSpeedKn: r.consumption_curve.refSpeedKn,
    refMtPerDay: r.consumption_curve.refMtPerDay,
    auxMtPerDay: r.consumption_curve.auxMtPerDay,
    minSpeedKn: r.consumption_curve.minSpeedKn,
    maxSpeedKn: r.consumption_curve.maxSpeedKn,
  },
  dailyCostUsd: r.daily_cost_usd,
  hullValueUsd: r.hull_value_usd,
  stores: r.stores
    ? {
        crew: r.stores.crew,
        provisionsPersonDays: r.stores.provisionsPersonDays,
        sludgeM3: r.stores.sludgeM3,
        sludgeCapacityM3: r.stores.sludgeCapacityM3,
        sewageM3: r.stores.sewageM3,
        sewageCapacityM3: r.stores.sewageCapacityM3,
      }
    : null,
});

async function hazardViews(sql: Sql): Promise<NavHazardView[]> {
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
      observed_at: Date;
    }[]
  >`select id, kind, source, mmsi, lat, lon, label, radius_nm, observed_at from nav_hazards
    order by (source = 'synthetic') desc, observed_at desc, id`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    source: r.source,
    mmsi: r.mmsi,
    lat: r.lat,
    lon: r.lon,
    label: r.label,
    radiusNm: r.radius_nm,
    observedAt: new Date(r.observed_at).toISOString(),
  }));
}

export async function readScenario(deps: ScenarioDeps): Promise<ScenarioView> {
  const { sql } = deps;
  const gate = await scenarioGate(deps);
  const [meta] = await sql<{ scenario_edited_at: Date | null }[]>`
    select scenario_edited_at from world_meta where id = 1`;
  const editedAt = meta?.scenario_edited_at
    ? new Date(meta.scenario_edited_at).toISOString()
    : null;
  return {
    ...gate,
    edited: editedAt !== null,
    editedAt,
    vessels: (await vesselRows(sql)).map((r) => ({ id: r.id, name: r.name, values: valuesOf(r) })),
    hazards: await hazardViews(sql),
    weatherAreas: await loadWeatherAreas(sql),
  };
}

/** The patch laid over the vessel as it stands, checked as a whole (the cross-field rules). */
function merged(r: VesselRow, patch: ScenarioVesselPatch) {
  const tank = { ...r.tank_capacity_mt, ...patch.tankCapacityMt };
  const rob = { ...(r.rob_mt ?? { LSMGO: 0, VLSFO: 0, HSFO: 0 }), ...patch.robMt };
  for (const g of FUEL_GRADES) {
    if (rob[g] > tank[g]) {
      throw new ScenarioError(
        422,
        `robMt.${g}: ${rob[g]} mt on board is more than the ${g} tanks hold (${tank[g]} mt).`,
      );
    }
  }
  const curve = { ...r.consumption_curve, ...patch.consumption };
  if (!(curve.minSpeedKn <= curve.refSpeedKn && curve.refSpeedKn <= curve.maxSpeedKn)) {
    throw new ScenarioError(422, "consumption: the speeds must run minimum ≤ reference ≤ maximum.");
  }
  const parsedCurve = ConsumptionCurve.safeParse(curve);
  if (!parsedCurve.success) throw new ScenarioError(422, "consumption: not a valid curve.");
  if (patch.stores && !r.stores) {
    throw new ScenarioError(422, "stores: this vessel has no stores record to edit.");
  }
  const stores = r.stores ? { ...r.stores, ...patch.stores } : null;
  if (stores && stores.sludgeM3 > stores.sludgeCapacityM3) {
    throw new ScenarioError(
      422,
      `stores.sludgeM3: more than the sludge tank holds (${stores.sludgeCapacityM3} m³).`,
    );
  }
  if (stores && stores.sewageM3 > stores.sewageCapacityM3) {
    throw new ScenarioError(
      422,
      `stores.sewageM3: more than the holding tank holds (${stores.sewageCapacityM3} m³).`,
    );
  }
  return { tank, rob, curve: parsedCurve.data, stores };
}

export async function patchVessel(
  deps: ScenarioDeps,
  id: Id,
  patch: ScenarioVesselPatch,
): Promise<ScenarioView> {
  await requireEnabled(deps);
  const [row] = await vesselRows(deps.sql, id);
  if (!row)
    throw new ScenarioError(
      404,
      `There is no fleet vessel ${id}; ships seen only on AIS cannot be edited.`,
    );
  const m = merged(row, patch);
  await deps.sql.begin(async (tx) => {
    await tx`
      update vessels set
        tank_capacity_mt = ${json(m.tank)}::text::jsonb,
        consumption_curve = ${json(m.curve)}::text::jsonb,
        daily_cost_usd = ${patch.dailyCostUsd ?? row.daily_cost_usd},
        hull_value_usd = ${patch.hullValueUsd ?? row.hull_value_usd},
        stores = ${m.stores ? json(m.stores) : null}::text::jsonb
      where id = ${id}`;
    if (row.report_id !== null && patch.robMt) {
      await tx`update noon_reports set rob_mt = ${json(m.rob)}::text::jsonb where id = ${row.report_id}`;
    }
  });
  await markEdited(deps);
  return readScenario(deps);
}

export async function addHazard(
  deps: ScenarioDeps,
  input: ScenarioHazardInput,
): Promise<ScenarioView> {
  await requireEnabled(deps);
  const ids = await deps.sql<
    { id: string }[]
  >`select id from nav_hazards where id like 'synthetic:%'`;
  const next = Math.max(0, ...ids.map((r) => Number(r.id.split(":")[1]) || 0)) + 1;
  await deps.sql`
    insert into nav_hazards (id, kind, source, mmsi, lat, lon, label, radius_nm, observed_at)
    values (${`synthetic:${next}`}, 'synthetic', 'synthetic', null, ${input.lat}, ${input.lon},
            ${input.label}, ${input.radiusNm}, ${deps.clock.now().toISOString()}::timestamptz)`;
  await markEdited(deps);
  return readScenario(deps);
}

export async function removeHazard(deps: ScenarioDeps, id: string): Promise<ScenarioView> {
  await requireEnabled(deps);
  const gone =
    await deps.sql`delete from nav_hazards where id = ${id} and source = 'synthetic' returning id`;
  if (gone.length === 0)
    throw new ScenarioError(404, `There is no synthetic hazard ${id} to remove.`);
  await markEdited(deps);
  return readScenario(deps);
}

export async function addWeatherArea(
  deps: ScenarioDeps,
  input: ScenarioWeatherAreaInput,
): Promise<ScenarioView> {
  await requireEnabled(deps);
  const snapshot = await latestWeatherSnapshot(deps.sql);
  if (!snapshot) throw new ScenarioError(422, "There is no weather forecast to lay the area over.");
  if (pointsInArea(snapshot.grid, { ...input, id: 0 }) === 0) {
    throw new ScenarioError(422, "No forecast point lies inside this area; make it larger.");
  }
  await deps.sql`
    insert into scenario_weather_areas
      (label, lat, lon, radius_nm, wave_height_m, wave_dir_deg, wind_speed_kn, wind_dir_deg, created_at)
    values (${input.label}, ${input.center.lat}, ${input.center.lon}, ${input.radiusNm},
            ${input.waveHeightM}, ${input.waveDirDeg}, ${input.windSpeedKn}, ${input.windDirDeg},
            ${deps.clock.now().toISOString()}::timestamptz)`;
  await markEdited(deps);
  return readScenario(deps);
}

export async function removeWeatherArea(deps: ScenarioDeps, id: Id): Promise<ScenarioView> {
  await requireEnabled(deps);
  const gone = await deps.sql`delete from scenario_weather_areas where id = ${id} returning id`;
  if (gone.length === 0) throw new ScenarioError(404, `There is no weather area ${id}.`);
  await markEdited(deps);
  return readScenario(deps);
}

/**
 * Back to the recorded demo: the world reseeded exactly as SEED_ON_BOOT=reset does (every table,
 * so ids restart and the scripted stories replay again), then the recorded weather, AIS and
 * synthetic hazards loaded as the worker does on a pinned stack.
 */
export async function resetScenario(deps: ScenarioDeps): Promise<ScenarioView> {
  await requireEnabled(deps);
  const anchor = deps.clock.anchor();
  if (!anchor) throw new ScenarioError(403, "The clock is not pinned to the demo.");
  await seedDatabase(deps.sql, { seed: deps.config.worldSeed, anchor, mode: "reset" });
  await ensurePinnedSources(deps.sql, {
    anchor,
    now: deps.clock.now(),
    syntheticStorm: deps.config.demoStorm,
  });
  return readScenario(deps);
}
