import { asc } from "drizzle-orm";
import { createDb } from "./client.js";
import * as schema from "./schema.js";
import { World } from "./seed/types.js";
import type { Sql } from "./sql.js";

/** Read the stored synthetic world (every world table in id order, plus `world_meta`). */
export async function loadWorld(sql: Sql): Promise<World> {
  const db = createDb(sql);
  const [meta] = await db.select().from(schema.worldMeta);
  if (!meta) throw new Error("loadWorld: world_meta is empty; seed the database first");
  const rows = {
    ports: await db.select().from(schema.ports).orderBy(asc(schema.ports.id)),
    routeLegs: await db.select().from(schema.routeLegs).orderBy(asc(schema.routeLegs.id)),
    suppliers: await db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.id)),
    vessels: await db.select().from(schema.vessels).orderBy(asc(schema.vessels.id)),
    voyages: await db.select().from(schema.voyages).orderBy(asc(schema.voyages.id)),
    portCalls: await db.select().from(schema.portCalls).orderBy(asc(schema.portCalls.id)),
    noonReports: await db.select().from(schema.noonReports).orderBy(asc(schema.noonReports.id)),
    vesselPositions: await db
      .select()
      .from(schema.vesselPositions)
      .orderBy(asc(schema.vesselPositions.id)),
    portFuelPrices: await db
      .select()
      .from(schema.portFuelPrices)
      .orderBy(asc(schema.portFuelPrices.id)),
    portCongestion: await db
      .select()
      .from(schema.portCongestion)
      .orderBy(asc(schema.portCongestion.id)),
    bunkerRequirements: await db
      .select()
      .from(schema.bunkerRequirements)
      .orderBy(asc(schema.bunkerRequirements.id)),
    quotes: await db.select().from(schema.quotes).orderBy(asc(schema.quotes.id)),
    quoteLines: await db.select().from(schema.quoteLines).orderBy(asc(schema.quoteLines.id)),
    purchaseOrders: await db
      .select()
      .from(schema.purchaseOrders)
      .orderBy(asc(schema.purchaseOrders.id)),
    orderLines: await db.select().from(schema.orderLines).orderBy(asc(schema.orderLines.id)),
    referenceRates: await db
      .select()
      .from(schema.referenceRates)
      .orderBy(asc(schema.referenceRates.id)),
    nauticalItems: await db
      .select()
      .from(schema.nauticalItems)
      .orderBy(asc(schema.nauticalItems.itemId)),
    securityAreas: await db
      .select()
      .from(schema.securityAreas)
      .orderBy(asc(schema.securityAreas.id)),
    securityProviders: await db
      .select()
      .from(schema.securityProviders)
      .orderBy(asc(schema.securityProviders.id)),
    securityQuotes: await db
      .select()
      .from(schema.securityQuotes)
      .orderBy(asc(schema.securityQuotes.id)),
  };
  return World.parse({
    meta: { seed: meta.seed, anchor: meta.anchor, seedVersion: meta.seedVersion },
    ...rows,
  });
}
