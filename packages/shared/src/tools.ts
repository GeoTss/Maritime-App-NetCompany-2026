/**
 * Agent tool inputs: the single definition of what the model may pass to each tool. Every schema is
 * strict, so a model-typed number or an unknown field has nowhere to go. `ProposedAction` (what a
 * proposal parses to) lives in `actions.ts`; `ProposeActionInput` is the same shape as one flat
 * object, because a tool schema must be an object.
 */
import { z } from "zod";
import { FactId } from "./facts.js";
import { FuelGrade, Id } from "./primitives.js";

const VesselRef = z
  .string()
  .trim()
  .min(1)
  .describe('Vessel name (e.g. "Aegean Pioneer") or 7-digit IMO.');

export const VesselStatusInput = z.object({ vessel: VesselRef }).strict();
export type VesselStatusInput = z.infer<typeof VesselStatusInput>;

export const PlanBunkeringInput = z
  .object({
    vessel: VesselRef.optional().describe(
      'Vessel name (e.g. "Aegean Pioneer") or 7-digit IMO. Omit it to plan every vessel with an open requirement.',
    ),
  })
  .strict();
export type PlanBunkeringInput = z.infer<typeof PlanBunkeringInput>;

/** `ProposedAction` as one strict object (the union compiles to `oneOf`, which a tool cannot use). */
export const ProposeActionInput = z
  .object({
    type: z
      .enum(["purchase_order", "voyage_instruction"])
      .describe("purchase_order for a bunker plan option."),
    calculationId: Id.describe("The calculationId a plan_bunkering result returned."),
    optionId: z.string().min(1).describe("The optionId of the plan option, e.g. its bestOptionId."),
    factRefs: z
      .array(FactId)
      .min(1)
      .describe(
        "Ids of the facts, returned earlier in this conversation, that support the proposal.",
      ),
    rationale: z.string().min(1).describe("One sentence on why, without numbers."),
  })
  .strict();
export type ProposeActionInput = z.infer<typeof ProposeActionInput>;

export const ListFleetInput = z.object({}).strict();
export type ListFleetInput = z.infer<typeof ListFleetInput>;

export const ListQuotesInput = z
  .object({
    vessel: VesselRef.optional(),
    port: z.string().trim().min(1).optional().describe("Port name or 5-letter UN/LOCODE."),
    grade: FuelGrade.optional(),
    includeExpired: z
      .boolean()
      .optional()
      .describe("Also return quotes past their validity. Default false."),
  })
  .strict();
export type ListQuotesInput = z.infer<typeof ListQuotesInput>;

export const EmissionsInput = z.object({ vessel: VesselRef }).strict();
export type EmissionsInput = z.infer<typeof EmissionsInput>;

export const CalcOp = z.enum([
  "add",
  "subtract",
  "multiply",
  "divide",
  "difference",
  "percent_change",
  "sum",
  "min",
  "max",
]);
export type CalcOp = z.infer<typeof CalcOp>;

/** Ops that take exactly two operands, in order (a - b, a / b, |a - b|, (b - a) / a). */
export const BINARY_CALC_OPS: readonly CalcOp[] = [
  "subtract",
  "divide",
  "difference",
  "percent_change",
];

export const CalculateInput = z
  .object({
    op: CalcOp,
    operands: z
      .array(FactId)
      .min(1)
      .max(10)
      .describe("Ids of facts returned earlier in this conversation, never typed numbers."),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (BINARY_CALC_OPS.includes(input.op) && input.operands.length !== 2) {
      ctx.addIssue({
        code: "custom",
        path: ["operands"],
        message: `${input.op} takes exactly 2 operands`,
      });
    }
  });
export type CalculateInput = z.infer<typeof CalculateInput>;
