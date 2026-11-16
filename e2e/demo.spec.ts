/**
 * The Pharos demo story: the six steps of docs/MASTER_PLAN.md §1 through the real console.
 *
 * Determinism rule: with the pinned clock, the same requests in the same order give the same
 * replay keys. Do the same actions in the same order on every run: no optional branches, no
 * extra POSTs, route plans only where the story says. Never assert an ERP key byte-for-byte.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// Screenshots go to test-results/ by default; STORY_SCREENSHOTS=docs refreshes the committed set.
const SHOTS =
  process.env.STORY_SCREENSHOTS === "docs" ? "docs/screenshots/phase-6" : "test-results/story";
const timings: { step: string; ms: number }[] = [];

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
  await timed(`${label}: first progress`, async () => {
    await page.locator('form button[aria-label="Ask"]').click();
    await expect(turns).toHaveCount(before + 1);
  });
  const turn = turns.last();
  await timed(`${label}: full answer`, async () => {
    await expect(turn.getByTestId("gate-line").or(turn.locator('[role="alert"]'))).toBeVisible({
      timeout: 120_000,
    });
  });
  await expect(turn.locator('[role="alert"]')).toHaveCount(0);
  // A withheld answer shows a different gate line: only a fully sourced answer passes.
  await expect(turn.getByTestId("gate-line")).toHaveText(/all numbers sourced/);
  return turn;
}

test("demo story: six steps", async ({ page }) => {
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
    await expect(page.locator('[data-source-mode="recorded"]')).toHaveCount(2);
    await expect(page.locator('[data-source-mode="live"]')).toHaveCount(0);
    await expect(page.getByText("AIS", { exact: true })).toBeVisible();
    await expect(page.getByText("Weather", { exact: true }).first()).toBeVisible();
    const clock = page.locator("time[datetime]").first();
    await expect(clock).toHaveText("08:05Z");
    await expect(page.getByText("pinned", { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-testid^="hazard-"] [data-kind="synthetic"]').first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Aegean Pioneer, has an alert" })).toBeVisible();
  });
  await shot(page, 1, "map");

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
  await expect(emails.locator('[data-status="needs_review"]')).toHaveCount(1);
  await expect(emails.locator('[data-status="extracted"]')).toHaveCount(2);

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
  await expect(page.getByTestId("written-qty-0")).toContainText("300/350 mt");
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
  await expect(page.getByTestId("route-row-B")).toHaveAttribute("data-role", "recommended");
  const chipSel = '[data-slot="fact-chip"]';
  await expect(
    page
      .getByTestId("plan-load")
      .getByText("Load factor")
      .locator("xpath=following-sibling::dd")
      .locator(chipSel),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "FuelEU" })).toBeVisible();
  await expect(page.getByTestId("route-row-B").locator("td").nth(7).locator(chipSel)).toBeVisible();
  await shot(page, 4, "route-plan");

  // A public AIS ship (first in the recorded list) to Rotterdam.
  const traffic = (await (await page.request.get("/api/traffic")).json()) as {
    items: { mmsi: string; name: string | null }[];
  };
  const ship = traffic.items.find((s) => s.name) ?? traffic.items[0];
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
  await expect(page.getByText(/\d+ of \d+/).first()).toBeVisible();
  await expect(page.getByText(/95 % interval/).first()).toBeAttached();
  await expect(page.locator('[data-kind="dev-split"]').first()).toBeVisible();
  await page
    .getByRole("heading", { name: "Evaluation", level: 1 })
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, 6, "evaluation");

  writeFileSync("test-results/story-timings.json", JSON.stringify(timings, null, 2));
  expect(offOrigin, "requests to other hosts").toEqual([]);
  expect(consoleErrors, "console errors").toEqual([]);
});
