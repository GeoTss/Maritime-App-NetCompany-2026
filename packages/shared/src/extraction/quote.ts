/**
 * What the extraction model returns for one document. Values are transcribed AS WRITTEN —
 * value + unit + currency exactly as the supplier wrote them — with the verbatim sentence each came
 * from. Unit and currency normalisation, conversion and totals happen in code afterwards.
 * Missing information is `null`, never omitted (structured-output friendly); objects are strict.
 */
import { z } from "zod";

const Evidence = z.string().min(1).nullable();

export const TextField = z.object({ value: z.string().nullable(), evidence: Evidence }).strict();
export type TextField = z.infer<typeof TextField>;

export const QuantityField = z
  .object({
    value: z.number().nullable(),
    /** As written: "mt", "MT", "tonnes", "m3". */
    unit: z.string().nullable(),
    /** The literal span, e.g. "300/350 mt" when the quantity is ambiguous and value is null. */
    asWritten: z.string().nullable(),
    evidence: Evidence,
  })
  .strict();
export type QuantityField = z.infer<typeof QuantityField>;

export const MoneyField = z
  .object({
    value: z.number().nullable(),
    /** As written: "USD", "US$", "$", "EUR", "€". */
    currency: z.string().nullable(),
    /** As written: "mt", "pmt", "lump sum". */
    perUnit: z.string().nullable(),
    asWritten: z.string().nullable(),
    evidence: Evidence,
  })
  .strict();
export type MoneyField = z.infer<typeof MoneyField>;

export const DateField = z
  .object({ asWritten: z.string().nullable(), evidence: Evidence })
  .strict();
export type DateField = z.infer<typeof DateField>;

export const QuoteLineExtraction = z
  .object({ grade: TextField, quantity: QuantityField, price: MoneyField })
  .strict();
export type QuoteLineExtraction = z.infer<typeof QuoteLineExtraction>;

export const QuoteExtraction = z
  .object({
    kind: z.literal("quote"),
    supplierName: TextField,
    vesselName: TextField,
    vesselImo: TextField,
    port: TextField,
    deliveryFrom: DateField,
    deliveryTo: DateField,
    validUntil: DateField,
    bargeFee: MoneyField,
    lines: z.array(QuoteLineExtraction).min(1),
    notes: z.string().nullable(),
  })
  .strict();
export type QuoteExtraction = z.infer<typeof QuoteExtraction>;

export const NotAQuote = z
  .object({ kind: z.literal("not_a_quote"), reason: z.string().min(1), evidence: Evidence })
  .strict();
export type NotAQuote = z.infer<typeof NotAQuote>;

/**
 * A security provider's offer of an armed team for a vessel's transit (Track 3). Transcribed as
 * written like a fuel quote: the team size and minimum days as quantities ("4 guards", "5 days"),
 * the day rate and fixed fees as money ("USD 1,250 per day", "USD 6,000 lump sum").
 */
export const SecurityQuoteExtraction = z
  .object({
    kind: z.literal("security_quote"),
    providerName: TextField,
    vesselName: TextField,
    vesselImo: TextField,
    embarkPort: TextField,
    disembarkPort: TextField,
    teamSize: QuantityField,
    dayRate: MoneyField,
    fixedFees: MoneyField,
    minDays: QuantityField,
    validUntil: DateField,
    notes: z.string().nullable(),
  })
  .strict();
export type SecurityQuoteExtraction = z.infer<typeof SecurityQuoteExtraction>;

export const ExtractionOutput = z.discriminatedUnion("kind", [
  QuoteExtraction,
  SecurityQuoteExtraction,
  NotAQuote,
]);
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;
