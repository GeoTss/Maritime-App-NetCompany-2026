import { ERP_IDEMPOTENCY_HEADER, ErpOrderRequest, type ErpOrderResponse } from "@pharos/shared";
import { Hono } from "hono";

export interface ErpAppOptions {
  /** Injected clock; `createdAt` comes from it. */
  now?: () => Date;
}

interface StoredOrder {
  poNumber: string;
  status: "confirmed";
  createdAt: string;
  order: ErpOrderRequest;
  canonical: string;
}

/** Deterministic JSON with object keys sorted, so key order never matters. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A stand-in for a company ERP: purchase-order intake with idempotency.
 * State is in memory and per app instance.
 */
export function createErpApp(options: ErpAppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const byKey = new Map<string, StoredOrder>();
  const byPo = new Map<string, StoredOrder>();
  let sequence = 0;

  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok", service: "erp-sim" }));

  app.post("/orders", async (c) => {
    const key = c.req.header(ERP_IDEMPOTENCY_HEADER);
    if (!key) return c.json({ error: "idempotency_key_required" }, 400);

    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = ErpOrderRequest.safeParse(raw);
    if (!parsed.success)
      return c.json({ error: "invalid_order", issues: parsed.error.issues }, 400);
    const canonical = canonicalJson(parsed.data);

    const existing = byKey.get(key);
    if (existing) {
      if (existing.canonical !== canonical) return c.json({ error: "idempotency_conflict" }, 409);
      const replay: ErpOrderResponse = {
        poNumber: existing.poNumber,
        status: existing.status,
        createdAt: existing.createdAt,
        duplicate: true,
      };
      return c.json(replay, 200);
    }

    sequence += 1;
    const stored: StoredOrder = {
      poNumber: `PO-${String(sequence).padStart(6, "0")}`,
      status: "confirmed",
      createdAt: now().toISOString(),
      order: parsed.data,
      canonical,
    };
    byKey.set(key, stored);
    byPo.set(stored.poNumber, stored);
    const created: ErpOrderResponse = {
      poNumber: stored.poNumber,
      status: stored.status,
      createdAt: stored.createdAt,
      duplicate: false,
    };
    return c.json(created, 201);
  });

  app.get("/orders/:poNumber", (c) => {
    const stored = byPo.get(c.req.param("poNumber"));
    if (!stored) return c.json({ error: "not_found" }, 404);
    const { canonical: _canonical, ...order } = stored;
    return c.json(order, 200);
  });

  return app;
}
