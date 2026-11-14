/** Golden extraction truth and the normalised view the graders compare against. */
import { z } from "zod";
import { Currency, FuelGrade, Id, IsoDate } from "../primitives.js";

export const TruthLine = z
  .object({
    grade: FuelGrade.nullable(),
    qtyMt: z.number().nullable(),
    pricePerMt: z.number().nullable(),
  })
  .strict();
export type TruthLine = z.infer<typeof TruthLine>;

/** Null means "not determinable from the document": it must never be auto-accepted. */
export const TruthQuote = z
  .object({
    vesselImo: z.string().nullable(),
    portUnlocode: z.string().nullable(),
    supplierKey: z.string().nullable(),
    currency: Currency.nullable(),
    validUntil: IsoDate.nullable(),
    deliveryFrom: IsoDate.nullable(),
    deliveryTo: IsoDate.nullable(),
    /** Total barge fee in the quote currency. */
    bargeFee: z.number().nonnegative().nullable(),
    lines: z.array(TruthLine).min(1),
  })
  .strict();
export type TruthQuote = z.infer<typeof TruthQuote>;

export const TruthStatus = z.enum(["extracted", "needs_review", "not_a_quote"]);
export type TruthStatus = z.infer<typeof TruthStatus>;

export const ExtractionTruth = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** tags[0] is the category. */
    tags: z.array(z.string().min(1)).min(1),
    source: z.enum(["generated", "hard"]),
    expected: z
      .object({
        kind: z.enum(["quote", "not_a_quote"]),
        status: TruthStatus,
        /** Non-empty iff status is needs_review; any one failing check satisfies it. */
        reviewChecks: z.array(z.string().min(1)),
        quote: TruthQuote.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((truth, ctx) => {
    const { kind, status, reviewChecks, quote } = truth.expected;
    const issue = (message: string, path: string[]) =>
      ctx.addIssue({ code: "custom", message, path: ["expected", ...path] });
    if (kind === "quote" && status === "not_a_quote") {
      issue("kind quote requires status extracted or needs_review", ["status"]);
    }
    if (kind === "not_a_quote") {
      if (status === "extracted") {
        issue("kind not_a_quote requires status not_a_quote or needs_review", ["status"]);
      }
      if (quote !== null) issue("kind not_a_quote requires quote null", ["quote"]);
    }
    if (kind === "quote" && quote === null && status !== "needs_review") {
      issue("quote may be null only when status is needs_review", ["quote"]);
    }
    if ((status === "needs_review") !== reviewChecks.length > 0) {
      issue("reviewChecks must be non-empty iff status is needs_review", ["reviewChecks"]);
    }
  });
export type ExtractionTruth = z.infer<typeof ExtractionTruth>;

export const NormalisedLine = z
  .object({
    grade: FuelGrade.nullable(),
    qtyMt: z.number().nullable(),
    pricePerMt: z.number().nullable(),
  })
  .strict();
export type NormalisedLine = z.infer<typeof NormalisedLine>;

/** Extraction output mapped to world ids, units and dates by deterministic code. */
export const NormalisedView = z
  .object({
    vesselId: Id.nullable(),
    portId: Id.nullable(),
    supplierId: Id.nullable(),
    currency: Currency.nullable(),
    validUntil: IsoDate.nullable(),
    deliveryFrom: IsoDate.nullable(),
    deliveryTo: IsoDate.nullable(),
    bargeFee: z.number().nullable(),
    /** Empty when extraction failed. */
    lines: z.array(NormalisedLine),
  })
  .strict();
export type NormalisedView = z.infer<typeof NormalisedView>;

/** Fields whose uncertainty forces human review. */
export const CRITICAL_FIELDS = [
  "price",
  "currency",
  "quantity",
  "grade",
  "port",
  "validUntil",
  "deliveryFrom",
  "deliveryTo",
  "vessel",
] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];
