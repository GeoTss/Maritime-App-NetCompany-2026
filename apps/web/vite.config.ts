import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** The console talks to the API through this proxy only: same origin, no CORS. */
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";
const proxy = { "/api": { target: apiTarget, changeOrigin: false } };

/** Offline by policy: nothing loads from, or connects to, another origin. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Adds the CSP `<meta>` to the built page only. In `vite dev`, @vitejs/plugin-react injects an
 * inline Fast Refresh preamble that `script-src 'self'` would refuse, so the dev page stays bare.
 */
export function contentSecurityPolicy(): Plugin {
  return {
    name: "pharos-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 5173, strictPort: true, proxy },
  build: { sourcemap: true },
});
