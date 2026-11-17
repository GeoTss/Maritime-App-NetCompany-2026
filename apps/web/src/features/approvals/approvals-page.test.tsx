import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { ApprovalsPage } from "./approvals-page";

// The border beam reads motion's reduced-motion preference; the tests set it.
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (original) => ({
  ...(await original<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduce,
}));

const NOW = "2026-11-14T08:05:00.000Z";
const fact = (id: string, label: string, value: number, unit: string) => ({
  id,
  label,
  value,
  unit,
  provenance: { source: "db", table: "quotes", rowId: 7, field: "price" },
});

const rec = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  type: "purchase_order",
  status: "pending",
  calculationId: 3,
  optionId: "MTMLA-kestrel",
  optionLabel: null,
  summary: "Buy VLSFO from Kestrel Marine at Marsaxlokk.",
  expectedSavingUsd: 18250,
  expectedSaving: null,
  factRefs: ["f_total"],
  facts: [
    fact("f_total", "Total landed cost", 233914, "USD"),
    fact("f_save", "Saving", 18250, "USD"),
  ],
  gatePassed: true,
  order: null,
  instruction: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  method: string;
  path: string;
  body: string | null;
  type: string | null;
}
let calls: Call[];
let items: ReturnType<typeof rec>[];
let decide: (id: number, verb: string) => Response | Promise<Response>;

const DRAFT = {
  id: 1,
  recommendationId: 1,
  kind: "supplier_confirmation",
  to: "desk@kestrel.example",
  subject: "Confirmation of order",
  body: "Please confirm the stem.",
  status: "draft",
  createdAt: NOW,
};
let drafts: unknown[];

beforeEach(() => {
  calls = [];
  drafts = [];
  items = [
    rec(1),
    rec(2, { type: "voyage_instruction", summary: "Slow to 12.5 kn.", expectedSavingUsd: -300 }),
  ];
  decide = () => json({}, 500);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path,
        body: typeof init?.body === "string" ? init.body : null,
        type: headers.get("content-type"),
      });
      if (path === "/api/recommendations") return json({ items });
      const m = /^\/api\/recommendations\/(\d+)\/(approve|reject)$/.exec(path);
      if (m && method === "POST") return decide(Number(m[1]), m[2] as string);
      if (/\/drafts$/.test(path)) return json({ items: drafts });
      if (path.startsWith("/api/audit"))
        return json({
          items: [
            {
              id: 9,
              recommendationId: 1,
              kind: "recommendation.approved",
              actor: "operator",
              detail: { erpPoNumber: "PO-1" },
              at: NOW,
            },
          ],
        });
      return json({ error: "not_found" }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(initial = "/approvals") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initial]}>
          <ApprovalsPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const posts = () => calls.filter((c) => c.method === "POST");

describe("ApprovalsPage", () => {
  it("lists pending proposals first; exactly the top pending card carries the focal beam", async () => {
    motion.reduce = false;
    items = [rec(3, { status: "rejected" }), rec(1), rec(2)];
    renderPage();
    const cards = await screen.findAllByRole("article");
    expect(cards.map((c) => c.getAttribute("data-status"))).toEqual([
      "pending",
      "pending",
      "rejected",
    ]);
    const beams = cards.map((c) => c.querySelectorAll("[data-slot=border-beam]").length);
    expect(beams).toEqual([1, 0, 0]);
    expect(posts()).toEqual([]);
  });

  it("no beam under reduced motion", async () => {
    motion.reduce = true;
    items = [rec(1), rec(2)];
    renderPage();
    await screen.findAllByRole("article");
    expect(document.querySelectorAll("[data-slot=border-beam]")).toHaveLength(0);
  });

  it("splits awaiting from decided, each under its own heading", async () => {
    items = [rec(3, { status: "rejected" }), rec(1)];
    renderPage();
    const awaiting = await screen.findByRole("region", { name: /Awaiting your decision/ });
    const decided = screen.getByRole("region", { name: /Decided/ });
    expect(
      within(awaiting)
        .getAllByRole("article")
        .map((a) => a.dataset.status),
    ).toEqual(["pending"]);
    expect(
      within(decided)
        .getAllByRole("article")
        .map((a) => a.dataset.status),
    ).toEqual(["rejected"]);
  });

  it("names the option from optionLabel", async () => {
    items = [rec(1, { optionLabel: "Kestrel Marine Fuels at Marsaxlokk" })];
    renderPage();
    const [card] = await screen.findAllByRole("article");
    expect(within(card as HTMLElement).getByTestId("option-name").textContent).toBe(
      "Kestrel Marine Fuels at Marsaxlokk",
    );
  });

  it("saving is the expectedSaving fact chip", async () => {
    items = [
      rec(1, {
        expectedSaving: {
          id: "f_saving",
          label: "Saving versus the cheapest headline price",
          value: 18250,
          unit: "USD",
          provenance: {
            source: "calculation",
            calculationId: 1,
            calculator: "planBunkers",
            path: "savingVsCheapestHeadlineUsd",
          },
        },
      }),
    ];
    renderPage();
    const [card] = await screen.findAllByRole("article");
    const saving = within(card as HTMLElement)
      .getByText("Expected saving")
      .parentElement?.querySelector("[data-slot=fact-chip]");
    expect(saving?.getAttribute("data-fact-id")).toBe("f_saving");
    expect(saving?.textContent).toBe("+USD 18,250");
  });

  it("no uncited saving: without an expectedSaving fact it reads not stated", async () => {
    items = [rec(1, { expectedSavingUsd: 18250, expectedSaving: null })];
    renderPage();
    const [card] = await screen.findAllByRole("article");
    const dd = within(card as HTMLElement).getByText("Expected saving").parentElement;
    expect(dd?.textContent).toContain("not stated");
    expect(dd?.querySelector("[data-slot=fact-chip]")).toBeNull();
    expect(dd?.textContent).not.toContain("18,250");
  });

  it("fact rows show the fact labels", async () => {
    const label = "MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): quantity";
    items = [rec(1, { facts: [fact("f_q", label, 500, "mt")] })];
    renderPage();
    const row = (await screen.findByText(label)).closest("li") as HTMLElement;
    expect(row.querySelector("[data-slot=fact-chip]")?.getAttribute("data-fact-id")).toBe("f_q");
  });

  it("shows a signed saving, as returned, and the gate and data tags", async () => {
    items = [
      rec(2, {
        type: "voyage_instruction",
        expectedSavingUsd: -300,
        expectedSaving: fact("f_neg", "Saving", -300, "USD"),
      }),
    ];
    renderPage();
    await screen.findAllByRole("article");
    expect(screen.getByText(/-USD 300|−USD 300|USD -300/)).toBeTruthy();
    expect(screen.getAllByText("simulated data").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/gate passed/i).length).toBeGreaterThan(0);
  });

  it("states what approving does before anything is posted", async () => {
    renderPage();
    const [first] = await screen.findAllByRole("article");
    fireEvent.click(within(first as HTMLElement).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(
      /pushes the order to the ERP simulator and drafts a supplier confirmation \(not sent\)/,
    );
    expect(posts()).toEqual([]);
  });

  it("a voyage instruction names its own consequence", async () => {
    items = [rec(2, { type: "voyage_instruction" })];
    renderPage();
    const [card] = await screen.findAllByRole("article");
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Nothing is written to the ERP/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it pending" }));
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(
      /records the route and speed instruction and drafts a message to the master \(not sent\)/,
    );
  });

  it("approve is single-flight", async () => {
    let release: (r: Response) => void = () => undefined;
    decide = () => new Promise<Response>((r) => (release = r));
    renderPage();
    const [first] = await screen.findAllByRole("article");
    const card = within(first as HTMLElement);
    fireEvent.click(card.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    // While in flight no control on any card can start another decision.
    const buttons = screen.getAllByRole("button", { name: /Approving|Approve|Reject/ });
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(posts()[0]?.path).toBe("/api/recommendations/1/approve");
    expect(posts()[0]?.type).toBe("application/json");
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-100234", erpSyncStatus: "synced" },
      }),
      rec(2),
    ];
    await act(async () => {
      release(
        json({
          recommendationId: 1,
          status: "executed",
          orderId: 5,
          erpPoNumber: "PO-100234",
          erpSyncStatus: "synced",
          instructionId: null,
        }),
      );
    });
    expect(await screen.findByText(/PO-100234/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it("a 409 shows the current status from a refetch", async () => {
    decide = () => json({ error: "illegal_transition", message: "already approved" }, 409);
    renderPage();
    const [first] = await screen.findAllByRole("article");
    fireEvent.click(within(first as HTMLElement).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    items = [rec(1, { status: "rejected" }), rec(2)];
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    });
    const note = await screen.findByText(/already decided/i);
    expect(note.textContent).toMatch(/rejected/);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("article")
          .map((c) => c.getAttribute("data-status"))
          .sort(),
      ).toEqual(["pending", "rejected"]),
    );
  });

  it("an approved PO shows PO number, ERP state, drafts and the audit trail", async () => {
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-100234", erpSyncStatus: "synced" },
      }),
    ];
    drafts = [DRAFT];
    renderPage();
    expect(await screen.findByText(/PO-100234/)).toBeTruthy();
    expect(screen.getByText(/ERP sync: synced/)).toBeTruthy();
    // Folded: the facts, drafts and audit trail open from one disclosure.
    expect(screen.queryByText("Confirmation of order")).toBeNull();
    const trigger = screen.getByRole("button", { name: /Facts, drafted messages and audit trail/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(await screen.findByText("Confirmation of order")).toBeTruthy();
    expect(await screen.findByText("recommendation.approved")).toBeTruthy();
    // The audit detail reads as labelled pairs, not JSON.
    const audit = screen.getByRole("region", { name: "Audit trail" });
    expect(within(audit).getByText("ERP PO number")).toBeTruthy();
    expect(within(audit).getByText("PO-1")).toBeTruthy();
    expect(audit.textContent).not.toMatch(/[{}"]/);
  });

  it("a failed ERP sync reads not synced, will retry", async () => {
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: null, erpSyncStatus: "failed" },
      }),
    ];
    renderPage();
    expect(await screen.findByText(/not synced, will retry/)).toBeTruthy();
  });

  it("an approved voyage instruction shows route, speed and ETA", async () => {
    items = [
      rec(2, {
        type: "voyage_instruction",
        status: "executed",
        instruction: { instructionId: 3, candidateId: "via-suez-12.5", speedKn: 12.5, eta: NOW },
      }),
    ];
    renderPage();
    const text = (await screen.findByText(/via-suez-12.5/)).parentElement?.textContent ?? "";
    expect(text).toMatch(/12\.5 kn/);
    expect(text).toMatch(/14 Nov 08:05Z/);
  });

  it("drafts have no send control", async () => {
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-1", erpSyncStatus: "synced" },
      }),
    ];
    drafts = [DRAFT];
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Facts, drafted messages and audit trail/ }),
    );
    expect(await screen.findByText("Confirmation of order")).toBeTruthy();
    expect(screen.getByText("draft, not sent")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /send/i })).toEqual([]);
    expect(screen.queryAllByRole("link", { name: /send/i })).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it("an empty queue and a failed load say so", async () => {
    items = [];
    renderPage();
    expect(await screen.findByText(/Nothing is waiting/)).toBeTruthy();
  });
});
