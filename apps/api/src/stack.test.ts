/**
 * The API as `server.ts` wires it (`bootWorld` + `createStackApp`), on fresh test databases: with
 * DEMO_ANCHOR pinned, two stacks answer the same requests with the same bytes and send the model
 * the same requests (so recorded replies replay); unpinned, the stack keeps the wall clock.
 * The model is a scripted transport in record mode: nothing reaches the network.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { loadRecordedSources } from "@pharos/integrations";
import {
  AskResponse,
  AuditEventList,
  DecisionResult,
  HazardZoneList,
  listOf,
  PortList,
  RoutePlanResponse,
  SimClockView,
  VesselSummary,
} from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createErpApp } from "../../../services/erp-sim/src/app.js";
import { captureLlmCall } from "./ai/call-capture.js";
import { createLlm } from "./ai/llm.js";
import { type ScriptStep, scriptedFetch, textReply, toolCall } from "./ai/scripted-llm.js";
import { createToolContext } from "./ai/tools/common.js";
import { planBunkering } from "./ai/tools/plan-bunkering.js";
import { proposeAction } from "./ai/tools/propose-action.js";
import { DEMO_QUESTION, insertDemoQuotes } from "./ask/demo-fixture.js";
import { createClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { createErpClient } from "./executor/erp-client.js";
import { bootWorld, createStackApp } from "./stack.js";

const DEMO_ANCHOR = "2026-11-14T08:00:00Z";
const PINNED_NOW = "2026-11-14T08:05:00.000Z";

const dbA = await connectTestDb("stack_pinned_a");
const dbB = await connectTestDb("stack_pinned_b");
const dbWall = await connectTestDb("stack_unpinned");
const reachable = dbA !== null && dbB !== null && dbWall !== null;

if (!reachable) {
  describe("the API stack (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("stack_pinned_a")}`, () => {});
  });
}

/**
 * The demo ask, scripted: two tools whose results read the request clock (the next port call
 * after "now"; the hazard zones active at "now"), then an answer.
 */
const ASK_SCRIPT: ScriptStep[] = [
  toolCall(1, "get_vessel_status", { vessel: "Aegean Pioneer" }),
  toolCall(2, "plan_route_speed", { vessel: "Aegean Pioneer" }),
  textReply(3, "The vessel status and route plan are in the facts."),
  textReply(4, "The vessel status and route plan are in the facts."),
  textReply(5, "The vessel status and route plan are in the facts."),
];

/** How far the wall clock is moved for the second stack: a replay on another day. */
const LATER_MS = 30 * 24 * 3_600_000;

describe.skipIf(!reachable)("the API stack (Postgres)", () => {
  if (!dbA || !dbB || !dbWall) return;
  let recordingsDir: string;

  beforeAll(async () => {
    recordingsDir = await mkdtemp(join(tmpdir(), "pharos-stack-"));
  });
  afterAll(async () => {
    await rm(recordingsDir, { recursive: true, force: true });
    await Promise.all([dbA.end(), dbB.end(), dbWall.end()]);
  });

  /** Boots a stack the way server.ts does; the worker's part (recorded sources) is done here. */
  async function boot(sql: Sql, env: Record<string, string>) {
    const config = loadConfig({
      DATABASE_URL: "postgres://unused-by-the-test",
      LLM_MODE: "record",
      ANTHROPIC_API_KEY: "test-key",
      SEED_ON_BOOT: "reset",
      RECORDINGS_DIR: recordingsDir,
      LLM_FALLBACKS: "off",
      ...env,
    });
    const clock = createClock(config.demoAnchor);
    const world = await bootWorld(sql, config, clock);
    if (!world) throw new Error("the stack did not seed");
    await loadRecordedSources(sql, { anchor: world.anchor });
    // An AIS distress beacon seen at the anchor: active for 24 h by the request clock. The recorded
    // capture has only the synthetic hazard, which never ages out.
    await sql`
      insert into nav_hazards (id, kind, source, mmsi, lat, lon, label, radius_nm, observed_at)
      values ('ais:stack-test-beacon', 'distress_beacon', 'ais', '974000001', 36.0, 15.0,
              'Test distress beacon', null, ${world.anchor.toISOString()}::timestamptz)
      on conflict (id) do nothing`;
    const scripted = scriptedFetch(ASK_SCRIPT);
    const requestKeys: string[] = [];
    const llm = createLlm({
      mode: config.llmMode,
      apiKey: config.anthropicApiKey,
      recordingsDir: config.recordingsDir,
      fetch: scripted.fetch,
      onCall: (m) => {
        requestKeys.push(m.requestKey);
        captureLlmCall(m);
      },
    });
    const erpApp = createErpApp({ now: clock.now });
    const erp = createErpClient("http://erp.test", (input, init) => erpApp.request(input, init));
    const processing: Promise<void>[] = [];
    const { app } = createStackApp({
      config,
      sql,
      llm,
      clock,
      erp,
      log: () => {},
      track: (p) => processing.push(p),
    });
    return { app, clock, world, requestKeys, processing };
  }

  const postJson = (
    app: { request: (p: string, i: RequestInit) => Response | Promise<Response> },
    path: string,
    body: unknown,
  ) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  /** The bytes a console sees for the same requests, in the same order. */
  async function observe(stack: Awaited<ReturnType<typeof boot>>) {
    const { app } = stack;
    const vessels = await (await app.request("/api/vessels")).text();
    const clock = await (await app.request("/api/clock")).text();
    const ports = await (await app.request("/api/ports")).text();
    // AIS hazards age out by the request clock.
    const hazards = await (await app.request("/api/hazards")).text();
    const planRes = await postJson(app, "/api/route-plan", { vessel: "Aegean Pioneer" });
    expect(planRes.status).toBe(200);
    const plan = RoutePlanResponse.parse(await planRes.json());
    const askRes = await postJson(app, "/api/ask", { question: DEMO_QUESTION });
    const askText = await askRes.text();
    expect(askRes.status, askText).toBe(200);
    return {
      vessels,
      clock,
      ports,
      hazards,
      routePlanFacts: JSON.stringify(plan.facts),
      ask: AskResponse.parse(JSON.parse(askText)),
      requestKeys: [...stack.requestKeys],
    };
  }

  it("a pinned stack answers the same request with the same bytes twice", async () => {
    const a = await observe(await boot(dbA, { DEMO_ANCHOR }));
    // The second stack runs a month later by the wall clock (only Date is faked, so the database
    // driver's timers are untouched): pinned, nothing it serves or sends may notice.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + LATER_MS });
    let b: Awaited<ReturnType<typeof observe>>;
    try {
      b = await observe(await boot(dbB, { DEMO_ANCHOR }));
    } finally {
      vi.useRealTimers();
    }

    expect(SimClockView.parse(JSON.parse(a.clock))).toEqual({
      anchor: "2026-11-14T08:00:00.000Z",
      now: PINNED_NOW,
      pinned: true,
    });
    listOf(VesselSummary).parse(JSON.parse(a.vessels));
    PortList.parse(JSON.parse(a.ports));

    expect(b.vessels).toBe(a.vessels);
    expect(b.clock).toBe(a.clock);
    expect(b.ports).toBe(a.ports);
    expect(HazardZoneList.parse(JSON.parse(a.hazards)).items.map((h) => h.id)).toContain(
      "ais:stack-test-beacon",
    );
    expect(b.hazards).toBe(a.hazards);
    expect(b.routePlanFacts).toBe(a.routePlanFacts);
    // The demo ask's model calls: the first (question, prompt, tools) and the later ones, which
    // carry the clock-reading tool results, have the same replay keys.
    expect(a.requestKeys.length).toBeGreaterThanOrEqual(3);
    expect(b.requestKeys).toEqual(a.requestKeys);
    expect(b.ask.answer).toBe(a.ask.answer);
  });

  it("a pinned stack stamps request-path rows with the pinned now", async () => {
    // dbA as the previous test left it: one conversation, its model calls, two calculations.
    const conv = await dbA<{ at: string }[]>`
      select created_at as at from conversations union all
      select created_at from messages union all
      select created_at from llm_calls union all
      select created_at from calculations`;
    expect(conv.length).toBeGreaterThan(0);
    for (const r of conv) expect(new Date(r.at).toISOString()).toBe(PINNED_NOW);
  });

  it("a pinned stack's approvals and audit trail read the pinned clock", async () => {
    const stack = await boot(dbA, { DEMO_ANCHOR });
    await insertDemoQuotes(dbA);
    const ctx = createToolContext({ sql: dbA, now: stack.clock.now });
    const planned = await planBunkering(ctx, { vessel: "Aegean Pioneer" });
    const best = planned.facts.find((f) => f.id.endsWith("_bestOptionId"));
    const proposed = await proposeAction(ctx, {
      type: "purchase_order",
      calculationId: (planned.data as { calculationId: number }).calculationId,
      optionId: "MTMLA-kestrel",
      factRefs: [best?.id ?? ""],
      rationale: "Lowest total delivered cost.",
    });
    const recId = (proposed.data as { recommendationId: number }).recommendationId;

    const decided = await postJson(stack.app, `/api/recommendations/${recId}/approve`, {});
    expect(decided.status).toBe(200);
    DecisionResult.parse(await decided.json());

    const res = await stack.app.request(`/api/audit?recommendationId=${recId}`);
    expect(res.status).toBe(200);
    const { items } = AuditEventList.parse(await res.json());
    expect(items.map((e) => e.kind)).toContain("recommendation.approved");
    for (const e of items) {
      expect(e.recommendationId).toBe(recId);
      expect(e.at).toBe(PINNED_NOW);
    }
    const all = AuditEventList.parse(await (await stack.app.request("/api/audit")).json());
    expect(all.items.map((e) => e.id)).toEqual(expect.arrayContaining(items.map((e) => e.id)));
    const none = AuditEventList.parse(
      await (await stack.app.request(`/api/audit?recommendationId=${recId + 1000}`)).json(),
    );
    expect(none.items).toEqual([]);
  });

  it("a pinned stack's inbox delivery and extraction rows read the pinned clock", async () => {
    const stack = await boot(dbA, { DEMO_ANCHOR });
    const res = await postJson(stack.app, "/api/inbox/deliver-next", {});
    expect(res.status).toBe(202);
    await Promise.all(stack.processing);
    // The scripted model answers this extraction with a tool call, so it fails; its rows are what
    // matter here: written and claimed at the pinned now, and the model call recorded then too.
    const rows = await dbA<{ at: string | null }[]>`
      select created_at as at from extractions union all
      select claimed_at from extractions union all
      select created_at from llm_calls where purpose = 'extract'`;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r.at && new Date(r.at).toISOString()).toBe(PINNED_NOW);
  });

  it("unpinned keeps the wall clock", async () => {
    const before = Date.now();
    const stack = await boot(dbWall, {});
    const first = SimClockView.parse(await (await stack.app.request("/api/clock")).json());
    const after = Date.now();
    expect(first.pinned).toBe(false);
    // The world is anchored to boot time and the request clock is the wall clock.
    expect(Date.parse(first.anchor)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(first.anchor)).toBeLessThanOrEqual(after);
    expect(Date.parse(first.now)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(first.now)).toBeLessThanOrEqual(after);
    await new Promise((r) => setTimeout(r, 5));
    const second = SimClockView.parse(await (await stack.app.request("/api/clock")).json());
    expect(Date.parse(second.now)).toBeGreaterThan(Date.parse(first.now));
    expect(second.anchor).toBe(first.anchor);
  });

  it("a pinned stack refuses to serve a stored world anchored elsewhere, naming DEMO_ANCHOR", async () => {
    // dbWall holds a world anchored at the wall-clock boot above; if-empty would keep it.
    await expect(boot(dbWall, { DEMO_ANCHOR, SEED_ON_BOOT: "if-empty" })).rejects.toThrow(
      /DEMO_ANCHOR/,
    );
  });
});
