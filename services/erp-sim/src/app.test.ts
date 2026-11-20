import { ERP_IDEMPOTENCY_HEADER, ErpOrderResponse } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { createErpApp } from "./app.js";

const order = {
  supplierErpCode: "SUP-001",
  vesselImo: "9400001",
  port: "SGSIN",
  currency: "USD",
  lines: [{ grade: "VLSFO", qtyMt: 500, pricePerMt: 612.5 }],
  bargeFee: 1500,
  reference: "rec-12",
};

const FIXED = new Date("2026-11-14T08:00:00.000Z");

function post(app: ReturnType<typeof createErpApp>, body: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== undefined) headers[ERP_IDEMPOTENCY_HEADER] = key;
  return app.request("/orders", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("ERP simulator", () => {
  it("answers health checks", async () => {
    const res = await createErpApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "erp-sim" });
  });

  describe("orders", () => {
    const fresh = () => createErpApp({ now: () => FIXED });

    it("creates an order: 201, sequential PO number, clock-injected createdAt", async () => {
      const app = fresh();
      const res = await post(app, order, "rec-12");
      expect(res.status).toBe(201);
      const body = ErpOrderResponse.parse(await res.json());
      expect(body).toEqual({
        poNumber: "PO-000001",
        status: "confirmed",
        createdAt: "2026-11-14T08:00:00.000Z",
        duplicate: false,
      });
      const second = ErpOrderResponse.parse(
        await (await post(app, { ...order, reference: "rec-13" }, "rec-13")).json(),
      );
      expect(second.poNumber).toBe("PO-000002");
    });

    it("rejects a missing idempotency key with 400, before body validation", async () => {
      const res = await post(fresh(), { nonsense: true });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "idempotency_key_required" });
    });

    it("rejects an invalid body with 400 invalid_order and issues", async () => {
      const res = await post(fresh(), { ...order, extra: 1 }, "k1");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: unknown[] };
      expect(body.error).toBe("invalid_order");
      expect(body.issues.length).toBeGreaterThan(0);
      expect((await post(fresh(), "{not json", "k2")).status).toBe(400);
    });

    it("replays the same key and body as 200 duplicate with the same PO number", async () => {
      const app = fresh();
      await post(app, order, "rec-12");
      const res = await post(app, order, "rec-12");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ poNumber: "PO-000001", duplicate: true });
      // A duplicate does not consume a sequence number.
      const next = await (await post(app, order, "rec-99")).json();
      expect(next).toMatchObject({ poNumber: "PO-000002" });
    });

    it("treats key order in the body as irrelevant", async () => {
      const app = fresh();
      await post(app, order, "rec-12");
      const reordered = JSON.stringify({
        reference: order.reference,
        bargeFee: order.bargeFee,
        lines: [{ pricePerMt: 612.5, qtyMt: 500, grade: "VLSFO" }],
        currency: order.currency,
        port: order.port,
        vesselImo: order.vesselImo,
        supplierErpCode: order.supplierErpCode,
      });
      const res = await post(app, reordered, "rec-12");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ duplicate: true });
    });

    it("returns 409 when the key is reused with a different body", async () => {
      const app = fresh();
      await post(app, order, "rec-12");
      const res = await post(app, { ...order, bargeFee: 1 }, "rec-12");
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "idempotency_conflict" });
    });

    it("serves a stored order by PO number, and 404 for unknown", async () => {
      const app = fresh();
      await post(app, order, "rec-12");
      const res = await app.request("/orders/PO-000001");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        poNumber: "PO-000001",
        status: "confirmed",
        createdAt: "2026-11-14T08:00:00.000Z",
        order,
      });
      expect((await app.request("/orders/PO-000042")).status).toBe(404);
    });

    it("keeps separate sequences per app instance", async () => {
      const a = fresh();
      const b = fresh();
      await post(a, order, "x");
      const res = await post(b, order, "x");
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ poNumber: "PO-000001" });
    });
  });
});
