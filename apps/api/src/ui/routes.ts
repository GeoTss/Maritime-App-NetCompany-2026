/**
 * `GET /`: the bare Phase 2 page (one static HTML file, inline CSS and JS, no build step and no
 * external assets). It walks the loop: deliver an email, see the quote, ask, approve, get the PO.
 */
import { readFile } from "node:fs/promises";
import { Hono } from "hono";

/** The page, resolved from this module's location (not the process cwd). */
export const PAGE_FILE = new URL("./index.html", import.meta.url);

/** Only the page's own inline code and same-origin API calls; nothing else loads. */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function createUiRoutes() {
  const app = new Hono();
  app.get("/", async (c) => {
    // Read per request: a small file, and edits show without a restart.
    const html = await readFile(PAGE_FILE, "utf8");
    c.header("content-security-policy", CSP);
    c.header("x-content-type-options", "nosniff");
    c.header("cache-control", "no-store");
    return c.html(html);
  });
  return app;
}
