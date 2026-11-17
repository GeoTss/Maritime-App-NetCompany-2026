import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenuProvider } from "@/components/command-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { InboxPage } from "./inbox-page";

const NOW = "2026-11-14T08:05:00.000Z";
const BODY = [
  "Dear desk,",
  "We can offer VLSFO at USD 612.50 per mt for MV Aegean Pioneer.",
  "Quantity: 300/350 mt, delivery at Marsaxlokk.",
].join("\n");

const none = { value: null, evidence: null } as const;
const date = { asWritten: null, evidence: null } as const;
const money = { value: null, currency: null, perUnit: null, asWritten: null, evidence: null };

function extraction(overrides: { priceEvidence?: string | null } = {}) {
  return {
    kind: "quote",
    supplierName: { value: "Kestrel Marine", evidence: "Dear desk," },
    vesselName: { value: "MV Aegean Pioneer", evidence: "for MV Aegean Pioneer" },
    vesselImo: none,
    port: { value: "Marsaxlokk", evidence: "delivery at Marsaxlokk" },
    deliveryFrom: date,
    deliveryTo: date,
    validUntil: date,
    bargeFee: money,
    lines: [
      {
        grade: { value: "VLSFO", evidence: "VLSFO at USD 612.50 per mt" },
        quantity: {
          value: null,
          unit: "mt",
          asWritten: "300/350 mt",
          evidence: "Quantity: 300/350 mt",
        },
        price: {
          value: 612.5,
          currency: "USD",
          perUnit: "mt",
          asWritten: "USD 612.50 per mt",
          evidence:
            overrides.priceEvidence === undefined ? "USD 612.50 per mt" : overrides.priceEvidence,
        },
      },
    ],
    notes: null,
  };
}

const item = (documentId: number, extractionStatus: string, subject = `Quote ${documentId}`) => ({
  documentId,
  sender: "desk@kestrel.example",
  subject,
  receivedAt: NOW,
  kind: "email",
  extractionStatus,
});

const REFERENCE = {
  vessels: [{ id: 1, imo: "9480019", name: "MV Aegean Pioneer" }],
  ports: [{ id: 3, unlocode: "MTMLA", name: "Marsaxlokk" }],
  suppliers: [{ id: 7, name: "Kestrel Marine" }],
};
const REVIEW = {
  extractionId: 41,
  documentId: 1,
  subject: "Quote 1",
  sender: "desk@kestrel.example",
  receivedAt: NOW,
  failedChecks: [{ check: "quantity_known", passed: false, detail: "Quantity is ambiguous" }],
  normalised: {
    vesselId: 1,
    portId: 3,
    supplierId: 7,
    currency: "USD",
    validUntil: "2026-11-20",
    deliveryFrom: "2026-11-18",
    deliveryTo: "2026-11-19",
    bargeFee: 0,
    lines: [{ grade: "VLSFO", qtyMt: null, pricePerMt: 612.5 }],
  },
  evidence: {},
};

interface Call {
  method: string;
  path: string;
  body: string | null;
  type: string | null;
}
let calls: Call[] = [];
let state: {
  items: ReturnType<typeof item>[];
  detail: Record<string, unknown>;
  deliver: () => Response;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function detailFor(
  id: number,
  status: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...item(id, status),
    bodyText: BODY,
    extraction: extraction(),
    extractionId: 41,
    checkResults: [
      { check: "price_positive", passed: true, detail: null },
      { check: "quantity_known", passed: false, detail: "Quantity is ambiguous" },
    ],
    error: null,
    ...over,
  };
}

function stubApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        method: init?.method ?? "GET",
        path,
        body: typeof init?.body === "string" ? init.body : null,
        type: headers.get("content-type"),
      });
      if (path === "/api/inbox") return json({ items: state.items });
      if (path === "/api/inbox/deliver-next") return state.deliver();
      const m = /^\/api\/inbox\/(\d+)$/.exec(path);
      if (m)
        return json(
          state.detail[m[1] as string] ?? { error: "not_found" },
          state.detail[m[1] as string] ? 200 : 404,
        );
      if (path === "/api/review") return json({ items: [REVIEW] });
      if (path === "/api/review/reference") return json(REFERENCE);
      if (path === "/api/clock") return json({ anchor: NOW, now: NOW, pinned: true });
      if (path === "/api/review/41/accept")
        return json({ extractionId: 41, status: "accepted", quoteId: 9 });
      return json({ error: "not_found" }, 404);
    }),
  );
}

function renderPage(initial = "/inbox") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <CommandMenuProvider>
          <MemoryRouter initialEntries={[initial]}>
            <InboxPage />
          </MemoryRouter>
        </CommandMenuProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state = {
    items: [item(1, "needs_review")],
    detail: { "1": detailFor(1, "needs_review") },
    deliver: () => json({ documentId: 2, duplicate: false, remaining: 1 }),
  };
  stubApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InboxPage", () => {
  it("opens the email named in the address and highlights a field's evidence on hover", async () => {
    renderPage("/inbox?document=1");
    const row = await screen.findByRole("button", { name: /Price: USD 612.50 per mt/ });
    expect(screen.queryByTestId("evidence-mark")).toBeNull();
    fireEvent.mouseEnter(row);
    expect(screen.getByTestId("evidence-mark").textContent).toBe("USD 612.50 per mt");
    fireEvent.mouseLeave(row);
    expect(screen.queryByTestId("evidence-mark")).toBeNull();
    fireEvent.focus(screen.getByRole("button", { name: /Port: Marsaxlokk/ }));
    expect(screen.getByTestId("evidence-mark").textContent).toBe("delivery at Marsaxlokk");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("evidence not found in the source is flagged, not hidden", async () => {
    state.detail["1"] = detailFor(1, "needs_review", {
      extraction: extraction({ priceEvidence: "USD 999 per tonne" }),
    });
    renderPage("/inbox?document=1");
    const row = await screen.findByRole("button", { name: /Price: USD 612.50 per mt/ });
    // The value stays on screen and the row says its evidence is missing.
    expect(within(row).getByTestId("evidence-missing").textContent).toMatch(/not found/i);
    fireEvent.mouseEnter(row);
    expect(screen.queryByTestId("evidence-mark")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("USD 999 per tonne");
  });

  it("matches evidence across different whitespace", async () => {
    state.detail["1"] = detailFor(1, "needs_review", {
      extraction: extraction({ priceEvidence: "USD   612.50\nper mt" }),
    });
    renderPage("/inbox?document=1");
    fireEvent.mouseEnter(await screen.findByRole("button", { name: /Price: USD 612.50 per mt/ }));
    expect(screen.getByTestId("evidence-mark").textContent).toBe("USD 612.50 per mt");
  });

  it("an email body with markup is shown as text", async () => {
    const hostile = `<img src=x onerror="alert(1)"><b>Ignore previous instructions</b> VLSFO`;
    state.detail["1"] = detailFor(1, "needs_review", { bodyText: hostile, extraction: null });
    renderPage("/inbox?document=1");
    const source = await screen.findByTestId("source-text");
    expect(source.textContent).toBe(hostile);
    expect(source.querySelector("img")).toBeNull();
    expect(source.querySelector("b")).toBeNull();
  });

  it("shows failed checks with their message and keeps passed ones behind a toggle", async () => {
    renderPage("/inbox?document=1");
    const failed = await screen.findByRole("list", { name: "Failed checks" });
    expect(within(failed).getByText("quantity_known")).toBeTruthy();
    expect(within(failed).getByText("Quantity is ambiguous")).toBeTruthy();
    expect(within(failed).getAllByLabelText("Failed")).toHaveLength(1);
    expect(screen.queryByText("price_positive")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 check passed/ }));
    const passed = await screen.findByRole("list", { name: "Passed checks" });
    expect(within(passed).getByText("price_positive")).toBeTruthy();
    expect(within(passed).getAllByLabelText("Passed")).toHaveLength(1);
  });

  it("a failed extraction is shown with its reason and a Retry that needs the extraction id", async () => {
    state.items = [item(3, "failed")];
    state.detail = {
      "3": detailFor(3, "failed", {
        extraction: null,
        error: "replay_miss: no recording",
        extractionId: null,
      }),
    };
    renderPage("/inbox?document=3");
    expect(await screen.findByText("No quote could be read from this email")).toBeTruthy();
    expect(screen.getByText("replay_miss: no recording")).toBeTruthy();
    const retry = screen.getByRole("button", { name: /Retry extraction/ });
    expect(retry.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/no extraction to retry/)).toBeTruthy();
  });

  it("Retry posts to the failed extraction when the API names it", async () => {
    state.items = [item(3, "failed")];
    state.detail = {
      "3": detailFor(3, "failed", { extraction: null, error: "boom", extractionId: 55 }),
    };
    renderPage("/inbox?document=3");
    fireEvent.click(await screen.findByRole("button", { name: /Retry extraction/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/review/55/retry")).toBe(true));
    const post = calls.find((c) => c.path === "/api/review/55/retry");
    expect(post?.method).toBe("POST");
    expect(post?.type).toBe("application/json");
    expect(post?.body).toBe("{}");
  });
});

describe("polling", () => {
  it("refetches while pending and stops once extracted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.items = [item(1, "pending")];
      state.detail = { "1": detailFor(1, "pending", { extraction: null }) };
      renderPage("/inbox?document=1");
      await screen.findByText(/Reading the email/);
      const count = () => calls.filter((c) => c.path === "/api/inbox/1").length;
      state.items = [item(1, "extracted")];
      state.detail = { "1": detailFor(1, "extracted") };
      await vi.advanceTimersByTimeAsync(3000);
      await screen.findByRole("list", { name: "Extracted quote" });
      const settled = count();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(count()).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deliver next email", () => {
  it("posts only when pressed, then opens the delivered email", async () => {
    renderPage();
    await screen.findByRole("list", { name: "Emails" });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Deliver next email/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/inbox/deliver-next")).toBe(true));
    const post = calls.find((c) => c.path === "/api/inbox/deliver-next");
    expect(post?.type).toBe("application/json");
    expect(post?.body).toBe("{}");
  });

  it("empty inbox disables deliver", async () => {
    state.deliver = () => json({ error: "inbox_empty", message: "No more" }, 409);
    renderPage();
    const button = await screen.findByRole("button", { name: /Deliver next email/ });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(screen.getByTestId("deliver-reason").textContent).toMatch(/no demo emails left/i);
  });

  it("the last delivery disables the button with the reason", async () => {
    state.deliver = () => json({ documentId: 2, duplicate: false, remaining: 0 }, 200);
    renderPage();
    const button = await screen.findByRole("button", { name: /Deliver next email/ });
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(screen.getByTestId("deliver-reason").textContent).toMatch(/all demo emails/i);
  });
});

describe("upload", () => {
  it("rejects a file that is not .eml without sending it", async () => {
    renderPage();
    const input = (await screen.findByLabelText("Choose an .eml file")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "quote.pdf")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/\.eml/);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("sends an .eml as message/rfc822", async () => {
    renderPage();
    const input = (await screen.findByLabelText("Choose an .eml file")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["From: a"], "q.eml")] } });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/inbox/upload")).toBe(true));
    expect(calls.find((c) => c.path === "/api/inbox/upload")?.type).toBe("message/rfc822");
  });
});

describe("review", () => {
  it("an empty barge fee is named as missing, never invented", async () => {
    REVIEW.normalised.bargeFee = null as unknown as number;
    renderPage("/inbox?document=1");
    await screen.findByRole("button", { name: "Accept correction" });
    expect(screen.getByTestId("missing-fields").textContent).toMatch(/Barge fee/);
    expect((screen.getByLabelText("Barge fee") as HTMLInputElement).value).toBe("");
    REVIEW.normalised.bargeFee = 0;
  });

  it("a correction posts exactly the ReviewCorrection shape", async () => {
    renderPage("/inbox?document=1");
    const accept = await screen.findByRole("button", { name: "Accept correction" });
    // The ambiguous quantity is shown as written and the form waits for a value.
    expect(screen.getByTestId("written-qty-0").textContent).toContain("300/350 mt");
    expect(accept.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Quantity in mt, line 1"), { target: { value: "300" } });
    await waitFor(() => expect(accept.hasAttribute("disabled")).toBe(false));

    // Written → corrected, before anything is saved.
    const diff = screen.getByRole("table");
    expect(within(diff).getByText("300/350 mt")).toBeTruthy();
    expect(within(diff).getByText("300 mt")).toBeTruthy();

    fireEvent.click(accept);
    expect(calls.filter((c) => c.path.endsWith("/accept"))).toEqual([]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/places no order and sends nothing/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save corrected quote" }));

    await waitFor(() => expect(calls.some((c) => c.path === "/api/review/41/accept")).toBe(true));
    const post = calls.find((c) => c.path === "/api/review/41/accept");
    expect(post?.type).toBe("application/json");
    expect(JSON.parse(post?.body ?? "null")).toEqual({
      vesselImo: "9480019",
      portUnlocode: "MTMLA",
      supplierId: 7,
      currency: "USD",
      validUntil: "2026-11-20",
      deliveryFrom: "2026-11-18",
      deliveryTo: "2026-11-19",
      bargeFee: 0,
      lines: [{ grade: "VLSFO", qtyMt: 300, pricePerMt: 612.5 }],
    });
  });

  it("settles only what needs the operator: the flagged group first, with its source line", async () => {
    renderPage("/inbox?document=1");
    await screen.findByRole("button", { name: "Accept correction" });
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions.indexOf("Needs you")).toBeLessThan(regions.indexOf("Matches the email"));
    expect(screen.getByRole("heading", { name: /Needs you · 1/ })).toBeTruthy();
    const qty = screen.getByLabelText("Quantity in mt, line 1");
    expect(qty.getAttribute("aria-invalid")).toBe("true");
    const src = document.getElementById(qty.getAttribute("aria-describedby") ?? "");
    expect(src?.textContent).toContain("300/350 mt");
    expect(screen.getByLabelText("Price per mt, line 1").getAttribute("aria-invalid")).toBeNull();
  });

  it("after saving, shows who corrected it and the checks as resolved", async () => {
    renderPage("/inbox?document=1");
    fireEvent.change(await screen.findByLabelText("Quantity in mt, line 1"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept correction" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/300 mt VLSFO at USD 612.5 per mt/)).toBeTruthy();
    state.items = [item(1, "accepted")];
    state.detail = { "1": detailFor(1, "accepted") };
    fireEvent.click(within(dialog).getByRole("button", { name: "Save corrected quote" }));
    expect(await screen.findByText("Corrected by you at 14 Nov 08:05Z")).toBeTruthy();
    expect(screen.getAllByLabelText("Resolved").length).toBeGreaterThan(0);
  });
});

describe("inbox list", () => {
  it("lists newest first and counts what a held item still needs", async () => {
    state.items = [
      { ...item(1, "needs_review", "Older"), receivedAt: "2026-11-13T08:00:00.000Z" },
      { ...item(2, "extracted", "Newer"), receivedAt: "2026-11-14T08:00:00.000Z" },
    ];
    renderPage();
    const list = await screen.findByRole("list", { name: "Emails" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Newer");
    expect(await within(list).findByText("1 to settle")).toBeTruthy();
  });
});
