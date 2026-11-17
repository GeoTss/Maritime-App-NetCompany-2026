import { readdirSync, readFileSync } from "node:fs";
import * as shared from "@pharos/shared";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";

type Pair = [string, { shape: object }, PgTable];

const pairs: Pair[] = [
  ["Port", shared.Port, schema.ports],
  ["RouteLeg", shared.RouteLeg, schema.routeLegs],
  ["Supplier", shared.Supplier, schema.suppliers],
  ["Vessel", shared.Vessel, schema.vessels],
  ["VesselPosition", shared.VesselPosition, schema.vesselPositions],
  ["AisTraffic", shared.AisTraffic, schema.aisTraffic],
  ["NavHazard", shared.NavHazard, schema.navHazards],
  ["Voyage", shared.Voyage, schema.voyages],
  ["PortCall", shared.PortCall, schema.portCalls],
  ["NoonReport", shared.NoonReport, schema.noonReports],
  ["PortFuelPrice", shared.PortFuelPrice, schema.portFuelPrices],
  ["PortCongestion", shared.PortCongestion, schema.portCongestion],
  ["BunkerRequirement", shared.BunkerRequirement, schema.bunkerRequirements],
  ["Quote", shared.Quote, schema.quotes],
  ["QuoteLine", shared.QuoteLine, schema.quoteLines],
  ["PurchaseOrder", shared.PurchaseOrder, schema.purchaseOrders],
  ["OrderLine", shared.OrderLine, schema.orderLines],
  ["Document", shared.Document, schema.documents],
  ["Extraction", shared.Extraction, schema.extractions],
  ["WeatherSnapshot", shared.WeatherSnapshot, schema.weatherSnapshots],
  ["Calculation", shared.Calculation, schema.calculations],
  ["Recommendation", shared.Recommendation, schema.recommendations],
  ["DraftedMessage", shared.DraftedMessage, schema.draftedMessages],
  ["Conversation", shared.Conversation, schema.conversations],
  ["Message", shared.Message, schema.messages],
  ["AuditEvent", shared.AuditEvent, schema.auditEvents],
  ["ReferenceRate", shared.ReferenceRate, schema.referenceRates],
  ["LlmCall", shared.LlmCall, schema.llmCalls],
  ["SourceStatus", shared.SourceStatus, schema.sourceStatus],
  ["VoyageInstruction", shared.VoyageInstruction, schema.voyageInstructions],
];

describe("drizzle schema mirrors the shared entities", () => {
  it.each(pairs)("%s has a table with the same keys", (_name, entity, table) => {
    expect(Object.keys(getTableColumns(table)).sort()).toEqual(Object.keys(entity.shape).sort());
  });

  it("has 30 entity tables plus world_meta (31 in all)", () => {
    const names = [...pairs.map(([, , t]) => getTableName(t)), getTableName(schema.worldMeta)];
    expect(new Set(names).size).toBe(31);
    expect(names).toContain("world_meta");
  });

  it("carries the Phase 3 extraction and document columns", () => {
    const ext = getTableColumns(schema.extractions);
    expect(ext.error.notNull).toBe(false);
    expect(ext.claimedAt.notNull).toBe(false);
    const doc = getTableColumns(schema.documents).hasUnreadableAttachment;
    expect(doc.notNull).toBe(true);
    expect(doc.default).toBe(false);
    expect(shared.ExtractionStatus.options).toContain("rejected");
    expect(shared.InboxExtractionStatus.options).toContain("rejected");
  });

  it("purchase_orders has a unique index on idempotency_key", () => {
    const idx = getTableConfig(schema.purchaseOrders).indexes.find(
      (i) => i.config.name === "purchase_orders_idempotency_key_uq",
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns).toHaveLength(1);
    const col = idx?.config.columns[0];
    expect(col && "name" in col ? col.name : null).toBe(schema.purchaseOrders.idempotencyKey.name);
  });

  it("carries the Phase 4 lineage, gate-attempt and draft columns", () => {
    const calc = getTableColumns(schema.calculations).operandFactIds;
    expect(calc.notNull).toBe(false);
    const gate = getTableColumns(schema.messages).gateAttempts;
    expect(gate.notNull).toBe(true);
    expect(gate.default).toEqual([]);
    const draft = getTableColumns(schema.draftedMessages);
    expect(draft.to.name).toBe("to_address");
    expect(draft.status.default).toBe("draft");
    expect(draft.status.notNull).toBe(true);
  });

  it("drafted_messages has a unique index on (recommendation_id, kind)", () => {
    const idx = getTableConfig(schema.draftedMessages).indexes.find(
      (i) => i.config.name === "drafted_messages_recommendation_kind_uq",
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => ("name" in c ? c.name : null))).toEqual([
      schema.draftedMessages.recommendationId.name,
      schema.draftedMessages.kind.name,
    ]);
  });

  it("the Phase 4 migration is additive (no drops, renames or type changes)", () => {
    const dir = new URL("../drizzle/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.startsWith("0004_") && f.endsWith(".sql"));
    expect(file).toBeDefined();
    const sqlText = readFileSync(new URL(file ?? "", dir), "utf8");
    expect(sqlText).not.toMatch(/DROP |RENAME |ALTER COLUMN|TRUNCATE|DELETE FROM/i);
    expect(sqlText).toMatch(/CREATE TABLE "drafted_messages"/);
    expect(sqlText).toMatch(/ADD COLUMN "operand_fact_ids"/);
    expect(sqlText).toMatch(/ADD COLUMN "gate_attempts"/);
  });

  it("the Phase 5 migration is additive and creates source_status", () => {
    const dir = new URL("../drizzle/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.startsWith("0005_") && f.endsWith(".sql"));
    expect(file).toBeDefined();
    const sqlText = readFileSync(new URL(file ?? "", dir), "utf8");
    expect(sqlText).not.toMatch(/DROP |RENAME |ALTER COLUMN|TRUNCATE|DELETE FROM/i);
    expect(sqlText).toMatch(/CREATE TABLE "source_status"/);
  });

  it("voyage_instructions has one row per recommendation and references its voyage and calculation", () => {
    const config = getTableConfig(schema.voyageInstructions);
    const idx = config.indexes.find(
      (i) => i.config.name === "voyage_instructions_recommendation_id_uq",
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => ("name" in c ? c.name : null))).toEqual([
      schema.voyageInstructions.recommendationId.name,
    ]);
    const targets = config.foreignKeys
      .map((fk) => getTableName(fk.reference().foreignTable))
      .sort();
    expect(targets).toEqual(["calculations", "ports", "quotes", "recommendations", "voyages"]);
    const cols = getTableColumns(schema.voyageInstructions);
    const stop = ["stopPortId", "stopQuoteId", "stopArriveAt", "stopDepartAt", "stopQtyMt"];
    for (const [key, c] of Object.entries(cols)) expect(c.notNull).toBe(!stop.includes(key));
  });

  it("the bunker-stop migration only adds nullable voyage_instructions columns", () => {
    const dir = new URL("../drizzle/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.startsWith("0010_") && f.endsWith(".sql"));
    expect(file).toBeDefined();
    const sqlText = readFileSync(new URL(file ?? "", dir), "utf8");
    expect(sqlText).not.toMatch(/DROP |RENAME |ALTER COLUMN|TRUNCATE|DELETE FROM|NOT NULL/i);
    for (const col of [
      "stop_port_id",
      "stop_quote_id",
      "stop_arrive_at",
      "stop_depart_at",
      "stop_qty_mt",
    ]) {
      expect(sqlText).toMatch(new RegExp(`ALTER TABLE "voyage_instructions" ADD COLUMN "${col}"`));
    }
  });

  it("the voyage_instructions migration is additive", () => {
    const dir = new URL("../drizzle/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.startsWith("0007_") && f.endsWith(".sql"));
    expect(file).toBeDefined();
    const sqlText = readFileSync(new URL(file ?? "", dir), "utf8");
    expect(sqlText).not.toMatch(/DROP |RENAME |ALTER COLUMN|TRUNCATE|DELETE FROM/i);
    expect(sqlText).toMatch(/CREATE TABLE "voyage_instructions"/);
    expect(sqlText).toMatch(/CREATE UNIQUE INDEX "voyage_instructions_recommendation_id_uq"/);
  });

  it("world_meta carries the seed bookkeeping columns", () => {
    expect(Object.keys(getTableColumns(schema.worldMeta)).sort()).toEqual(
      ["anchor", "id", "seed", "seedVersion", "seededAt"].sort(),
    );
  });
});
