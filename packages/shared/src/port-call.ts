/**
 * The port call around a bunker stop: what the vessel carries (provisions, waste, charts and
 * publications), what a port offers and charges, and what a stop plan's call does and costs.
 * Values are synthetic planning parameters unless a source is named.
 */
import { z } from "zod";
import { IsoDate, IsoDateTime, LatLon } from "./primitives.js";

const NonNeg = z.number().nonnegative();
const Positive = z.number().positive();

export const Box = z
  .object({
    minLat: z.number().min(-90).max(90),
    maxLat: z.number().min(-90).max(90),
    minLon: z.number().min(-180).max(180),
    maxLon: z.number().min(-180).max(180),
  })
  .strict();
export type Box = z.infer<typeof Box>;

/** One chart or publication on board, at the edition the vessel holds. */
export const OnBoardItem = z
  .object({ itemId: z.string().min(1), edition: z.string().min(1), editionDate: IsoDate })
  .strict();
export type OnBoardItem = z.infer<typeof OnBoardItem>;

/** Stores and waste on board (synthetic). Provisions are counted in person-days. */
export const VesselStores = z
  .object({
    crew: z.number().int().positive(),
    provisionsPersonDays: NonNeg,
    sludgeM3: NonNeg,
    sludgeCapacityM3: Positive,
    sewageM3: NonNeg,
    sewageCapacityM3: Positive,
    onBoard: z.array(OnBoardItem),
  })
  .strict();
export type VesselStores = z.infer<typeof VesselStores>;

/** What a port offers a calling vessel and what it charges (synthetic, USD and hours). */
export const PortCallTerms = z
  .object({
    /** Port dues, agency and pilotage for a bunker call. */
    portDuesUsd: NonNeg,
    /** Customs, immigration and survey on arrival. */
    clearanceHours: NonNeg,
    stores: z.boolean(),
    provisionsUsdPerPersonDay: NonNeg,
    storesHours: NonNeg,
    wasteReception: z.boolean(),
    sludgeUsdPerM3: NonNeg,
    sewageUsdPerM3: NonNeg,
    wasteHours: NonNeg,
    /** The waste fee every ship calling at an EU port pays (Directive (EU) 2019/883); 0 elsewhere. */
    euWasteFeeUsd: NonNeg,
  })
  .strict();
export type PortCallTerms = z.infer<typeof PortCallTerms>;

/** A chart or publication at its current edition, with the sea areas it covers. */
export const NauticalItem = z
  .object({
    itemId: z.string().min(1),
    kind: z.enum(["chart", "publication"]),
    title: z.string().min(1),
    edition: z.string().min(1),
    editionDate: IsoDate,
    priceUsd: NonNeg,
    coverage: z.array(Box),
    source: z.string().min(1),
  })
  .strict();
export type NauticalItem = z.infer<typeof NauticalItem>;

export const PortCallJobKind = z.enum(["provisions", "charts", "sludge", "sewage"]);
export type PortCallJobKind = z.infer<typeof PortCallJobKind>;

export const PortCallJob = z
  .object({
    kind: PortCallJobKind,
    /** The voyage needs it done before the destination. */
    needed: z.boolean(),
    /** This port does it. */
    done: z.boolean(),
    qty: NonNeg,
    unit: z.enum(["person-days", "items", "m3"]),
    costUsd: NonNeg,
    hours: NonNeg,
  })
  .strict();
export type PortCallJob = z.infer<typeof PortCallJob>;

export const CostLineKind = z.enum([
  "port_dues",
  "provisions",
  "charts",
  "sludge",
  "sewage",
  "eu_waste_fee",
]);
export type CostLineKind = z.infer<typeof CostLineKind>;

export const CostLine = z.object({ kind: CostLineKind, usd: NonNeg }).strict();
export type CostLine = z.infer<typeof CostLine>;

export const PreArrivalNoticeKind = z.enum([
  "agent_appointment",
  "security_pre_arrival",
  "eu_waste_notification",
]);
export type PreArrivalNoticeKind = z.infer<typeof PreArrivalNoticeKind>;

export const PreArrivalNotice = z
  .object({ kind: PreArrivalNoticeKind, dueAt: IsoDateTime, overdue: z.boolean() })
  .strict();
export type PreArrivalNotice = z.infer<typeof PreArrivalNotice>;

/** A chart or publication the route needs that is missing or out of date on board. */
export const OutdatedItem = z
  .object({
    itemId: z.string().min(1),
    kind: z.enum(["chart", "publication"]),
    title: z.string().min(1),
    onBoardEdition: z.string().nullable(),
    currentEdition: z.string().min(1),
    priceUsd: NonNeg,
    /** When the route first enters the item's area. */
    neededAt: IsoDateTime.nullable(),
    /** The stop comes before the area, or lies inside it. */
    inTime: z.boolean(),
  })
  .strict();
export type OutdatedItem = z.infer<typeof OutdatedItem>;

export const PortCallResult = z
  .object({
    jobs: z.array(PortCallJob),
    costLines: z.array(CostLine),
    /** Sum of `costLines`, inside the stop plan's total. */
    extraCostUsd: NonNeg,
    notices: z.array(PreArrivalNotice),
    outdated: z.array(OutdatedItem),
    /** Levels at the destination, after anything delivered or bought at the stop. */
    provisionsDaysAtEta: z.number(),
    sludgeM3AtEta: NonNeg,
    sewageM3AtEta: NonNeg,
  })
  .strict();
export type PortCallResult = z.infer<typeof PortCallResult>;

/** A forecast grid cell over the heavy-weather limit around the time a route passes it. */
export const StormCell = z
  .object({
    /** "storm:<lat>,<lon>". */
    id: z.string().min(1),
    center: LatLon,
    radiusNm: Positive,
    maxWaveHeightM: NonNeg,
    from: IsoDateTime,
    to: IsoDateTime,
  })
  .strict();
export type StormCell = z.infer<typeof StormCell>;
