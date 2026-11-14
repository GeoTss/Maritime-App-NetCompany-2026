import { z } from "zod";

/** Marine fuel grades the planner works with. LSMGO is the 0.1 % S grade required inside ECAs. */
export const FUEL_GRADES = ["LSMGO", "VLSFO", "HSFO"] as const;
export const FuelGrade = z.enum(FUEL_GRADES);
export type FuelGrade = z.infer<typeof FuelGrade>;

/** Currencies quotes may be priced in. Totals are always reported in USD. */
export const Currency = z.enum(["USD", "EUR"]);
export type Currency = z.infer<typeof Currency>;

const Mt = z.number().nonnegative();

/** A tonnage per fuel grade (metric tonnes). Every grade is always present. */
export const GradeAmounts = z.object({ LSMGO: Mt, VLSFO: Mt, HSFO: Mt }).strict();
export type GradeAmounts = z.infer<typeof GradeAmounts>;

export const LatLon = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .strict();
export type LatLon = z.infer<typeof LatLon>;

/** Database identifier. */
export const Id = z.number().int().positive();
export type Id = z.infer<typeof Id>;

/** Ship types with an IMO CII reference line in this app. */
export const ShipType = z.enum(["bulk_carrier", "tanker", "container"]);
export type ShipType = z.infer<typeof ShipType>;

/** ISO-8601 timestamp with offset, as sent over HTTP. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;
