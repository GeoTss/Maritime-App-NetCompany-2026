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
  ["Conversation", shared.Conversation, schema.conversations],
  ["Message", shared.Message, schema.messages],
  ["AuditEvent", shared.AuditEvent, schema.auditEvents],
  ["ReferenceRate", shared.ReferenceRate, schema.referenceRates],
];

describe("drizzle schema mirrors the shared entities", () => {
  it.each(pairs)("%s has a table with the same keys", (_name, entity, table) => {
    expect(Object.keys(getTableColumns(table)).sort()).toEqual(Object.keys(entity.shape).sort());
  });

  it("has 25 entity tables plus world_meta (26 in all)", () => {
    const names = [...pairs.map(([, , t]) => getTableName(t)), getTableName(schema.worldMeta)];
    expect(new Set(names).size).toBe(26);
    expect(names).toContain("world_meta");
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

  it("world_meta carries the seed bookkeeping columns", () => {
    expect(Object.keys(getTableColumns(schema.worldMeta)).sort()).toEqual(
      ["anchor", "id", "seed", "seedVersion", "seededAt"].sort(),
    );
  });
});
