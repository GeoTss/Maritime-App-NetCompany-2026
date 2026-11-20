/**
 * Track 3 story (replay, after `npm run demo:reset`; it also runs after demo.spec.ts on the same
 * stack). The security emails arrive (04 and 05 stored, 06 held for review); Atlantic Meridian's
 * plan crosses the danger areas, with Suez and an armed team set against the Cape; the security
 * order and the instruction are proposed from the plan; the instruction waits for the order, which
 * is approved first. No model call beyond the recorded extractions: proposals come from the plan.
 */
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = "test-results/security";
const VESSEL = "Atlantic Meridian";

async function nav(page: Page, path: string) {
  await page.locator(`nav a[href="${path}"]`).click();
}

test("security story: danger areas, Suez or the Cape, the armed team's approval", async ({
  page,
}) => {
  const health = (await (await page.request.get("http://localhost:4000/api/health")).json()) as {
    llmMode?: string;
  };
  expect(health.llmMode, "run npm run demo:reset first").toBe("replay");
  const problems: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol.startsWith("http"))
      problems.push(`off-origin ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  mkdirSync(SHOTS, { recursive: true });

  // 1. Inbox: deliver up to the sixth demo email.
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  const inbox = (await (await page.request.get("/api/inbox")).json()) as { items: unknown[] };
  const deliver = page.getByRole("button", { name: "Deliver next email" });
  const emails = page.getByRole("list", { name: "Emails" }).getByRole("listitem");
  await expect(emails).toHaveCount(inbox.items.length);
  for (let n = inbox.items.length; n < 6; n++) {
    await deliver.click();
    await expect(emails).toHaveCount(n + 1);
  }
  await expect(emails.locator('[data-status="pending"]')).toHaveCount(0, { timeout: 120_000 });
  const statusOf = (re: RegExp) => emails.filter({ hasText: re }).locator("[data-status]").first();
  await expect(statusOf(/Fujairah to Djibouti/)).toHaveAttribute("data-status", "extracted");
  await expect(statusOf(/Fujairah to Durban/)).toHaveAttribute("data-status", "extracted");
  await expect(statusOf(/Fujairah\/Suez/)).toHaveAttribute("data-status", "needs_review");
  await page.screenshot({ path: `${SHOTS}/security-1-inbox.png` });

  // 2. Map: plan Atlantic Meridian; the danger areas and the Suez-or-Cape line.
  await nav(page, "/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill(VESSEL);
  await page
    .getByRole("option", { name: new RegExp(VESSEL) })
    .first()
    .click();
  await page.getByRole("button", { name: /^Plan route( again)?$/ }).click();
  await expect(page.getByTestId("plan-load")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("danger-label-gulf-of-aden")).toBeAttached();
  const line = page.getByTestId("suez-or-cape");
  await expect(line).toContainText(/route [A-J] through Suez totals/);
  await expect(line).toContainText("route K round the Cape totals");
  await expect(
    page.locator('[data-testid^="security-"]').filter({ hasText: "Tridentis Marine Protection" }),
  ).not.toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/security-2-plan.png` });

  // 3. Propose the security order and the instruction from the plan (no model call).
  const propose = page.getByTestId("plan-propose");
  await propose.getByRole("button", { name: "Propose security order" }).click();
  await expect(propose.getByTestId("plan-existing-security_order")).toBeVisible();
  await propose.getByRole("button", { name: /^Propose (updated )?voyage instruction$/ }).click();
  await expect(propose.getByTestId("plan-existing-voyage_instruction")).toBeVisible();

  // 4. Approvals: the instruction waits for the security order; approve the order, then it opens.
  await page.getByRole("button", { name: "Close route options" }).click();
  await nav(page, "/approvals");
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
  const queue = page.getByRole("complementary", { name: "Approval queue" });
  const detail = page
    .getByRole("article")
    .filter({ has: page.getByRole("region", { name: /^(If you approve|Outcome)$/ }) });
  const open = (kind: RegExp) =>
    queue
      .locator("li[data-recommendation-id]")
      .filter({ hasText: kind })
      .filter({ hasText: VESSEL })
      .first()
      .getByRole("link")
      .click();
  await open(/Voyage instruction/);
  const waits = detail.getByTestId("dependency-line");
  await expect(waits).toHaveAttribute("data-satisfied", "false");
  await expect(waits).toContainText("Tridentis Marine Protection (Fujairah to Djibouti)");
  await expect(detail.getByRole("button", { name: /^Approve voyage instruction/ })).toBeDisabled();

  await open(/Security order/);
  const order = detail.getByRole("region", { name: "The order" });
  await expect(order).toContainText("Tridentis Marine Protection (Fujairah to Djibouti)");
  await expect(order).toContainText("Team cost");
  await detail.getByRole("button", { name: /^Approve security order/ }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Order the armed security team");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Approve and create the order", exact: true })
    .click();
  await expect(detail.getByText(/Security order\s+\S+/)).toBeVisible({ timeout: 60_000 });
  await detail.getByRole("button", { name: /^Drafted messages/ }).click();
  await expect(detail.getByText("draft, not sent").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/security-3-order.png` });

  await open(/Voyage instruction/);
  await expect(waits).toHaveAttribute("data-satisfied", "true");
  await detail.getByRole("button", { name: /^Approve voyage instruction/ }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Approve and record the instruction", exact: true })
    .click();
  await expect(detail.getByText(/Instruction recorded/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/security-4-instruction.png` });

  expect(problems).toEqual([]);
});
