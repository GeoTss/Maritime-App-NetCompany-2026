import { describe, expect, it } from "vitest";
import { createErpApp } from "./app.js";

describe("ERP simulator", () => {
  it("answers health checks", async () => {
    const res = await createErpApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "erp-sim" });
  });
});
