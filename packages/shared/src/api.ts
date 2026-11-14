/** HTTP response shapes the ops console builds against. Times are ISO strings on the wire. */
import { z } from "zod";
import { ConsumptionCurve, FobProjection } from "./calculators.js";
import {
  CheckResult,
  PortCallPurpose,
  QuoteStatus,
  RecommendationStatus,
  RecommendationType,
  VoyageStatus,
} from "./entities.js";
import { ExtractionOutput } from "./extraction/index.js";
import { Fact, FactId } from "./facts.js";
import {
  Currency,
  EtsCoverageFactor,
  FuelGrade,
  GradeAmounts,
  Id,
  IsoDateTime,
  LatLon,
  ShipType,
} from "./primitives.js";

export const ApiError = z.object({ error: z.string().min(1) });
export type ApiError = z.infer<typeof ApiError>;

/** `{ items: T[] }` — the envelope for every list endpoint. */
export const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const VesselSummary = z.object({
  id: Id,
  name: z.string(),
  imo: z.string(),
  mmsi: z.string(),
  shipType: ShipType,
  position: LatLon.nullable(),
  positionAt: IsoDateTime.nullable(),
  voyageId: Id.nullable(),
  robMt: GradeAmounts,
  /** Machine-readable flags, e.g. "lsmgo_below_margin_for_eca". */
  alerts: z.array(z.string()),
});
export type VesselSummary = z.infer<typeof VesselSummary>;

export const VesselDetail = VesselSummary.extend({
  dwt: z.number().positive(),
  tankCapacityMt: GradeAmounts,
  consumptionCurve: ConsumptionCurve,
  fobProjection: FobProjection.nullable(),
});
export type VesselDetail = z.infer<typeof VesselDetail>;

export const VoyageSummary = z.object({
  id: Id,
  voyageNo: z.string(),
  vesselId: Id,
  vesselName: z.string(),
  status: VoyageStatus,
  originPortId: Id,
  destinationPortId: Id,
  plannedSpeedKn: z.number().positive(),
  nextEta: IsoDateTime.nullable(),
});
export type VoyageSummary = z.infer<typeof VoyageSummary>;

export const PortCallView = z.object({
  id: Id,
  portId: Id,
  portName: z.string(),
  sequence: z.number().int().nonnegative(),
  purpose: PortCallPurpose,
  eta: IsoDateTime,
  berthWindowStart: IsoDateTime.nullable(),
  berthWindowEnd: IsoDateTime.nullable(),
});
export type PortCallView = z.infer<typeof PortCallView>;

export const VoyageDetail = VoyageSummary.extend({
  portCalls: z.array(PortCallView),
  legs: z.array(
    z.object({
      fromPortId: Id,
      toPortId: Id,
      distanceNm: z.number().nonnegative(),
      requiredGrade: FuelGrade,
      etsCoverage: EtsCoverageFactor,
    }),
  ),
});
export type VoyageDetail = z.infer<typeof VoyageDetail>;

export const InboxExtractionStatus = z.enum([
  "pending",
  "extracted",
  "needs_review",
  "accepted",
  "not_a_quote",
  "failed",
]);
export const InboxItem = z.object({
  documentId: Id,
  sender: z.string().nullable(),
  subject: z.string().nullable(),
  receivedAt: IsoDateTime,
  kind: z.enum(["email", "pdf"]),
  extractionStatus: InboxExtractionStatus,
});
export type InboxItem = z.infer<typeof InboxItem>;

export const InboxItemDetail = InboxItem.extend({
  bodyText: z.string(),
  extraction: ExtractionOutput.nullable(),
  checkResults: z.array(CheckResult),
});
export type InboxItemDetail = z.infer<typeof InboxItemDetail>;

export const QuoteView = z.object({
  id: Id,
  supplierName: z.string(),
  portName: z.string(),
  currency: Currency,
  bargeFee: z.number().nonnegative(),
  validUntil: IsoDateTime.nullable(),
  status: QuoteStatus,
  lines: z.array(
    z.object({
      grade: FuelGrade,
      /** Null while the quote needs review and the written quantity is ambiguous. */
      qtyMt: z.number().positive().nullable(),
      pricePerMt: z.number().positive(),
    }),
  ),
  documentId: Id.nullable(),
});
export type QuoteView = z.infer<typeof QuoteView>;

export const RecommendationView = z.object({
  id: Id,
  type: RecommendationType,
  status: RecommendationStatus,
  calculationId: Id,
  optionId: z.string(),
  summary: z.string(),
  expectedSavingUsd: z.number().nullable(),
  factRefs: z.array(FactId),
  facts: z.array(Fact),
});
export type RecommendationView = z.infer<typeof RecommendationView>;
