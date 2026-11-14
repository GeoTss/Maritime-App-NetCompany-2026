import { z } from "zod";
import { FactId } from "./facts.js";
import { Id } from "./primitives.js";

/**
 * The only thing the model can write: a proposal that points at a stored calculation and one of its
 * options. Quantities, prices and speeds are read by the executor from that calculation, so the
 * schema is strict — a model-typed number has nowhere to go.
 */
const ActionBody = {
  calculationId: Id,
  optionId: z.string().min(1),
  factRefs: z.array(FactId).min(1),
  rationale: z.string().min(1),
};

export const ProposedAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("purchase_order"), ...ActionBody }).strict(),
  z.object({ type: z.literal("voyage_instruction"), ...ActionBody }).strict(),
]);
export type ProposedAction = z.infer<typeof ProposedAction>;
