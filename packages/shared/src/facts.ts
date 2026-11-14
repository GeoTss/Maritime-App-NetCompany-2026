import { z } from "zod";
import { Id, IsoDateTime } from "./primitives.js";

/** Stable identifier of one fact in an answer's fact ledger. */
export const FactId = z.string().regex(/^f_[A-Za-z0-9_.:-]+$/, "fact ids look like f_<name>");
export type FactId = z.infer<typeof FactId>;

export const DerivedOperation = z.enum([
  "add",
  "subtract",
  "multiply",
  "divide",
  "percent_change",
  "sum",
  "min",
  "max",
]);
export type DerivedOperation = z.infer<typeof DerivedOperation>;

/** Where a fact came from. Every number shown to a user traces back to one of these. */
export const Provenance = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("db"),
      table: z.string().min(1),
      rowId: z.union([Id, z.string().min(1)]),
      field: z.string().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("calculation"),
      calculationId: Id,
      calculator: z.string().min(1),
      /** JSON path into the calculation outputs, e.g. "options[0].totalCostUsd". */
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("document"),
      documentId: Id,
      extractionId: Id,
      field: z.string().min(1),
      evidence: z.string().min(1),
    })
    .strict(),
  z.object({ source: z.literal("ais"), mmsi: z.string().min(1), ts: IsoDateTime }).strict(),
  z.object({ source: z.literal("weather"), snapshotId: Id, modelRun: IsoDateTime }).strict(),
  z
    .object({
      source: z.literal("derived"),
      operation: DerivedOperation,
      operands: z.array(FactId).min(1),
    })
    .strict(),
]);
export type Provenance = z.infer<typeof Provenance>;

export const Fact = z
  .object({
    id: FactId,
    label: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean()]),
    unit: z.string().nullable(),
    provenance: Provenance,
  })
  .strict();
export type Fact = z.infer<typeof Fact>;

/** What every agent tool returns: citable facts plus whatever structured data it computed. */
export const ToolResult = z.object({ facts: z.array(Fact), data: z.unknown() });
export type ToolResult = z.infer<typeof ToolResult>;
