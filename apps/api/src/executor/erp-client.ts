/**
 * The API's ERP adapter: pushes an approved purchase order to the ERP (the simulator in this
 * prototype) with an idempotency key, so a retry never creates a second order.
 */
import { ERP_IDEMPOTENCY_HEADER, ErpOrderRequest, ErpOrderResponse } from "@pharos/shared";

/** A `fetch` (or an in-process Hono `app.request`, in tests). */
export type ErpFetch = (input: string, init: RequestInit) => Promise<Response> | Response;

export interface ErpClient {
  placeOrder(req: ErpOrderRequest, idempotencyKey: string): Promise<ErpOrderResponse>;
}

/** The ERP could not be reached, timed out, or answered 5xx. Safe to retry with the same key. */
export class ErpUnavailableError extends Error {
  override name = "ErpUnavailableError";
}

/** The ERP answered, but refused the order (4xx) or sent something that is not a confirmation. */
export class ErpResponseError extends Error {
  override name = "ErpResponseError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** How long one order push may take before the ERP counts as unavailable. */
export const ERP_TIMEOUT_MS = 5_000;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createErpClient(baseUrl: string, fetchImpl: ErpFetch = fetch): ErpClient {
  const ordersUrl = new URL("orders", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

  return {
    async placeOrder(req, idempotencyKey) {
      const body = ErpOrderRequest.parse(req);
      if (idempotencyKey.trim() === "") throw new Error("placeOrder needs an idempotency key");

      let res: Response;
      try {
        res = await fetchImpl(ordersUrl, {
          method: "POST",
          headers: { "content-type": "application/json", [ERP_IDEMPOTENCY_HEADER]: idempotencyKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
        });
      } catch (err) {
        throw new ErpUnavailableError(`ERP unreachable: ${reason(err)}`, { cause: err });
      }
      if (res.status >= 500) throw new ErpUnavailableError(`ERP answered ${res.status}`);

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new ErpResponseError(res.status, `ERP answered ${res.status} without JSON`);
      }
      if (!res.ok) {
        const code = (payload as { error?: unknown } | null)?.error;
        throw new ErpResponseError(
          res.status,
          `ERP refused the order (${res.status}${typeof code === "string" ? ` ${code}` : ""})`,
        );
      }
      const parsed = ErpOrderResponse.safeParse(payload);
      if (!parsed.success) {
        throw new ErpResponseError(res.status, `ERP answered ${res.status} with no valid order`);
      }
      return parsed.data;
    },
  };
}
