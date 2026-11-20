import { serve } from "@hono/node-server";
import { createErpApp } from "./app.js";

const port = Number(process.env.ERP_PORT ?? 4100);
const server = serve({ fetch: createErpApp().fetch, port }, (info) => {
  console.log(`[erp-sim] listening on :${info.port}`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
