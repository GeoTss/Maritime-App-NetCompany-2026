/**
 * The voyage timeline: what the recommended plan does along its way, in time order. Port calls
 * (bunkering, provisions, charts, waste ashore, dues), the fuel changeover at sulphur-ECA lines,
 * where holding-tank sewage may go overboard, danger areas and the armed team, storms passed and
 * the notices due. Computed by `voyageTimeline` in `packages/domain`; every number is a fact.
 */
import { z } from "zod";
import { Fact } from "./facts.js";
import { PreArrivalNoticeKind } from "./port-call.js";
import { FuelGrade, Id, IsoDateTime, LatLon } from "./primitives.js";

const NonNeg = z.number().nonnegative();

/** The switches on the timeline: each event kind belongs to one. */
export const TimelineGroup = z.enum(["port", "eca", "sewage", "security", "storms_notices"]);
export type TimelineGroup = z.infer<typeof TimelineGroup>;

/** What a port call does. Bunkering is always there; the rest only when the call does it. */
export const PortAction = z.enum([
  "bunkering",
  "provisions",
  "charts",
  "sludge",
  "sewage",
  "clearance",
  "port_dues",
]);
export type PortAction = z.infer<typeof PortAction>;

/** When and where: the time, the position on the track, and the distance along it (nm). */
const base = { at: IsoDateTime, position: LatLon, alongNm: NonNeg };

export const VoyageEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("departure"), ...base }).strict(),
  z
    .object({
      kind: z.literal("port_arrival"),
      ...base,
      stopIndex: z.number().int().nonnegative(),
      unlocode: z.string().min(1),
      actions: z.array(PortAction),
      /** The grade the call bunkers (the quote's): its amounts are the stop plan's facts. */
      bunkerGrade: FuelGrade,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provisions_restock"),
      ...base,
      stopIndex: z.number().int().nonnegative(),
      unlocode: z.string().min(1),
      /** The provisions job in the stop plan's port call: its quantity and cost are its facts. */
      jobIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("port_departure"),
      ...base,
      stopIndex: z.number().int().nonnegative(),
      unlocode: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("arrival"),
      ...base,
      provisionsDaysLeft: z.number().nullable(),
      /** Fewer provision days left than the company reserve: restock at the destination. */
      restockNeeded: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("eca_entry"),
      ...base,
      /** The voyage starts inside the ECA: no line to cross, LSMGO from the start. */
      atDeparture: z.boolean(),
      /** When the changeover to LSMGO starts, ahead of the line; null when `atDeparture`. */
      changeoverStartAt: IsoDateTime.nullable(),
      grade: z.literal("LSMGO"),
    })
    .strict(),
  z.object({ kind: z.literal("eca_exit"), ...base, grade: z.literal("VLSFO") }).strict(),
  z
    .object({
      kind: z.literal("sewage_window_open"),
      ...base,
      /** Hours the vessel spends in this window (more than 12 nm from land, 4 kn or more). */
      windowHours: NonNeg,
    })
    .strict(),
  z.object({ kind: z.literal("sewage_window_close"), ...base }).strict(),
  z
    .object({
      kind: z.literal("danger_area_entry"),
      ...base,
      areaId: z.string().min(1),
      hoursInside: NonNeg,
      /** An armed team from a valid quote is on board through the area. */
      guarded: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("danger_area_exit"), ...base, areaId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("guards_embark"), ...base, portId: Id }).strict(),
  z.object({ kind: z.literal("guards_disembark"), ...base, portId: Id }).strict(),
  z
    .object({
      kind: z.literal("storm_passed"),
      ...base,
      stormId: z.string().min(1),
      /** Distance from the storm's edge at the closest point (nm); below 0 the route goes through. */
      clearanceNm: z.number(),
      maxWaveHeightM: NonNeg,
      synthetic: z.boolean(),
      /** When the storm is over the limit there: from, and until (null: no end set). */
      activeFrom: IsoDateTime,
      activeUntil: IsoDateTime.nullable(),
      /** Whether the route passes while the storm is on, after it has blown out, or before it starts. */
      timing: z.enum(["during", "after", "before"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("notice_due"),
      ...base,
      stopIndex: z.number().int().nonnegative(),
      notice: PreArrivalNoticeKind,
      overdue: z.boolean(),
    })
    .strict(),
]);
export type VoyageEvent = z.infer<typeof VoyageEvent>;
export type VoyageEventKind = VoyageEvent["kind"];

export const TIMELINE_GROUP: Record<VoyageEventKind, TimelineGroup> = {
  departure: "port",
  port_arrival: "port",
  provisions_restock: "port",
  port_departure: "port",
  arrival: "port",
  eca_entry: "eca",
  eca_exit: "eca",
  sewage_window_open: "sewage",
  sewage_window_close: "sewage",
  danger_area_entry: "security",
  danger_area_exit: "security",
  guards_embark: "security",
  guards_disembark: "security",
  storm_passed: "storms_notices",
  notice_due: "storms_notices",
};

/** The order of kinds at the same instant (the table order above). */
export const TIMELINE_KIND_ORDER: readonly VoyageEventKind[] = Object.keys(
  TIMELINE_GROUP,
) as VoyageEventKind[];

export const VoyageTimeline = z
  .object({ events: z.array(VoyageEvent), facts: z.array(Fact) })
  .strict();
export type VoyageTimeline = z.infer<typeof VoyageTimeline>;
