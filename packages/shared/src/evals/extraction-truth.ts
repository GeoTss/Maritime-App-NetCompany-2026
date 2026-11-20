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

/**
 * A security provider's offer of an armed team (Track 3), as a careful desk would store it.
 * Null means "not determinable from the document", as for a fuel quote: it must never be
 * auto-accepted.
 */
export const TruthSecurityQuote = z
  .object({
    /** The provider's seeded name, resolved from the sender's domain; null when unknown. */
    provider: z.string().min(1).nullable(),
    vesselImo: z.string().nullable(),
    embarkUnlocode: z.string().nullable(),
    disembarkUnlocode: z.string().nullable(),
    /** Guards in the team; null when the email gives a choice ("4/6 guards"). */
    teamSize: z.number().int().positive().nullable(),
    /** Price per team per day, in `currency`. */
    dayRate: z.number().positive().nullable(),
    currency: Currency.nullable(),
    /** Total one-off charges (embarkation, disembarkation, arms storage) in `currency`. */
    fixedFees: z.number().nonnegative().nullable(),
    /** Minimum days charged. */
    minDays: z.number().int().nonnegative().nullable(),
    validUntil: IsoDate.nullable(),
  })
  .strict();
export type TruthSecurityQuote = z.infer<typeof TruthSecurityQuote>;

export const TruthStatus = z.enum(["extracted", "needs_review", "not_a_quote"]);
export type TruthStatus = z.infer<typeof TruthStatus>;

export const TruthKind = z.enum(["quote", "not_a_quote", "security_quote"]);
export type TruthKind = z.infer<typeof TruthKind>;

export const ExtractionTruth = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** tags[0] is the category. */
    tags: z.array(z.string().min(1)).min(1),
    source: z.enum(["generated", "hard"]),
    expected: z
      .object({
        kind: TruthKind,
        status: TruthStatus,
        /** Non-empty iff status is needs_review; any one failing check satisfies it. */
        reviewChecks: z.array(z.string().min(1)),
        /** The fuel quote; null for a security quote and for a document that is not a quote. */
        quote: TruthQuote.nullable(),
        /**
         * The security quote (kind `security_quote` only; absent on fuel and not-a-quote truths,
         * so every truth written before Track 3 parses unchanged).
         */
        security: TruthSecurityQuote.nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((truth, ctx) => {
    const { kind, status, reviewChecks, quote, security } = truth.expected;
    const issue = (message: string, path: string[]) =>
      ctx.addIssue({ code: "custom", message, path: ["expected", ...path] });
    if (kind !== "security_quote" && security !== undefined && security !== null) {
      issue("only kind security_quote may carry a security quote", ["security"]);
    }
    if (kind === "security_quote") {
      if (status === "not_a_quote") {
        issue("kind security_quote requires status extracted or needs_review", ["status"]);
      }
      if (quote !== null) issue("kind security_quote requires quote null", ["quote"]);
      if (security === undefined) issue("kind security_quote requires security", ["security"]);
      if (security === null && status !== "needs_review") {
        issue("security may be null only when status is needs_review", ["security"]);
      }
    }
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

/**
 * Security-quote fields whose uncertainty forces human review (Track 3): every value that decides
 * what the team costs (day rate, currency, fixed fees, minimum days, team size), whether it covers
 * the route (embark and disembark points, validity) and which ship it is for. The provider, like
 * the fuel supplier, is not critical but still makes an auto-accept unsafe when it is off.
 */
export const SECURITY_CRITICAL_FIELDS = [
  "vessel",
  "embarkPort",
  "disembarkPort",
  "teamSize",
  "dayRate",
  "currency",
  "fixedFees",
  "minDays",
  "validUntil",
] as const;
export type SecurityCriticalField = (typeof SECURITY_CRITICAL_FIELDS)[number];
