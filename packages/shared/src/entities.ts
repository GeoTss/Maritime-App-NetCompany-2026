/**
 * Domain entities — one schema per table in the §5 data model, camelCase, timestamps as Date.
 * `packages/db/src/schema.ts` mirrors these column for column (checked by a test).
 */
import { z } from "zod";
import { ConsumptionCurve } from "./calculators.js";
import { FactId } from "./facts.js";
import { Currency, FuelGrade, GradeAmounts, Id, LatLon, ShipType } from "./primitives.js";

const NonNeg = z.number().nonnegative();
const Ts = z.date();
const Json = z.unknown();

export const EtsCoverageFactor = z.union([z.literal(0), z.literal(0.5), z.literal(1)]);
export type EtsCoverageFactor = z.infer<typeof EtsCoverageFactor>;

export const Port = z.object({
  id: Id,
  unlocode: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  name: z.string().min(1),
  country: z.string().length(2),
  lat: LatLon.shape.lat,
  lon: LatLon.shape.lon,
  isEu: z.boolean(),
  /** Inside a 0.1 % sulphur emission control area. */
  inEca: z.boolean(),
  /** Extra distance (nm) to come off the passage line to this port's bunkering anchorage and back. */
  approachNm: NonNeg,
});
export type Port = z.infer<typeof Port>;

export const RouteLeg = z.object({
  id: Id,
  fromPortId: Id,
  toPortId: Id,
  distanceNm: NonNeg,
  requiredGrade: FuelGrade,
  /** Factor that applies when the leg is sailed between two ports of call. */
  etsCoverage: EtsCoverageFactor,
  waypoints: z.array(LatLon).min(2),
});
export type RouteLeg = z.infer<typeof RouteLeg>;

export const Supplier = z.object({
  id: Id,
  name: z.string().min(1),
  emailDomain: z.string().min(1),
  erpCode: z.string().min(1),
  portIds: z.array(Id),
});
export type Supplier = z.infer<typeof Supplier>;

export const TrackingSource = z.enum(["simulator", "ais"]);
export type TrackingSource = z.infer<typeof TrackingSource>;

export const Vessel = z.object({
  id: Id,
  imo: z.string().regex(/^\d{7}$/),
  mmsi: z.string().regex(/^\d{9}$/),
  name: z.string().min(1),
  shipType: ShipType,
  dwt: z.number().positive(),
  trackingSource: TrackingSource,
  tankCapacityMt: GradeAmounts,
  consumptionCurve: ConsumptionCurve,
  /** Time-charter-equivalent cost of a day, used to price delay. */
  dailyCostUsd: NonNeg,
});
export type Vessel = z.infer<typeof Vessel>;

export const VesselPosition = z.object({
  id: Id,
  vesselId: Id,
  ts: Ts,
  lat: LatLon.shape.lat,
  lon: LatLon.shape.lon,
  sogKn: NonNeg,
  cog: z.number().min(0).max(360),
  navStatus: z.string().min(1),
  source: TrackingSource,
});
export type VesselPosition = z.infer<typeof VesselPosition>;

/** Latest state of public AIS traffic (not managed vessels). */
export const AisTraffic = z.object({
  mmsi: z.string().min(1),
  name: z.string().nullable(),
  shipType: z.string().nullable(),
  lat: LatLon.shape.lat,
  lon: LatLon.shape.lon,
  sogKn: NonNeg.nullable(),
  navStatus: z.string().nullable(),
  destination: z.string().nullable(),
  updatedAt: Ts,
});
export type AisTraffic = z.infer<typeof AisTraffic>;

export const VoyageStatus = z.enum(["planned", "underway", "completed"]);
export const Voyage = z.object({
  id: Id,
  vesselId: Id,
  voyageNo: z.string().min(1),
  originPortId: Id,
  destinationPortId: Id,
  plannedSpeedKn: z.number().positive(),
  /** Port ids in passage order, origin first, destination last. */
  plannedRoute: z.array(Id).min(2),
  status: VoyageStatus,
  departedAt: Ts.nullable(),
});
export type Voyage = z.infer<typeof Voyage>;

export const PortCallPurpose = z.enum(["load", "discharge", "bunker", "passage"]);
export const PortCall = z.object({
  id: Id,
  voyageId: Id,
  portId: Id,
  sequence: z.number().int().nonnegative(),
  purpose: PortCallPurpose,
  eta: Ts,
  berthWindowStart: Ts.nullable(),
  berthWindowEnd: Ts.nullable(),
});
export type PortCall = z.infer<typeof PortCall>;

export const NoonReport = z.object({
  id: Id,
  vesselId: Id,
  voyageId: Id.nullable(),
  ts: Ts,
  lat: LatLon.shape.lat,
  lon: LatLon.shape.lon,
  speedKn: NonNeg,
  distanceSinceLastNm: NonNeg,
  robMt: GradeAmounts,
  consumedMt: GradeAmounts,
});
export type NoonReport = z.infer<typeof NoonReport>;

export const PortFuelPrice = z.object({
  id: Id,
  portId: Id,
  grade: FuelGrade,
  priceUsdPerMt: z.number().positive(),
  asOf: Ts,
  source: z.string().min(1),
});
export type PortFuelPrice = z.infer<typeof PortFuelPrice>;

export const PortCongestion = z.object({
  id: Id,
  portId: Id,
  observedAt: Ts,
  anchoredCount: z.number().int().nonnegative(),
  waitingHours: NonNeg,
  source: z.enum(["seed", "ais"]),
});
export type PortCongestion = z.infer<typeof PortCongestion>;

export const BunkerRequirement = z.object({
  id: Id,
  voyageId: Id,
  grade: FuelGrade,
  qtyMt: z.number().positive(),
  status: z.enum(["open", "ordered", "cancelled"]),
  createdAt: Ts,
});
export type BunkerRequirement = z.infer<typeof BunkerRequirement>;

export const QuoteStatus = z.enum([
  "received",
  "needs_review",
  "accepted",
  "expired",
  "ordered",
  "rejected",
]);
export const Quote = z.object({
  id: Id,
  supplierId: Id,
  portId: Id,
  requirementId: Id.nullable(),
  deliveryFrom: Ts.nullable(),
  deliveryTo: Ts.nullable(),
  validUntil: Ts.nullable(),
  currency: Currency,
  bargeFee: NonNeg,
  status: QuoteStatus,
  extractionId: Id.nullable(),
  receivedAt: Ts,
});
export type Quote = z.infer<typeof Quote>;

export const QuoteLine = z.object({
  id: Id,
  quoteId: Id,
  grade: FuelGrade,
  qtyMt: z.number().positive(),
  pricePerMt: z.number().positive(),
});
export type QuoteLine = z.infer<typeof QuoteLine>;

/** §5 ORDER. Named PurchaseOrder because ORDER is an SQL keyword. */
export const PurchaseOrder = z.object({
  id: Id,
  quoteId: Id,
  recommendationId: Id.nullable(),
  status: z.enum(["draft", "approved", "submitted", "confirmed", "cancelled"]),
  erpPoNumber: z.string().nullable(),
  erpSyncStatus: z.enum(["pending", "synced", "failed"]),
  idempotencyKey: z.string().min(1),
  createdAt: Ts,
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

export const OrderLine = z.object({
  id: Id,
  orderId: Id,
  grade: FuelGrade,
  qtyMt: z.number().positive(),
  pricePerMt: z.number().positive(),
});
export type OrderLine = z.infer<typeof OrderLine>;

export const Document = z.object({
  id: Id,
  /** The email a PDF was attached to. */
  parentId: Id.nullable(),
  kind: z.enum(["email", "pdf"]),
  source: z.enum(["upload", "demo_inbox", "mailbox", "seed"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sender: z.string().nullable(),
  subject: z.string().nullable(),
  filename: z.string().nullable(),
  bodyText: z.string(),
  receivedAt: Ts,
});
export type Document = z.infer<typeof Document>;

export const CheckResult = z.object({
  check: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().nullable(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const ExtractionStatus = z.enum([
  "pending",
  "extracted",
  "needs_review",
  "accepted",
  "not_a_quote",
  "failed",
]);
export type ExtractionStatus = z.infer<typeof ExtractionStatus>;

export const Extraction = z.object({
  id: Id,
  documentId: Id,
  kind: z.enum(["quote", "not_a_quote"]).nullable(),
  /** The model's output, exactly as returned (an ExtractionOutput when it parsed). */
  rawOutput: Json,
  /** Field path → evidence sentence. */
  fieldEvidence: z.record(z.string(), z.string().nullable()),
  checkResults: z.array(CheckResult),
  status: ExtractionStatus,
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: Ts,
});
export type Extraction = z.infer<typeof Extraction>;

export const WeatherSnapshot = z.object({
  id: Id,
  source: z.string().min(1),
  modelRun: Ts,
  fetchedAt: Ts,
  grid: Json,
});
export type WeatherSnapshot = z.infer<typeof WeatherSnapshot>;

export const CalculationKind = z.enum([
  "fob_projection",
  "bunker_plan",
  "emissions",
  "route_speed",
  "calculate",
]);
export const Calculation = z.object({
  id: Id,
  kind: CalculationKind,
  inputs: Json,
  outputs: Json,
  codeVersion: z.string().min(1),
  voyageId: Id.nullable(),
  weatherSnapshotId: Id.nullable(),
  createdAt: Ts,
});
export type Calculation = z.infer<typeof Calculation>;

export const RecommendationType = z.enum(["purchase_order", "voyage_instruction"]);
export const RecommendationStatus = z.enum(["pending", "approved", "rejected", "executed"]);
export const Recommendation = z.object({
  id: Id,
  type: RecommendationType,
  calculationId: Id,
  optionId: z.string().min(1),
  messageId: Id.nullable(),
  factRefs: z.array(FactId),
  expectedSavingUsd: z.number().nullable(),
  status: RecommendationStatus,
  decidedBy: z.string().nullable(),
  decidedAt: Ts.nullable(),
  createdAt: Ts,
});
export type Recommendation = z.infer<typeof Recommendation>;

export const Conversation = z.object({
  id: Id,
  title: z.string().nullable(),
  createdAt: Ts,
});
export type Conversation = z.infer<typeof Conversation>;

export const Message = z.object({
  id: Id,
  conversationId: Id,
  role: z.enum(["user", "assistant", "tool"]),
  content: Json,
  createdAt: Ts,
});
export type Message = z.infer<typeof Message>;

export const AuditEvent = z.object({
  id: Id,
  recommendationId: Id.nullable(),
  kind: z.string().min(1),
  actor: z.string().min(1),
  detail: Json,
  at: Ts,
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const ReferenceRate = z.object({
  id: Id,
  kind: z.enum(["fx", "eua"]),
  /** "EURUSD" for fx, "EUA" for the EU allowance price in EUR/t CO₂. */
  key: z.string().min(1),
  value: z.number().positive(),
  asOf: Ts,
  source: z.string().min(1),
});
export type ReferenceRate = z.infer<typeof ReferenceRate>;
