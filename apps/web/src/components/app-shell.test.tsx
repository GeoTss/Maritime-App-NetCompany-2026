import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { routes } from "@/routes";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

const requests: { url: string; method: string }[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("app shell", () => {
  it.each([
    ["/", "Map"],
    ["/inbox", "Inbox"],
    ["/approvals", "Approvals"],
    ["/evaluation", "Evaluation"],
    ["/dev/kit", "Design kit"],
  ])("routes %s to its screen inside the shell", async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Screens" })).toBeTruthy();
    expect(screen.getByText("Pharos")).toBeTruthy();
  });

  it("the top bar has four screen links, the active one marked", async () => {
    renderAt("/inbox");
    const nav = await screen.findByRole("navigation", { name: "Screens" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/",
      "/inbox",
      "/approvals",
      "/evaluation",
    ]);
    expect(within(nav).getByRole("link", { name: /Inbox/ }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: /Map/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("the Inbox badge counts the quotes to review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url) === "/api/inbox"
          ? new Response(
              JSON.stringify({
                items: [
                  {
                    documentId: 1,
                    sender: null,
                    subject: null,
                    receivedAt: "2026-11-14T08:00:00.000Z",
                    kind: "email",
                    extractionStatus: "needs_review",
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          : new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
      ),
    );
    renderAt("/inbox");
    const nav = await screen.findByRole("navigation", { name: "Screens" });
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: /Inbox/ }).textContent).toContain("1"),
    );
  });

  it("an unknown address says so and offers the way back", async () => {
    renderAt("/nowhere");
    expect(await screen.findByText("No screen at this address")).toBeTruthy();
  });

  it("⌘K opens the command menu, and choosing a screen goes there", async () => {
    const router = renderAt("/");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Approvals");
    fireEvent.click(screen.getByRole("option", { name: /Approvals/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/approvals"));
  });

  it("loading the shell sends no POST", async () => {
    renderAt("/dev/kit");
    await screen.findByRole("heading", { name: "Design kit" });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });
});
