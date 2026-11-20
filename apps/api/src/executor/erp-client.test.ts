import { ERP_IDEMPOTENCY_HEADER, type ErpOrderRequest } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { createErpApp } from "../../../../services/erp-sim/src/app.js";
import {
  createErpClient,
  type ErpFetch,
  ErpResponseError,
  ErpUnavailableError,
} from "./erp-client.js";

const NOW = new Date("2026-11-14T08:10:00.000Z");

const order = (): ErpOrderRequest => ({
  supplierErpCode: "SUP-KES",
  vesselImo: "9480019",
  port: "MTMLA",
  currency: "USD",
  lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
  bargeFee: 2800,
  reference: "rec-1",
});

/** The ERP simulator in-process, with every request it received. */
function erpInProcess() {
  const app = createErpApp({ now: () => NOW });
  const requests: { url: string; key: string | null; body: unknown }[] = [];
  const fetchImpl: ErpFetch = async (input, init) => {
    const headers = new Headers(init.headers);
    requests.push({
      url: input,
      key: headers.get(ERP_IDEMPOTENCY_HEADER),
      body: JSON.parse(String(init.body)),
    });
    return app.request(input, init);
  };
  return { fetchImpl, requests };
}

describe("createErpClient against the ERP simulator", () => {
  it("places an order and returns the confirmed PO number", async () => {
    const erp = erpInProcess();
    const client = createErpClient("http://erp.test:4100", erp.fetchImpl);
    const res = await client.placeOrder(order(), "rec-1");
    expect(res).toEqual({
      poNumber: "PO-000001",
      status: "confirmed",
      createdAt: NOW.toISOString(),
      duplicate: false,
    });
    expect(erp.requests).toEqual([
      { url: "http://erp.test:4100/orders", key: "rec-1", body: order() },
    ]);
  });

  it("returns the same PO, marked duplicate, for the same key and body", async () => {
    const erp = erpInProcess();
    const client = createErpClient("http://erp.test:4100/", erp.fetchImpl);
    const first = await client.placeOrder(order(), "rec-1");
    const again = await client.placeOrder(order(), "rec-1");
    expect(again).toEqual({ ...first, duplicate: true });
    expect(erp.requests.map((r) => r.url)).toEqual([
      "http://erp.test:4100/orders",
      "http://erp.test:4100/orders",
    ]);
  });

  it("gives a different key a new PO number", async () => {
    const erp = erpInProcess();
    const client = createErpClient("http://erp.test:4100", erp.fetchImpl);
    await client.placeOrder(order(), "rec-1");
    const second = await client.placeOrder({ ...order(), reference: "rec-2" }, "rec-2");
    expect(second.poNumber).toBe("PO-000002");
    expect(second.duplicate).toBe(false);
  });

  it("throws ErpResponseError (409) when the same key carries a different body", async () => {
    const erp = erpInProcess();
    const client = createErpClient("http://erp.test:4100", erp.fetchImpl);
    await client.placeOrder(order(), "rec-1");
    const changed = { ...order(), bargeFee: 3000 };
    const err = await client.placeOrder(changed, "rec-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErpResponseError);
    expect((err as ErpResponseError).status).toBe(409);
    expect((err as ErpResponseError).message).toMatch(/idempotency_conflict/);
  });

  it("rejects an invalid order or an empty key before calling the ERP", async () => {
    const erp = erpInProcess();
    const client = createErpClient("http://erp.test:4100", erp.fetchImpl);
    await expect(client.placeOrder({ ...order(), vesselImo: "123" }, "rec-1")).rejects.toThrow();
    await expect(client.placeOrder(order(), "")).rejects.toThrow(/idempotency key/i);
    expect(erp.requests).toHaveLength(0);
  });
});

describe("createErpClient when the ERP is not usable", () => {
  it("throws ErpUnavailableError on a network error", async () => {
    const client = createErpClient("http://erp.test:4100", async () => {
      throw new TypeError("fetch failed");
    });
    const err = await client.placeOrder(order(), "rec-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErpUnavailableError);
    expect((err as Error).message).toMatch(/fetch failed/);
  });

  it("throws ErpUnavailableError on a 5xx", async () => {
    const client = createErpClient(
      "http://erp.test:4100",
      async () => new Response("upstream down", { status: 503 }),
    );
    const err = await client.placeOrder(order(), "rec-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErpUnavailableError);
    expect((err as Error).message).toMatch(/503/);
  });

  it("throws ErpResponseError on a 2xx body that is not an order confirmation", async () => {
    const client = createErpClient("http://erp.test:4100", async () =>
      Response.json({ poNumber: "12" }, { status: 201 }),
    );
    const err = await client.placeOrder(order(), "rec-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErpResponseError);
    expect((err as ErpResponseError).status).toBe(201);
  });
});
