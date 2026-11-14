/**
 * Contract between the API's ERP adapter and the ERP simulator (and any real ERP behind the
 * same adapter). Every POST carries an `Idempotency-Key` header; a repeat returns the same order.
 */
import { z } from "zod";
import { Currency, FuelGrade, IsoDateTime } from "../primitives.js";

export const ERP_IDEMPOTENCY_HEADER = "Idempotency-Key";

export const ErpOrderRequest = z
  .object({
    supplierErpCode: z.string().min(1),
    vesselImo: z.string().regex(/^\d{7}$/),
    /** UN/LOCODE of the delivery port. */
    port: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
    currency: Currency,
    lines: z
      .array(
        z
          .object({
            grade: FuelGrade,
            qtyMt: z.number().positive(),
            pricePerMt: z.number().positive(),
          })
          .strict(),
      )
      .min(1),
    bargeFee: z.number().nonnegative(),
    /** Our reference, e.g. "rec-12". */
    reference: z.string().min(1),
  })
  .strict();
export type ErpOrderRequest = z.infer<typeof ErpOrderRequest>;

export const ErpOrderResponse = z.object({
  poNumber: z.string().regex(/^PO-\d{6}$/),
  status: z.literal("confirmed"),
  createdAt: IsoDateTime,
  duplicate: z.boolean(),
});
export type ErpOrderResponse = z.infer<typeof ErpOrderResponse>;
