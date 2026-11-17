import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createClock } from "../clock.js";
import { createFixtureSource, FIXTURE_ANCHOR } from "../read/fixtures.js";

const app = createApp({
  llmMode: "replay",
  clock: createClock(FIXTURE_ANCHOR),
  pingDb: async () => true,
  read: createFixtureSource(),
});

async function page() {
  const res = await app.request("/");
  return { res, html: await res.text() };
}

/** Every inline <script> body in the page. */
const scripts = (html: string) =>
  [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? "");

describe("GET /", () => {
  it('returns 200 HTML containing "Deliver next email"', async () => {
    const { res, html } = await page();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8/i);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("Deliver next email");
  });

  it("loads nothing external: no src/href to another origin, no <link>, no external script", async () => {
    const { html } = await page();
    expect(html).not.toMatch(/\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    expect(html).not.toMatch(/@import/i);
  });

  it("sends a CSP that only allows the page's own inline code and same-origin requests", async () => {
    const { res } = await page();
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never renders strings as HTML", async () => {
    const { html } = await page();
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });

  it("has one inline script that parses as JavaScript", async () => {
    const { html } = await page();
    const bodies = scripts(html);
    expect(bodies).toHaveLength(1);
    // Compiles without running.
    expect(() => new Function(bodies[0] ?? "")).not.toThrow();
  });

  it("drives the API the demo story uses", async () => {
    const { html } = await page();
    for (const path of [
      "/api/inbox/deliver-next",
      "/api/inbox",
      "/api/quotes",
      "/api/ask/stream",
      "/api/recommendations",
      "/approve",
      "/reject",
      "/api/llm-calls",
    ]) {
      expect(html).toContain(path);
    }
  });

  it("posts decisions as JSON (the routes refuse anything else)", async () => {
    const { html } = await page();
    const decide = html.match(/async function decide\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(decide).toContain("postJson(");
    expect(decide).not.toMatch(/\bapi\(/);
  });

  it("has a Review queue section that decides through the review API, as JSON", async () => {
    const { html } = await page();
    expect(html).toContain("Review queue");
    for (const path of ["/api/review", "/api/review/reference", "accept", "reject", "retry"]) {
      expect(html).toContain(path);
    }
    const decide = html.match(/async function decideReview\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(decide).toContain("postJson(");
    expect(decide).not.toMatch(/\bapi\(/);
  });

  it("renders gate origin and order state from the recommendation, so they survive a reload", async () => {
    const { html } = await page();
    expect(html).toContain("rec.gatePassed");
    expect(html).toContain("rec.order");
    expect(html).not.toContain("gateByRecommendation");
  });
});
