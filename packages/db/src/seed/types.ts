import {
  BunkerRequirement,
  LatLon,
  NauticalItem,
  NoonReport,
  OrderLine,
  Port,
  PortCall,
  PortCongestion,
  PortFuelPrice,
  PurchaseOrder,
  Quote,
  QuoteLine,
  ReferenceRate,
  RouteLeg,
  Supplier,
  Vessel,
  VesselPosition,
  Voyage,
} from "@pharos/shared";
import { z } from "zod";

/** Shape of routes.generated.json (written by build-routes.ts). */
export const RoutesFile = z.object({
  network: z.string(),
  ports: z.record(z.string(), LatLon),
  legs: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      /** "direct" = ports closer than the network resolution; straight port-to-port line. */
      source: z.enum(["searoute", "direct"]),
      waypoints: z.array(LatLon).min(2),
      ecaFraction: z.number().min(0).max(1),
      libraryLengthNm: z.number().nonnegative(),
      originSnapNm: z.number().nonnegative(),
      destinationSnapNm: z.number().nonnegative(),
    }),
  ),
});
export type RoutesFile = z.infer<typeof RoutesFile>;

export const World = z.object({
  meta: z.object({ seed: z.number().int(), anchor: z.date(), seedVersion: z.string() }),
  ports: z.array(Port),
  routeLegs: z.array(RouteLeg),
  suppliers: z.array(Supplier),
  vessels: z.array(Vessel),
  voyages: z.array(Voyage),
  portCalls: z.array(PortCall),
  noonReports: z.array(NoonReport),
  vesselPositions: z.array(VesselPosition),
  portFuelPrices: z.array(PortFuelPrice),
  portCongestion: z.array(PortCongestion),
  bunkerRequirements: z.array(BunkerRequirement),
  quotes: z.array(Quote),
  quoteLines: z.array(QuoteLine),
  purchaseOrders: z.array(PurchaseOrder),
  orderLines: z.array(OrderLine),
  referenceRates: z.array(ReferenceRate),
  nauticalItems: z.array(NauticalItem),
});
export type World = z.infer<typeof World>;
