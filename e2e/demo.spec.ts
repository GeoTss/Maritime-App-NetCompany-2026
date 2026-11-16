/**
 * The Pharos demo story: the six steps of docs/MASTER_PLAN.md §1 through the real console.
 *
 * Determinism rule: with the pinned clock, the same requests in the same order give the same
 * replay keys. Do the same actions in the same order on every run: no optional branches, no
 * extra POSTs, route plans only where the story says. Never assert an ERP key byte-for-byte.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// STORY_MODE: recorded (default, replayed model, pinned clock), record (replay-first, a miss calls
// the model: paid) or live (live model, AIS and weather, wall clock: paid, needs `npm run demo:live`).
// STORY_STOP_AFTER=map returns after step 1 (a free dry-run of a live stack).
type Mode = "recorded" | "record" | "live";
const MODE = (process.env.STORY_MODE ?? "recorded") as Mode;
if (!["recorded", "record", "live"].includes(MODE)) {
  throw new Error(`STORY_MODE must be recorded, record or live (got "${MODE}")`);
}
const STOP_AFTER = process.env.STORY_STOP_AFTER ?? "";
const LIVE = MODE === "live";
const EXPECTED_LLM_MODE = { recorded: "replay", record: "record", live: "live" }[MODE];

// Screenshots go to test-results/ by default; STORY_SCREENSHOTS=docs refreshes the committed set.
const SHOTS =
  process.env.STORY_SCREENSHOTS === "docs"
    ? "docs/screenshots/phase-6"
    : LIVE
      ? "test-results/story-live"
      : "test-results/story";
const timings: { step: string; ms: number }[] = [];
const notes: Record<string, unknown> = {};

function writeTimings() {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/story-timings.json",
    JSON.stringify(
      { mode: MODE, stopAfter: STOP_AFTER || null, steps: timings, ...notes },
      null,
      2,
    ),
  );
}

const BUNKER_Q = "Where should Aegean Pioneer bunker, and who should we buy from?";
const ROUTE_Q = "What is the best route and speed for Aegean Pioneer to make its berth window?";
const INSTRUCT_Q =
  "Instruct the master of Aegean Pioneer to sail the recommended route at the recommended speed.";

async function shot(page: Page, n: number, name: string) {
  await page.screenshot({ path: `${SHOTS}/story-${n}-${name}.png`, fullPage: false });
}

async function nav(page: Page, path: string) {
  await page.locator(`nav a[href="${path}"]`).click();
}

async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ step, ms: Date.now() - t0 });
  }
}

/** Ask in the dock and wait for the released answer (gate line shown). */
async function ask(page: Page, question: string, label: string) {
  // The open route tray hides the rest of the page from the accessibility tree: use labels.
  const box = page.getByLabel("Ask the assistant");
  const turns = page.locator('section[aria-label="Question and answer"]');
  const before = await turns.count();
  await box.fill(question);
  await page.locator('form button[aria-label="Ask"]').click();
  await expect(turns).toHaveCount(before + 1);
  const turn = turns.last();
  // First progress: the turn's status label shows tools called or sources checked. Both timers
  // start at the click; the answer time is therefore the whole wait, not a delta.
  const t0 = Date.now();
  await expect(
    turn
      .getByRole("status")
      .filter({ hasText: /tools? called|Checked \d+ source/ })
      .first(),
  ).toBeVisible({ timeout: 120_000 });
  timings.push({ step: `${label}: first progress`, ms: Date.now() - t0 });
  await expect(turn.getByTestId("gate-line").or(turn.locator('[role="alert"]'))).toBeVisible({
    timeout: 120_000,
  });
  timings.push({ step: `${label}: answer`, ms: Date.now() - t0 });
  await expect(turn.locator('[role="alert"]')).toHaveCount(0);
  // A withheld answer shows a different gate line: only a fully sourced answer passes.
  await expect(turn.getByTestId("gate-line")).toHaveText(/all numbers sourced/);
  return turn;
}

// Always write the timings, pass or fail: a paid live run that fails at step 4 keeps what it timed.
test.afterEach(() => {
  writeTimings();
});

test("demo story: six steps", async ({ page }) => {
  // Live only: the public ship chosen by the preflight (and proven plannable) for step 4.
  let liveShip: { mmsi: string; name: string | null } | null = null;
  // The first action: the stack's model mode must match the story's, so a recorded story can
  // never spend money against a live-model stack (and a live story never replays).
  if (STOP_AFTER !== "map") {
    const health = (await (await page.request.get("http://localhost:4000/api/health")).json()) as {
      llmMode?: string;
    };
    expect(
      health.llmMode,
      `STORY_MODE=${MODE} needs llmMode "${EXPECTED_LLM_MODE}": ${
        LIVE ? "run npm run demo:live first" : "run npm run demo:reset first"
      }`,
    ).toBe(EXPECTED_LLM_MODE);
  }
  const offOrigin: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol.startsWith("http"))
      offOrigin.push(r.url());
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  mkdirSync(SHOTS, { recursive: true });

  // 1. Map ------------------------------------------------------------------------------------
  await timed("1 map", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Map", level: 1 })).toBeAttached();
    const traffic = page.locator('[data-layer="traffic"]');
    await expect(traffic).toContainText(/\d/);
    await expect(traffic).not.toContainText(/^Traffic\s*0$/);
    await expect(page.locator(`[data-source-mode="${LIVE ? "live" : "recorded"}"]`)).toHaveCount(2);
    await expect(page.locator(`[data-source-mode="${LIVE ? "recorded" : "live"}"]`)).toHaveCount(0);
    await expect(page.getByText("AIS", { exact: true })).toBeVisible();
    await expect(page.getByText("Weather", { exact: true }).first()).toBeVisible();
    if (LIVE) {
      await expect(page.locator('[data-pinned="false"]').first()).toBeAttached();
      await expect(page.locator('[data-pinned="true"]')).toHaveCount(0);
    } else {
      const clock = page.locator("time[datetime]").first();
      await expect(clock).toHaveText("08:05Z");
      await expect(page.getByText("pinned", { exact: true })).toBeVisible();
    }
    await expect(
      page.locator('[data-testid^="hazard-"] [data-kind="synthetic"]').first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Aegean Pioneer, has an alert" })).toBeVisible();
  });
  await shot(page, 1, "map");
  if (STOP_AFTER === "map") return;

  // Live only: a free preflight, so live conditions that are not product bugs fail early and
  // clearly, before any paid step. GETs, plus one route plan (never in recorded or record mode,
  // where a new POST would change the replay keys).
  if (LIVE) {
    const hazards = (await (await page.request.get("/api/hazards")).json()) as {
      items: { id: string }[];
    };
    const ids = hazards.items.map((h) => h.id);
    notes.otherHazardIds = ids.filter((id) => id !== "synthetic:1");
    expect(ids, "the synthetic demo hazard").toContain("synthetic:1");
    type Plan = {
      result: {
        options: { candidateId: string; feasible: boolean }[];
        baseline: { candidateId: string };
        bestCandidateId: string;
      };
    };
    const res = await page.request.post("/api/route-plan", {
      data: { vessel: "Aegean Pioneer" },
    });
    expect(res.ok(), `preflight route-plan status ${res.status()}`).toBe(true);
    const plan = (await res.json()) as Plan;
    const open = plan.result.options.filter(
      (o) => o.feasible && o.candidateId !== plan.result.baseline.candidateId,
    );
    expect(
      open.length,
      "live conditions block every route: report, not a product fix",
    ).toBeGreaterThan(0);
    notes.aegeanBestCandidate = plan.result.bestCandidateId;
    expect(
      plan.result.bestCandidateId,
      "live conditions make the baseline route A the best: report, not a product fix",
    ).not.toBe("A");
    notes.preflightFeasibleRoutes = open.map((o) => o.candidateId);

    // The public ship: the first named, non-fleet ship south of 45N whose route to Rotterdam the
    // graph can plan (a ship in a river or a sea the graph does not cover is skipped).
    const trafficLive = (await (await page.request.get("/api/traffic")).json()) as {
      items: { mmsi: string; name: string | null; lat: number }[];
    };
    const fleetLive = (await (await page.request.get("/api/vessels")).json()) as {
      items: { mmsi: string }[];
    };
    const fleetMmsi = new Set(fleetLive.items.map((v) => v.mmsi));
    const candidates = trafficLive.items
      .filter((t) => t.name?.trim() && !fleetMmsi.has(t.mmsi) && t.lat < 45)
      .slice(0, 5);
    const tried: string[] = [];
    for (const c of candidates) {
      const r = await page.request.post("/api/route-plan", {
        data: { vessel: c.mmsi, destination: "Rotterdam" },
      });
      tried.push(`${c.mmsi} ${r.status()}`);
      if (!r.ok()) continue;
      const pl = (await r.json()) as Plan;
      if (pl.result.options.length > 0) {
        liveShip = { mmsi: c.mmsi, name: c.name };
        break;
      }
    }
    notes.publicShipTried = tried;
    expect(
      liveShip,
      `no public ship could be planned to Rotterdam (tried ${tried.join(", ") || "none"}): report, not a product fix`,
    ).not.toBeNull();
    notes.publicShip = liveShip;
  }

  // 2. Inbox ----------------------------------------------------------------------------------
  await nav(page, "/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  const deliver = page.getByRole("button", { name: "Deliver next email" });
  const emails = page.getByRole("list", { name: "Emails" }).getByRole("listitem");
  await timed("2 inbox: deliver three and extract", async () => {
    for (let i = 1; i <= 3; i++) {
      await deliver.click();
      await expect(emails).toHaveCount(i);
    }
    await expect(emails.locator('[data-status="pending"]')).toHaveCount(0, { timeout: 120_000 });
  });
  if (!LIVE) {
    await expect(emails.locator('[data-status="needs_review"]')).toHaveCount(1);
    await expect(emails.locator('[data-status="extracted"]')).toHaveCount(2);
  }

  const openEmail = async (re: RegExp) => {
    await emails.filter({ hasText: re }).getByRole("button").click();
  };
  await openEmail(/Marsaxlokk/i);
  const quote = page.getByRole("list", { name: "Extracted quote" });
  await expect(quote).toBeVisible();
  await quote
    .getByRole("button", { name: /^Price/ })
    .first()
    .hover();
  await expect(page.getByTestId("evidence-mark")).toBeVisible();
  await openEmail(/Gibraltar/i);
  await expect(quote).toBeVisible();
  await quote
    .getByRole("button", { name: /^Price/ })
    .first()
    .hover();
  await expect(page.getByTestId("evidence-mark")).toBeVisible();

  await openEmail(/Algeciras/i);
  await expect(page.getByRole("region", { name: "Fix this quote" })).toBeVisible();
  if (LIVE) {
    // A live model may write the as-written span slightly differently: both quantities, not the text.
    await expect(
      emails.filter({ hasText: /Algeciras/i }).locator('[data-status="needs_review"]'),
    ).toHaveCount(1);
    await expect(page.getByTestId("written-qty-0")).toContainText("300");
    await expect(page.getByTestId("written-qty-0")).toContainText("350");
  } else {
    await expect(page.getByTestId("written-qty-0")).toContainText("300/350 mt");
  }
  await page.getByRole("spinbutton", { name: "Quantity in mt, line 1" }).fill("300");
  // The email's "EUR 690 / mt" has no per-mt unit the code accepts: the reviewer enters it.
  await page.getByRole("spinbutton", { name: "Price per mt, line 1" }).fill("690");
  await shot(page, 2, "inbox");
  await page.getByRole("button", { name: /^Accept/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save corrected quote" }).click();
  await expect(emails.locator('[data-status="accepted"]')).toHaveCount(1);

  // 3. Bunker question ------------------------------------------------------------------------
  await nav(page, "/");
  const turn1 = await ask(page, BUNKER_Q, "3 bunker");
  const chip = turn1.locator('[data-slot="fact-chip"]').first();
  await expect(chip).toBeVisible();
  await chip.click();
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(
    /Database record|Calculation|Supplier email|Derived from other facts|AIS position report|Weather snapshot/,
  );
  await expect(popover).toHaveCSS("opacity", "1");
  await shot(page, 3, "bunker-answer");
  await page.keyboard.press("Escape");
  await expect(
    turn1.getByRole("link", { name: /Proposal \d+ waiting for your decision/ }),
  ).toBeVisible();

  // 4. Route and speed ------------------------------------------------------------------------
  await ask(page, ROUTE_Q, "4 route ask");
  await page.getByRole("button", { name: "Aegean Pioneer, has an alert" }).click();
  await timed("4 plan route", async () => {
    await page.getByRole("button", { name: "Plan route", exact: true }).click();
    await expect(page.getByTestId("plan-load")).toBeVisible({ timeout: 60_000 });
  });
  await expect(
    page.locator('[data-testid^="route-row-"]:not([data-testid="route-row-baseline"])'),
  ).toHaveCount(3);
  if (LIVE) {
    // Live weather and hazards decide the winner: exactly one recommendation, and not the
    // infeasible baseline-like row A.
    const recommended = page.locator('[data-testid^="route-row-"][data-role="recommended"]');
    await expect(recommended).toHaveCount(1);
    await expect(recommended).not.toHaveAttribute("data-testid", "route-row-A");
  } else {
    await expect(page.getByTestId("route-row-B")).toHaveAttribute("data-role", "recommended");
  }
  const chipSel = '[data-slot="fact-chip"]';
  await expect(
    page
      .getByTestId("plan-load")
      .getByText("Load factor")
      .locator("xpath=following-sibling::dd")
      .locator(chipSel),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "FuelEU" })).toBeVisible();
  const recRow = LIVE
    ? page.locator('[data-testid^="route-row-"][data-role="recommended"]')
    : page.getByTestId("route-row-B");
  await expect(recRow.locator("td").nth(7).locator(chipSel)).toBeVisible();
  await shot(page, 4, "route-plan");

  // A public AIS ship (first in the recorded list) to Rotterdam.
  const traffic = (await (await page.request.get("/api/traffic")).json()) as {
    items: { mmsi: string; name: string | null; lat: number }[];
  };
  let ship = traffic.items.find((s) => s.name) ?? traffic.items[0];
  if (LIVE && liveShip) {
    // Live: the ship the preflight proved plannable.
    const chosen = liveShip;
    ship = traffic.items.find((t) => t.mmsi === chosen.mmsi) ?? { ...chosen, lat: 0 };
  }
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill(ship.mmsi);
  await page
    .getByRole("option", { name: new RegExp(ship.mmsi) })
    .first()
    .click();
  await expect(page.getByLabel("Ship panel", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Destination port" }).click();
  await page.getByRole("option", { name: /Rotterdam/ }).click();
  await page.getByRole("button", { name: "Plan route", exact: true }).click();
  await expect(page.getByTestId("plan-load")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Route options:.*to\s+Rotterdam/i)).toBeVisible();
  await shot(page, 4, "public-ship-route");

  await ask(page, INSTRUCT_Q, "4 instruct");

  // 5. Approvals ------------------------------------------------------------------------------
  await nav(page, "/approvals");
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
  const decide = async (kind: RegExp, confirm: string) => {
    const card = page.locator('[id^="rec-"]').filter({ hasText: kind }).first();
    await card.getByRole("button", { name: "Approve" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: confirm, exact: true }).click();
    return card;
  };
  const po = await decide(/purchase order/i, "Approve");
  await expect(po.getByText(/Purchase order\s+PO-\S+/)).toBeVisible({ timeout: 60_000 });
  // A decided card folds to its outcome; its drafts and audit trail open from one disclosure
  // (a GET-only click: no POST, so the replay keys do not change).
  await po.getByRole("button", { name: /Facts, drafted messages and audit trail/ }).click();
  await expect(po.getByText("draft, not sent").first()).toBeVisible();
  await expect(
    po.getByRole("region", { name: "Audit trail" }).getByRole("listitem").first(),
  ).toBeVisible();
  await shot(page, 5, "approvals-po");
  const vi = await decide(/voyage instruction/i, "Approve");
  await expect(vi.getByText(/Instruction recorded/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 5, "approvals-instruction");

  // 6. Evaluation -----------------------------------------------------------------------------
  await nav(page, "/evaluation");
  await expect(page.getByRole("heading", { name: "Evaluation", level: 1 })).toBeVisible();
  // One visible section per published entry (two dev entries today, four after the held-out run).
  const summary = (await (await page.request.get("/api/eval/summary")).json()) as {
    suites: { suite: string; split: "dev" | "heldout" }[];
  };
  expect(summary.suites.length, "published eval entries").toBeGreaterThan(0);
  for (const entry of summary.suites) {
    const section = page.locator(
      `section[data-suite="${entry.suite}"][data-split="${entry.split}"]`,
    );
    await expect(section, `${entry.suite} ${entry.split} section`).toBeVisible();
    await expect(section.getByText(/\d+ of \d+/).first()).toBeVisible();
    await expect(section.getByText(/95% interval/).first()).toBeAttached();
    await expect(
      section
        .locator(`[data-kind="${entry.split === "dev" ? "dev-split" : "heldout-split"}"]`)
        .first(),
    ).toBeAttached();
  }
  await page
    .getByRole("heading", { name: "Evaluation", level: 1 })
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, 6, "evaluation");

  expect(offOrigin, "requests to other hosts").toEqual([]);
  expect(consoleErrors, "console errors").toEqual([]);
});
