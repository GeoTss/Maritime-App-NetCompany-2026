/**
 * Track 3, security: the danger areas (seeded from cited sources), security providers' quotes, and
 * what a route option's security plan needs and costs. Rates are illustrative unless a source is named.
 */
import { z } from "zod";
import { Box, CostLine } from "./port-call.js";
import { Currency, Id, IsoDate, IsoDateTime, LatLon } from "./primitives.js";

const NonNeg = z.number().nonnegative();
const Positive = z.number().positive();

/** JMIC threat levels; LISTED: listed by the insurers' Joint War Committee without a JMIC level. */
export const SecurityLevel = z.enum([
  "CRITICAL",
  "SEVERE",
  "SUBSTANTIAL",
  "MODERATE",
  "LOW",
  "LISTED",
]);
export type SecurityLevel = z.infer<typeof SecurityLevel>;

/**
 * What the planner does in an area: `guards` needs an armed security team; `premium` pays the
 * war-risk premium; `measures` is reporting and protective measures only; `escort` is shown only
 * (private guards are not allowed, navy escorts are); `avoid` is no transit.
 */
export const SecurityPolicy = z.enum(["guards", "premium", "measures", "escort", "avoid"]);
export type SecurityPolicy = z.infer<typeof SecurityPolicy>;

export const SecurityArea = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    level: SecurityLevel,
    policy: SecurityPolicy,
    /** Approximate lat/lon boxes following the sources' published limits or descriptions. */
    boxes: z.array(Box).min(1),
    asOf: IsoDate,
    /** Citation: title, publisher, date, URL. */
    source: z.string().min(1),
    /** Why, in a line, from the sources. */
    note: z.string().min(1),
  })
  .strict();
export type SecurityArea = z.infer<typeof SecurityArea>;

/** A security provider's offer for an armed team, as stored after extraction (or seeded history). */
export const SecurityQuote = z.object({
  id: Id,
  providerId: Id,
  vesselImo: z.string().nullable(),
  embarkPortId: Id,
  disembarkPortId: Id,
  teamSize: z.number().int().positive(),
  /** For the whole team, per day, in `currency`. */
  dayRate: Positive,
  /** Embarkation, disembarkation and arms storage together, in `currency`. */
  fixedFees: NonNeg,
  minDays: z.number().int().nonnegative(),
  currency: Currency,
  validUntil: z.date().nullable(),
  status: z.enum(["received", "needs_review", "accepted", "rejected", "expired"]),
  extractionId: Id.nullable(),
  receivedAt: z.date(),
});
export type SecurityQuote = z.infer<typeof SecurityQuote>;

/** A security quote as the optimiser reads it: points with positions, prices in USD. */
export const SecurityQuoteCandidate = z
  .object({
    quoteId: Id,
    providerId: Id,
    embark: z.object({ portId: Id, position: LatLon }).strict(),
    disembark: z.object({ portId: Id, position: LatLon }).strict(),
    teamSize: z.number().int().positive(),
    dayRateUsd: Positive,
    fixedFeesUsd: NonNeg,
    minDays: z.number().int().nonnegative(),
    validUntil: IsoDateTime.nullable(),
  })
  .strict();
export type SecurityQuoteCandidate = z.infer<typeof SecurityQuoteCandidate>;

/** The canal a route may pass: its box, its dues and the daily northbound convoy window. */
export const CanalTerms = z
  .object({
    id: z.string().min(1),
    box: Box,
    duesUsd: NonNeg,
    /** The northbound convoy leaves daily at this UTC hour (cited: 05:30–11:00 window). */
    convoyHourUtc: z.number().min(0).max(24),
    transitHours: NonNeg,
  })
  .strict();
export type CanalTerms = z.infer<typeof CanalTerms>;

/** What the optimiser needs to plan security; absent = no security planning (as before). */
export const SecurityInput = z
  .object({
    areas: z.array(SecurityArea),
    quotes: z.array(SecurityQuoteCandidate),
    hullValueUsd: NonNeg,
    canal: CanalTerms.nullable(),
  })
  .strict();
export type SecurityInput = z.infer<typeof SecurityInput>;

/** Where a track is inside an area: distances along it and the hours it spends inside. */
export const AreaSpan = z
  .object({ areaId: z.string().min(1), enterNm: NonNeg, exitNm: NonNeg, hoursInside: NonNeg })
  .strict();
export type AreaSpan = z.infer<typeof AreaSpan>;

export const SecurityPlanResult = z
  .object({
    spans: z.array(AreaSpan),
    needsTeam: z.boolean(),
    /** The cheapest valid quote whose points bracket every `guards` span; null when none does. */
    quoteId: Id.nullable(),
    embarkPortId: Id.nullable(),
    disembarkPortId: Id.nullable(),
    embarkAt: IsoDateTime.nullable(),
    disembarkAt: IsoDateTime.nullable(),
    teamDays: z.number().int().nonnegative(),
    costLines: z.array(CostLine),
    extraCostUsd: NonNeg,
    convoyWaitHours: NonNeg,
  })
  .strict();
export type SecurityPlanResult = z.infer<typeof SecurityPlanResult>;
