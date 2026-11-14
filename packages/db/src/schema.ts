/**
 * Drizzle schema. Mirrors `packages/shared/src/entities.ts` column for column (camelCase keys; the
 * Drizzle instance and drizzle.config use `casing: "snake_case"`). Checked by `schema.test.ts`.
 */
import type {
  CheckResult,
  ConsumptionCurve,
  EtsCoverageFactor,
  FactId,
  FuelGrade,
  GradeAmounts,
  Id,
  LatLon,
} from "@pharos/shared";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => integer().primaryKey().generatedByDefaultAsIdentity();
const ts = () => timestamp({ withTimezone: true, mode: "date" });
export const ports = pgTable(
  "ports",
  {
    id: id(),
    unlocode: text().notNull(),
    name: text().notNull(),
    country: text().notNull(),
    lat: doublePrecision().notNull(),
    lon: doublePrecision().notNull(),
    isEu: boolean().notNull(),
    inEca: boolean().notNull(),
    approachNm: doublePrecision().notNull(),
  },
  (t) => [uniqueIndex("ports_unlocode_uq").on(t.unlocode)],
);

export const routeLegs = pgTable("route_legs", {
  id: id(),
  fromPortId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  toPortId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  distanceNm: doublePrecision().notNull(),
  requiredGrade: text().$type<FuelGrade>().notNull(),
  etsCoverage: doublePrecision().$type<EtsCoverageFactor>().notNull(),
  waypoints: jsonb().$type<LatLon[]>().notNull(),
});

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text().notNull(),
  emailDomain: text().notNull(),
  erpCode: text().notNull(),
  portIds: jsonb().$type<Id[]>().notNull(),
});

export const vessels = pgTable(
  "vessels",
  {
    id: id(),
    imo: text().notNull(),
    mmsi: text().notNull(),
    name: text().notNull(),
    shipType: text().$type<"bulk_carrier" | "tanker" | "container">().notNull(),
    dwt: doublePrecision().notNull(),
    trackingSource: text().$type<"simulator" | "ais">().notNull(),
    tankCapacityMt: jsonb().$type<GradeAmounts>().notNull(),
    consumptionCurve: jsonb().$type<ConsumptionCurve>().notNull(),
    dailyCostUsd: doublePrecision().notNull(),
  },
  (t) => [uniqueIndex("vessels_imo_uq").on(t.imo)],
);

export const vesselPositions = pgTable("vessel_positions", {
  id: id(),
  vesselId: integer()
    .notNull()
    .references(() => vessels.id, { onDelete: "restrict" }),
  ts: ts().notNull(),
  lat: doublePrecision().notNull(),
  lon: doublePrecision().notNull(),
  sogKn: doublePrecision().notNull(),
  cog: doublePrecision().notNull(),
  navStatus: text().notNull(),
  source: text().$type<"simulator" | "ais">().notNull(),
});

/** Latest state of public AIS traffic; keyed by MMSI. */
export const aisTraffic = pgTable("ais_traffic", {
  mmsi: text().primaryKey(),
  name: text(),
  shipType: text(),
  lat: doublePrecision().notNull(),
  lon: doublePrecision().notNull(),
  sogKn: doublePrecision(),
  navStatus: text(),
  destination: text(),
  updatedAt: ts().notNull(),
});

export const voyages = pgTable("voyages", {
  id: id(),
  vesselId: integer()
    .notNull()
    .references(() => vessels.id, { onDelete: "restrict" }),
  voyageNo: text().notNull(),
  originPortId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  destinationPortId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  plannedSpeedKn: doublePrecision().notNull(),
  plannedRoute: jsonb().$type<Id[]>().notNull(),
  status: text().$type<"planned" | "underway" | "completed">().notNull(),
  departedAt: ts(),
});

export const portCalls = pgTable("port_calls", {
  id: id(),
  voyageId: integer()
    .notNull()
    .references(() => voyages.id, { onDelete: "restrict" }),
  portId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  sequence: integer().notNull(),
  purpose: text().$type<"load" | "discharge" | "bunker" | "passage">().notNull(),
  eta: ts().notNull(),
  berthWindowStart: ts(),
  berthWindowEnd: ts(),
});

export const noonReports = pgTable("noon_reports", {
  id: id(),
  vesselId: integer()
    .notNull()
    .references(() => vessels.id, { onDelete: "restrict" }),
  voyageId: integer().references(() => voyages.id, { onDelete: "restrict" }),
  ts: ts().notNull(),
  lat: doublePrecision().notNull(),
  lon: doublePrecision().notNull(),
  speedKn: doublePrecision().notNull(),
  distanceSinceLastNm: doublePrecision().notNull(),
  robMt: jsonb().$type<GradeAmounts>().notNull(),
  consumedMt: jsonb().$type<GradeAmounts>().notNull(),
});

export const portFuelPrices = pgTable("port_fuel_prices", {
  id: id(),
  portId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  grade: text().$type<FuelGrade>().notNull(),
  priceUsdPerMt: doublePrecision().notNull(),
  asOf: ts().notNull(),
  source: text().notNull(),
});

export const portCongestion = pgTable("port_congestion", {
  id: id(),
  portId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  observedAt: ts().notNull(),
  anchoredCount: integer().notNull(),
  waitingHours: doublePrecision().notNull(),
  source: text().$type<"seed" | "ais">().notNull(),
});

export const bunkerRequirements = pgTable("bunker_requirements", {
  id: id(),
  voyageId: integer()
    .notNull()
    .references(() => voyages.id, { onDelete: "restrict" }),
  grade: text().$type<FuelGrade>().notNull(),
  qtyMt: doublePrecision().notNull(),
  status: text().$type<"open" | "ordered" | "cancelled">().notNull(),
  createdAt: ts().notNull(),
});

export const documents = pgTable(
  "documents",
  {
    id: id(),
    parentId: integer().references((): AnyPgColumn => documents.id, { onDelete: "restrict" }),
    kind: text().$type<"email" | "pdf">().notNull(),
    source: text().$type<"upload" | "demo_inbox" | "mailbox" | "seed">().notNull(),
    sha256: text().notNull(),
    sender: text(),
    subject: text(),
    filename: text(),
    bodyText: text().notNull(),
    receivedAt: ts().notNull(),
    hasUnreadableAttachment: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("documents_sha256_uq").on(t.sha256)],
);

export const extractions = pgTable("extractions", {
  id: id(),
  documentId: integer()
    .notNull()
    .references(() => documents.id, { onDelete: "restrict" }),
  kind: text().$type<"quote" | "not_a_quote">(),
  rawOutput: jsonb().$type<unknown>(),
  fieldEvidence: jsonb().$type<Record<string, string | null>>().notNull(),
  checkResults: jsonb().$type<CheckResult[]>().notNull(),
  status: text()
    .$type<
      "pending" | "extracted" | "needs_review" | "accepted" | "not_a_quote" | "failed" | "rejected"
    >()
    .notNull(),
  model: text().notNull(),
  promptVersion: text().notNull(),
  createdAt: ts().notNull(),
  error: text(),
  claimedAt: ts(),
});

export const quotes = pgTable("quotes", {
  id: id(),
  supplierId: integer()
    .notNull()
    .references(() => suppliers.id, { onDelete: "restrict" }),
  portId: integer()
    .notNull()
    .references(() => ports.id, { onDelete: "restrict" }),
  requirementId: integer().references(() => bunkerRequirements.id, { onDelete: "restrict" }),
  deliveryFrom: ts(),
  deliveryTo: ts(),
  validUntil: ts(),
  currency: text().$type<"USD" | "EUR">().notNull(),
  bargeFee: doublePrecision().notNull(),
  status: text()
    .$type<"received" | "needs_review" | "accepted" | "expired" | "ordered" | "rejected">()
    .notNull(),
  extractionId: integer().references(() => extractions.id, { onDelete: "restrict" }),
  receivedAt: ts().notNull(),
});

export const quoteLines = pgTable("quote_lines", {
  id: id(),
  quoteId: integer()
    .notNull()
    .references(() => quotes.id, { onDelete: "restrict" }),
  grade: text().$type<FuelGrade>().notNull(),
  qtyMt: doublePrecision().notNull(),
  pricePerMt: doublePrecision().notNull(),
});

export const weatherSnapshots = pgTable("weather_snapshots", {
  id: id(),
  source: text().notNull(),
  modelRun: ts().notNull(),
  fetchedAt: ts().notNull(),
  grid: jsonb().$type<unknown>(),
});

export const calculations = pgTable("calculations", {
  id: id(),
  kind: text()
    .$type<"fob_projection" | "bunker_plan" | "emissions" | "route_speed" | "calculate">()
    .notNull(),
  inputs: jsonb().$type<unknown>(),
  outputs: jsonb().$type<unknown>(),
  codeVersion: text().notNull(),
  voyageId: integer().references(() => voyages.id, { onDelete: "restrict" }),
  weatherSnapshotId: integer().references(() => weatherSnapshots.id, { onDelete: "restrict" }),
  createdAt: ts().notNull(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  title: text(),
  createdAt: ts().notNull(),
});

export const messages = pgTable("messages", {
  id: id(),
  conversationId: integer()
    .notNull()
    .references(() => conversations.id, { onDelete: "restrict" }),
  role: text().$type<"user" | "assistant" | "tool">().notNull(),
  content: jsonb().$type<unknown>(),
  createdAt: ts().notNull(),
});

export const recommendations = pgTable("recommendations", {
  id: id(),
  type: text().$type<"purchase_order" | "voyage_instruction">().notNull(),
  calculationId: integer()
    .notNull()
    .references(() => calculations.id, { onDelete: "restrict" }),
  optionId: text().notNull(),
  messageId: integer().references(() => messages.id, { onDelete: "restrict" }),
  factRefs: jsonb().$type<FactId[]>().notNull(),
  expectedSavingUsd: doublePrecision(),
  status: text().$type<"pending" | "approved" | "rejected" | "executed">().notNull(),
  decidedBy: text(),
  decidedAt: ts(),
  createdAt: ts().notNull(),
});

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    quoteId: integer()
      .notNull()
      .references(() => quotes.id, { onDelete: "restrict" }),
    recommendationId: integer().references(() => recommendations.id, { onDelete: "restrict" }),
    status: text()
      .$type<"draft" | "approved" | "submitted" | "confirmed" | "cancelled">()
      .notNull(),
    erpPoNumber: text(),
    erpSyncStatus: text().$type<"pending" | "synced" | "failed">().notNull(),
    idempotencyKey: text().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [
    uniqueIndex("purchase_orders_quote_id_uq").on(t.quoteId),
    uniqueIndex("purchase_orders_idempotency_key_uq").on(t.idempotencyKey),
  ],
);

export const orderLines = pgTable("order_lines", {
  id: id(),
  orderId: integer()
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "restrict" }),
  grade: text().$type<FuelGrade>().notNull(),
  qtyMt: doublePrecision().notNull(),
  pricePerMt: doublePrecision().notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: id(),
  recommendationId: integer().references(() => recommendations.id, { onDelete: "restrict" }),
  kind: text().notNull(),
  actor: text().notNull(),
  detail: jsonb().$type<unknown>(),
  at: ts().notNull(),
});

export const referenceRates = pgTable("reference_rates", {
  id: id(),
  kind: text().$type<"fx" | "eua">().notNull(),
  key: text().notNull(),
  value: doublePrecision().notNull(),
  asOf: ts().notNull(),
  source: text().notNull(),
});

/** One model call, for latency and cost measurement. Mirrors the shared `LlmCall`. */
export const llmCalls = pgTable("llm_calls", {
  id: id(),
  purpose: text().$type<"extract" | "agent">().notNull(),
  model: text().notNull(),
  mode: text().$type<"live" | "record" | "replay">().notNull(),
  inputTokens: integer().notNull(),
  outputTokens: integer().notNull(),
  cacheReadTokens: integer().notNull(),
  cacheWriteTokens: integer().notNull(),
  latencyMs: doublePrecision().notNull(),
  costUsd: doublePrecision().notNull(),
  stopReason: text(),
  /** sha256 of the canonical request; the key of its recording. */
  requestKey: text().notNull(),
  documentId: integer().references(() => documents.id, { onDelete: "restrict" }),
  conversationId: integer().references(() => conversations.id, { onDelete: "restrict" }),
  createdAt: ts().notNull(),
});

/** Single-row bookkeeping for the seeded synthetic world (id is always 1). */
export const worldMeta = pgTable("world_meta", {
  id: integer().primaryKey(),
  seed: integer().notNull(),
  anchor: ts().notNull(),
  seedVersion: text().notNull(),
  seededAt: ts().notNull(),
});
