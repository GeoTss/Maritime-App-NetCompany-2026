import { Hono } from "hono";

/**
 * A stand-in for a company ERP: supplier master data in, purchase orders out.
 * Phase 0 exposes health only; order endpoints arrive in Phase 4.
 */
export function createErpApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok", service: "erp-sim" }));
  return app;
}
