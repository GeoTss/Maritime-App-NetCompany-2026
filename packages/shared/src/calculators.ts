import { z } from "zod";
import {
  Currency,
  EtsCoverageFactor,
  FuelGrade,
  GradeAmounts,
  Id,
  ShipType,
} from "./primitives.js";

const Positive = z.number().positive();
const NonNeg = z.number().nonnegative();

/**
 * The vessel's displacement on this passage against the displacement the curve's reference
 * consumption was taken at (full load: lightship + deadweight). The main engine burn scales by
 * (displacementMt / refDisplacementMt)^(2/3) (admiralty law); auxiliary burn is not scaled.
 */
export const LoadCondition = z
  .object({
    displacementMt: Positive,
    refDisplacementMt: Positive,
  })
  .strict();
export type LoadCondition = z.infer<typeof LoadCondition>;

/**
 * A vessel's speed–consumption curve under the cubic law:
 * main engine mt/day = refMtPerDay × (speed / refSpeedKn)³ × load factor, plus a constant
 * auxiliary load. Valid only between minSpeedKn and maxSpeedKn. Without `load` the factor is 1
 * (the reference condition).
 */
export const ConsumptionCurve = z
  .object({
    refSpeedKn: Positive,
    refMtPerDay: Positive,
    auxMtPerDay: NonNeg,
    minSpeedKn: Positive,
    maxSpeedKn: Positive,
    load: LoadCondition.optional(),
  })
  .strict()
  .refine((c) => c.maxSpeedKn >= c.minSpeedKn, {
    message: "maxSpeedKn must be >= minSpeedKn",
    path: ["maxSpeedKn"],
  });
export type ConsumptionCurve = z.infer<typeof ConsumptionCurve>;

// ---------- Fuel-on-board projection ----------

export const FobLeg = z.object({ distanceNm: NonNeg, grade: FuelGrade }).strict();
export type FobLeg = z.infer<typeof FobLeg>;

export const FobProjectionInput = z
  .object({
    robMt: GradeAmounts,
    legs: z.array(FobLeg),
    speedKn: Positive,
    curve: ConsumptionCurve,
    safetyMarginDays: NonNeg,
  })
  .strict();
export type FobProjectionInput = z.infer<typeof FobProjectionInput>;

/** ROB per grade; may go negative in a projection (a shortfall is reported, not clamped). */
export const SignedGradeAmounts = z.object({
  LSMGO: z.number(),
  VLSFO: z.number(),
  HSFO: z.number(),
});

export const FobProjection = z.object({
  legs: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      grade: FuelGrade,
      hours: NonNeg,
      fuelMt: NonNeg,
      robAfterMt: SignedGradeAmounts,
    }),
  ),
  requiredMt: GradeAmounts,
  safetyMarginMt: GradeAmounts,
  minRobMt: SignedGradeAmounts,
  shortfallMt: GradeAmounts,
  belowMarginAtLeg: z.object({
    LSMGO: z.number().int().nonnegative().nullable(),
    VLSFO: z.number().int().nonnegative().nullable(),
    HSFO: z.number().int().nonnegative().nullable(),
  }),
});
export type FobProjection = z.infer<typeof FobProjection>;

// ---------- Bunker planner ----------

export const BunkerOptionInput = z
  .object({
    optionId: z.string().min(1),
    quoteId: Id.nullable(),
    supplierId: Id,
    portId: Id,
    portIsEu: z.boolean(),
    currency: Currency,
    pricePerMt: Positive,
    /** In the quote currency. */
    bargeFee: NonNeg,
    offeredQtyMt: NonNeg,
    deviationNm: NonNeg,
    /** Grade burned on the deviation and during the stop. */
    deviationGrade: FuelGrade,
    deviationFuelPriceUsdPerMt: NonNeg,
    waitingHours: NonNeg,
    bunkeringHours: NonNeg,
    weatherDelayHours: NonNeg,
    /** Projected ROB of the purchased grade on arrival at this port. */
    robAtArrivalMt: z.number(),
    safetyMarginMt: NonNeg,
  })
  .strict();
export type BunkerOptionInput = z.infer<typeof BunkerOptionInput>;

export const BunkerPlanInput = z
  .object({
    grade: FuelGrade,
    requiredQtyMt: Positive,
    minQtyMt: NonNeg,
    tankFreeMt: NonNeg,
    speedKn: Positive,
    curve: ConsumptionCurve,
    dailyCostUsd: NonNeg,
    voyageEtsCoverage: EtsCoverageFactor,
    berthWindowSlackHours: z.number(),
    market: z
      .object({
        fxToUsd: z.object({ USD: z.literal(1), EUR: Positive }).strict(),
        euaPriceEur: NonNeg,
        year: z.number().int(),
      })
      .strict(),
    options: z
      .array(BunkerOptionInput)
      .refine((opts) => new Set(opts.map((o) => o.optionId)).size === opts.length, {
        message: "duplicate optionId in options",
      }),
  })
  .strict();
export type BunkerPlanInput = z.infer<typeof BunkerPlanInput>;

export const InfeasibleReason = z.enum([
  "insufficient_quantity",
  "exceeds_tank_capacity",
  "unreachable_with_margin",
  "misses_berth_window",
]);
export type InfeasibleReason = z.infer<typeof InfeasibleReason>;

export const BunkerOptionResult = z.object({
  optionId: z.string(),
  rank: z.number().int().positive(),
  feasible: z.boolean(),
  reasons: z.array(InfeasibleReason),
  qtyMt: NonNeg,
  headlinePriceUsdPerMt: NonNeg,
  fuelCostUsd: NonNeg,
  bargeFeeUsd: NonNeg,
  deviationFuelMt: NonNeg,
  portStayFuelMt: NonNeg,
  deviationCostUsd: NonNeg,
  delayHours: NonNeg,
  delayCostUsd: NonNeg,
  co2T: NonNeg,
  etsCostUsd: NonNeg,
  /** FuelEU Maritime penalty exposure of the extra burn (deviation and stay); inside totalCostUsd. */
  fuelEuCostUsd: NonNeg,
  totalCostUsd: NonNeg,
  effectivePriceUsdPerMt: NonNeg,
});
export type BunkerOptionResult = z.infer<typeof BunkerOptionResult>;

export const BunkerPlan = z.object({
  options: z.array(BunkerOptionResult),
  bestOptionId: z.string().nullable(),
  cheapestHeadlineOptionId: z.string().nullable(),
  savingVsCheapestHeadlineUsd: z.number().nullable(),
});
export type BunkerPlan = z.infer<typeof BunkerPlan>;

// ---------- Emissions ----------

export const EtsCostInput = z
  .object({
    co2T: NonNeg,
    coverage: z.number().min(0).max(1),
    year: z.number().int(),
    euaPriceEur: NonNeg,
    eurUsd: Positive,
  })
  .strict();
export type EtsCostInput = z.infer<typeof EtsCostInput>;

export const EtsCostResult = z.object({
  coveredCo2T: NonNeg,
  phaseIn: z.number().min(0).max(1),
  costEur: NonNeg,
  costUsd: NonNeg,
});
export type EtsCostResult = z.infer<typeof EtsCostResult>;

/**
 * FuelEU Maritime exposure of a quantity of fuel: the penalty it would attract at the year's GHG
 * intensity limit if nothing offsets it (no pooling, banking or borrowing). `coverage` is the
 * share of the energy in scope (same split as the EU ETS: 1 / 0.5 / 0).
 */
export const FuelEuCostInput = z
  .object({
    fuelMt: GradeAmounts,
    coverage: EtsCoverageFactor,
    year: z.number().int(),
    eurUsd: Positive,
  })
  .strict();
export type FuelEuCostInput = z.infer<typeof FuelEuCostInput>;

export const FuelEuCostResult = z
  .object({
    /** Energy in scope, MJ. */
    energyMj: NonNeg,
    /** Energy-weighted well-to-wake GHG intensity, g CO₂eq/MJ (0 when no energy is in scope). */
    intensityGPerMj: NonNeg,
    /** The year's limit, g CO₂eq/MJ; null before FuelEU applies (2025). */
    targetGPerMj: Positive.nullable(),
    /** (target − intensity) × energy, tonnes CO₂eq; negative is a deficit. */
    complianceBalanceT: z.number(),
    penaltyEur: NonNeg,
    penaltyUsd: NonNeg,
  })
  .strict();
export type FuelEuCostResult = z.infer<typeof FuelEuCostResult>;

export const CiiRatingLetter = z.enum(["A", "B", "C", "D", "E"]);
export type CiiRatingLetter = z.infer<typeof CiiRatingLetter>;

export const CiiInput = z
  .object({
    shipType: ShipType,
    /** Zero is rejected by the calculator with a RangeError. */
    dwt: NonNeg,
    co2T: NonNeg,
    distanceNm: NonNeg,
    year: z.number().int(),
  })
  .strict();
export type CiiInput = z.infer<typeof CiiInput>;

export const CiiResult = z.object({
  /** g CO₂ per dwt·nm */
  attained: NonNeg,
  reference: Positive,
  required: Positive,
  ratio: NonNeg,
  rating: CiiRatingLetter,
});
export type CiiResult = z.infer<typeof CiiResult>;
