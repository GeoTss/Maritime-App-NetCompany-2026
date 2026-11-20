// @vitest-environment node
/**
 * The Content-Security-Policy meta is a build-time concern: in `vite dev`, @vitejs/plugin-react
 * injects an inline Fast Refresh preamble that `script-src 'self'` would refuse, so the dev page
 * must not carry the policy, and the built page must carry exactly the approved one.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../../vite.config";

const root = fileURLToPath(new URL("../..", import.meta.url));
const configFile = join(root, "vite.config.ts");
const outDir = mkdtempSync(join(tmpdir(), "pharos-web-build-"));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const CSP_META = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/gi;

/** The attribute value as a browser reads it (Vite escapes quotes as entities). */
const decode = (s: string) =>
  s.replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

describe("content security policy", () => {
  it("is the approved offline policy", () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'",
    );
  });

  it("the built index.html carries the policy exactly once", async () => {
    await build({ root, configFile, logLevel: "silent", build: { outDir, sourcemap: false } });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    const metas = html.match(CSP_META) ?? [];
    expect(metas).toHaveLength(1);
    expect(decode(metas[0] ?? "")).toContain(`content="${CONTENT_SECURITY_POLICY}"`);
    // No inline script in the built page: the policy would refuse it.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  }, 120_000);

  it("the dev server serves the page without the policy, so the React preamble runs", async () => {
    const server = await createServer({
      root,
      configFile,
      logLevel: "silent",
      server: { port: 0, strictPort: false },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("dev server has no port");
      const res = await fetch(`http://localhost:${address.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<div id="root">');
      expect(html).not.toMatch(CSP_META);
      expect(html).toContain("/@react-refresh");
    } finally {
      await server.close();
    }
  }, 60_000);
});
