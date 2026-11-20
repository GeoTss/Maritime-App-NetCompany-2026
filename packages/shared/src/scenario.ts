/**
 * Demo scenario controls (the console's Scenario panel): a presenter's direct edits to the demo
 * world, never the model's. Fleet vessels' stats, synthetic hazards and weather areas laid over
 * the forecast. Bounds here; the cross-field checks (fuel on board within the tanks, the speed
 * range, waste within its tank) are the service's, against the vessel as it stands.
 */
import { z } from "zod";
import { NavHazardView } from "./api.js";
import { Id, IsoDateTime, LatLon } from "./primitives.js";

const grades = (max: number) =>
  z
    .object({
      LSMGO: z.number().min(0).max(max),
      VLSFO: z.number().min(0).max(max),
      HSFO: z.number().min(0).max(max),
    })
    .strict();

/** A vessel's editable stats as they stand. */
export const ScenarioVesselValues = z
  .object({
    robMt: grades(10_000),
    tankCapacityMt: grades(10_000),
    consumption: z
      .object({
        refSpeedKn: z.number(),
        refMtPerDay: z.number(),
        auxMtPerDay: z.number(),
        minSpeedKn: z.number(),
        maxSpeedKn: z.number(),
      })
      .strict(),
    dailyCostUsd: z.number(),
    hullValueUsd: z.number().nullable(),
    stores: z
      .object({
        crew: z.number().int(),
        provisionsPersonDays: z.number(),
        sludgeM3: z.number(),
        sludgeCapacityM3: z.number(),
        sewageM3: z.number(),
        sewageCapacityM3: z.number(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ScenarioVesselValues = z.infer<typeof ScenarioVesselValues>;

/** Any subset of a vessel's stats, each within its bounds, the speeds given in order. */
export const ScenarioVesselPatch = z
  .object({
    robMt: grades(10_000).partial(),
    tankCapacityMt: grades(10_000).partial(),
    consumption: z
      .object({
        refSpeedKn: z.number().min(5).max(25),
        refMtPerDay: z.number().min(1).max(200),
        auxMtPerDay: z.number().min(0).max(20),
        minSpeedKn: z.number().min(3).max(20),
        maxSpeedKn: z.number().min(8).max(25),
      })
      .strict()
      .partial(),
    dailyCostUsd: z.number().min(0).max(200_000),
    hullValueUsd: z.number().min(0).max(500_000_000),
    stores: z
      .object({
        crew: z.number().int().min(1).max(60),
        provisionsPersonDays: z.number().min(0).max(10_000),
        sludgeM3: z.number().min(0),
        sewageM3: z.number().min(0),
      })
      .strict()
      .partial(),
  })
  .strict()
  .partial()
  .superRefine((p, ctx) => {
    // The speeds given together must run minimum ≤ reference ≤ maximum (the server checks the
    // whole curve against the vessel too).
    const c = p.consumption ?? {};
    const order: [keyof typeof c, keyof typeof c][] = [
      ["minSpeedKn", "refSpeedKn"],
      ["refSpeedKn", "maxSpeedKn"],
      ["minSpeedKn", "maxSpeedKn"],
    ];
    for (const [lo, hi] of order) {
      const a = c[lo];
      const b = c[hi];
      if (a !== undefined && b !== undefined && a > b) {
        ctx.addIssue({
          code: "custom",
          path: ["consumption", lo],
          message: "the speeds must run minimum ≤ reference ≤ maximum",
        });
        return;
      }
    }
  });
export type ScenarioVesselPatch = z.infer<typeof ScenarioVesselPatch>;

export const ScenarioHazardInput = z
  .object({
    label: z.string().trim().min(1).max(80),
    lat: LatLon.shape.lat,
    lon: LatLon.shape.lon,
    radiusNm: z.number().min(1).max(200),
  })
  .strict();
export type ScenarioHazardInput = z.infer<typeof ScenarioHazardInput>;

const direction = z.number().int().min(0).max(359);

/** Stationary weather laid over every forecast step inside a circle (the direction it comes from). */
const areaFields = {
  label: z.string().trim().min(1).max(80),
  center: LatLon,
  radiusNm: z.number().min(30).max(600),
  waveHeightM: z.number().min(0).max(15),
  waveDirDeg: direction,
  windSpeedKn: z.number().min(0).max(100),
  windDirDeg: direction,
};

/** Weather laid over a circle from `from` until `until` (UTC); it may run past the forecast. */
export const ScenarioWeatherAreaInput = z
  .object({ ...areaFields, from: IsoDateTime, until: IsoDateTime })
  .strict()
  .refine((a) => Date.parse(a.until) > Date.parse(a.from), {
    message: "the weather must end after it starts",
    path: ["until"],
  });
export type ScenarioWeatherAreaInput = z.infer<typeof ScenarioWeatherAreaInput>;

/** A stored area; an area made before windows existed has none (null: open on that side). */
export const ScenarioWeatherArea = z
  .object({
    ...areaFields,
    id: Id,
    from: IsoDateTime.nullable(),
    until: IsoDateTime.nullable(),
  })
  .strict();
export type ScenarioWeatherArea = z.infer<typeof ScenarioWeatherArea>;

export const ScenarioView = z
  .object({
    /** Edits are allowed: DEMO_CONTROLS=on, the clock pinned and the weather recorded. */
    enabled: z.boolean(),
    /** Why edits are off, in plain words; null when enabled. */
    reason: z.string().nullable(),
    /** Something was edited since the last reset. */
    edited: z.boolean(),
    /** When the last edit was made (the request clock), null when none. */
    editedAt: z.iso.datetime({ offset: true }).nullable(),
    vessels: z.array(z.object({ id: Id, name: z.string(), values: ScenarioVesselValues }).strict()),
    hazards: z.array(NavHazardView),
    weatherAreas: z.array(ScenarioWeatherArea),
  })
  .strict();
export type ScenarioView = z.infer<typeof ScenarioView>;
