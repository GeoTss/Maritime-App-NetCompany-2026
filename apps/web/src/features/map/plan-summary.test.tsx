import type { PlanProposals, RoutePlanView } from "@pharos/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/queries";
import { makeFuelPlan, makePlan, STOP_NAMES } from "./map-fixtures";
import { FuelBlindBest, PlanSummary } from "./plan-summary";

afterEach(cleanup);

const renderSummary = (plan = makeFuelPlan(), names = STOP_NAMES) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <PlanSummary plan={plan} names={names} />
        <FuelBlindBest plan={plan} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const chipIds = (el: Element) =>
  [...el.querySelectorAll<HTMLElement>("[data-slot=fact-chip]")].map((c) => c.dataset.factId);

describe("PlanSummary", () => {
  it("shows the recommended plan first: the stop via the port, speed, stop card, ETA", () => {
    renderSummary();
    const summary = screen.getByTestId("plan-summary");
    expect(within(summary).getByText("Recommended plan")).toBeTruthy();
    expect(screen.getByTestId("plan-title").textContent).toBe(
      "Call at Marsaxlokk for bunkers, Kestrel Marine Fuels' quote",
    );
    expect(screen.getByTestId("cell-plan-speedKn").textContent).toBe("11.5 kn");
    expect(screen.getByTestId("cell-plan-eta").textContent).toBe("26 Nov 09:30Z");
    const card = screen.getByTestId("stop-card");
    expect(within(card).getByTestId("cell-stop-arriveAt").textContent).toBe("17 Nov 20:00Z");
    expect(within(card).getByTestId("cell-stop-departAt").textContent).toBe("18 Nov 08:30Z");
    expect(within(card).getByTestId("cell-stop-qtyMt").textContent).toBe("300.0 mt");
    expect(card.textContent).toContain("LSMGO after bunkering");
    expect(within(card).getByTestId("cell-rob-stop_departure").textContent).toBe("381.0 mt");
    // The recommended plan leads; the best route ignoring fuel follows.
    const best = screen.getByTestId("fuel-blind-best-summary");
    expect(summary.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("every labelled number is a fact chip", () => {
    renderSummary();
    const root = document.body;
    const chips = [...root.querySelectorAll("[data-slot=fact-chip]")];
    expect(chips.length).toBeGreaterThan(10);
    // Every digit on screen sits inside a fact chip.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/\d/.test(n.textContent ?? "")) continue;
      expect(n.parentElement?.closest("[data-slot=fact-chip]"), n.textContent ?? "").not.toBeNull();
    }
  });

  it("says what the stop adds and names the next feasible quote", () => {
    renderSummary();
    const adds = screen.getByTestId("plan-adds");
    expect(adds.textContent).toMatch(/^Adds 21\.3 h and USD 19,850\.40 against the best route/);
    expect(chipIds(adds)).toEqual(["f_plan_plan.addedHours", "f_plan_plan.addedUsd"]);
    const next = screen.getByTestId("plan-next");
    expect(next.textContent).toContain("Nordwind Bunker Services at Algeciras");
    expect(chipIds(next)).toEqual([
      "f_plan_stopPlans.1.totalCostUsd",
      "f_plan_plan.next.marginUsd",
    ]);
  });

  it('shows "No feasible plan" with each quote\'s reasons in words', () => {
    renderSummary(makeFuelPlan({ infeasible: true }));
    const none = screen.getByTestId("no-plan");
    expect(within(none).getByRole("heading").textContent).toBe("No feasible plan");
    expect(none.querySelector("[data-flag=V]")).not.toBeNull();
    expect(screen.getByTestId("stop-reasons-MTMLA-kestrel").textContent).toBe(
      "Kestrel Marine Fuels at Marsaxlokk: arrives after the berth window closes",
    );
    expect(screen.getByTestId("stop-reasons-ESALG-nordwind").textContent).toBe(
      "Nordwind Bunker Services at Algeciras: runs below a fuel margin, before or after the stop; arrives outside the quote's delivery window",
    );
    expect(screen.getByTestId("stop-reasons-GIGIB-straitline").textContent).toContain(
      "no sea route through the port",
    );
    expect(screen.queryByTestId("plan-summary")).toBeNull();
  });

  it('says "weather beyond the forecast" when beyondForecast is true', () => {
    renderSummary(makeFuelPlan({ beyondForecast: true }));
    expect(screen.getByTestId("beyond-forecast").textContent).toMatch(
      /weather beyond the forecast/,
    );
    cleanup();
    renderSummary();
    expect(screen.queryByTestId("beyond-forecast")).toBeNull();
  });

  it("names a stop by its port code when the quote is not known", () => {
    renderSummary(makeFuelPlan(), new Map());
    expect(screen.getByTestId("plan-title").textContent).toBe("Call at MTMLA for bunkers");
  });

  it("renders nothing for a ship seen on AIS", () => {
    const { container } = renderSummary(makePlan());
    expect(container.textContent).toBe("");
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Where the router is, so a toast's action can be followed. */
function Where() {
  const at = useLocation();
  return <output data-testid="where">{at.pathname + at.search}</output>;
}

describe("PlanSummary: proposing from the plan", () => {
  let posts: { path: string; body: unknown; type: string | null }[];
  let reply: (body: { type: string }) => Response | Promise<Response>;
  /** What `GET /api/recommendations/for-plan` answers: the proposals the voyage already has. */
  let existing: PlanProposals;

  beforeEach(() => {
    posts = [];
    existing = { purchaseOrder: null, voyageInstruction: null, instructionInForce: null };
    reply = () => json({ recommendationId: 7, created: true, status: "pending" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") !== "POST") {
          return String(input).startsWith("/api/recommendations/for-plan?")
            ? json(existing)
            : json({ error: "not_found" }, 404);
        }
        const body = JSON.parse(String(init?.body));
        posts.push({
          path: String(input),
          body,
          type: new Headers(init?.headers).get("content-type"),
        });
        return reply(body);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderTray = (plan: RoutePlanView = makeFuelPlan()) =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/?vessel=1"]}>
          <Routes>
            <Route path="*" element={<PlanSummary plan={plan} names={STOP_NAMES} />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  /** The buttons wait for what the voyage already has; then they can be clicked. */
  const ready = () =>
    waitFor(() => expect((instructionButton() as HTMLButtonElement).disabled).toBe(false));
  const orderButton = () => screen.queryByRole("button", { name: "Propose purchase order" });
  const instructionButton = () =>
    screen.getByRole("button", { name: "Propose voyage instruction" });

  /** A fleet vessel's plan that sails route C without a stop. */
  const routeOnly = () => {
    const plan = makeFuelPlan();
    const rec = plan.result.plan;
    if (!rec) throw new Error("the fixture has a recommended plan");
    return {
      ...plan,
      result: { ...plan.result, plan: { ...rec, kind: "route" as const, optionId: "C" } },
    };
  };

  it("a stop plan proposes the stop's purchase order and the voyage instruction", async () => {
    const plan = makeFuelPlan();
    renderTray(plan);
    await ready();
    fireEvent.click(orderButton() as HTMLElement);
    await waitFor(() => expect(posts).toHaveLength(1));
    fireEvent.click(instructionButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts).toEqual([
      {
        path: "/api/recommendations",
        body: {
          type: "purchase_order",
          calculationId: plan.calculationId,
          optionId: "MTMLA-kestrel",
        },
        type: "application/json",
      },
      {
        path: "/api/recommendations",
        body: {
          type: "voyage_instruction",
          calculationId: plan.calculationId,
          optionId: "MTMLA-kestrel",
        },
        type: "application/json",
      },
    ]);
  });

  it("a plan without a stop proposes the voyage instruction alone", async () => {
    const plan = routeOnly();
    renderTray(plan);
    expect(screen.getByTestId("plan-title").textContent).toMatch(/^Route C/);
    expect(orderButton()).toBeNull();
    await ready();
    fireEvent.click(instructionButton());
    await waitFor(() =>
      expect(posts.map((p) => p.body)).toEqual([
        { type: "voyage_instruction", calculationId: plan.calculationId, optionId: "C" },
      ]),
    );
  });

  it("proposes nothing on render, and offers nothing without a feasible plan", () => {
    renderTray();
    expect(posts).toEqual([]);
    cleanup();
    renderTray(makeFuelPlan({ infeasible: true }));
    expect(screen.queryByTestId("plan-propose")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Propose/ })).toBeNull();
  });

  it("the toast names the proposal and its action opens it on Approvals", async () => {
    const success = vi.spyOn(toast, "success");
    renderTray();
    await ready();
    fireEvent.click(orderButton() as HTMLElement);
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    const [title, options] = success.mock.calls[0] as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe("Proposal 7 is waiting for your decision");
    expect(options.description).toBe("Purchase order: nothing is ordered until you approve it.");
    expect(options.action.label).toBe("Review and decide");
    act(() => options.action.onClick());
    expect(screen.getByTestId("where").textContent).toBe("/approvals?recommendation=7");
  });

  it("says when the same proposal was already waiting", async () => {
    const success = vi.spyOn(toast, "success");
    reply = () => json({ recommendationId: 4, created: false, status: "pending" });
    renderTray();
    await ready();
    fireEvent.click(instructionButton());
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Proposal 4 was already waiting for your decision",
        expect.objectContaining({
          description: "Voyage instruction: nothing is sent until you approve it.",
        }),
      ),
    );
  });

  it("shows what the voyage already has instead of offering it again", async () => {
    existing = {
      purchaseOrder: { recommendationId: 2, status: "executed" },
      voyageInstruction: { recommendationId: 3, status: "pending" },
      instructionInForce: null,
    };
    renderTray();
    const order = await screen.findByTestId("plan-existing-purchase_order");
    expect(order.textContent).toContain("Purchase order: approved and carried out");
    expect(within(order).getByRole("link").getAttribute("href")).toBe(
      "/approvals?recommendation=2",
    );
    const instruction = screen.getByTestId("plan-existing-voyage_instruction");
    expect(instruction.textContent).toContain("Voyage instruction: waiting for your decision");
    expect(within(instruction).getByRole("link", { name: "Review and decide" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Propose/ })).toBeNull();
    expect(posts).toEqual([]);
  });

  it("says when a new instruction would replace the one in force", async () => {
    existing = {
      purchaseOrder: { recommendationId: 2, status: "executed" },
      voyageInstruction: null,
      instructionInForce: { recommendationId: 1, status: "executed" },
    };
    renderTray();
    expect(
      await screen.findByRole("button", { name: "Propose updated voyage instruction" }),
    ).toBeTruthy();
    expect(screen.getByTestId("plan-replaces").textContent).toContain("proposal 1");
    expect(orderButton()).toBeNull();
  });

  it("says so when the API answers with a proposal that was already decided", async () => {
    const success = vi.spyOn(toast, "success");
    reply = () => json({ recommendationId: 2, created: false, status: "executed" });
    renderTray();
    await ready();
    fireEvent.click(orderButton() as HTMLElement);
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "This purchase order already exists: proposal 2, approved and carried out",
        expect.objectContaining({ description: undefined }),
      ),
    );
  });

  it("a refusal shows the API's reason in the toast", async () => {
    const error = vi.spyOn(toast, "error");
    const reason = "Kestrel Marine Fuels at Marsaxlokk is not a feasible stop in this plan.";
    reply = () => json({ error: "not_proposable", message: reason }, 409);
    renderTray();
    await ready();
    fireEvent.click(orderButton() as HTMLElement);
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("The purchase order was not proposed", {
        description: reason,
      }),
    );
  });

  it("each button waits while its own request runs", async () => {
    let release: (r: Response) => void = () => {};
    reply = () => new Promise<Response>((resolve) => (release = resolve));
    renderTray();
    await ready();
    fireEvent.click(orderButton() as HTMLElement);
    await waitFor(() => expect((orderButton() as HTMLButtonElement).disabled).toBe(true));
    expect((instructionButton() as HTMLButtonElement).disabled).toBe(false);
    await act(async () => release(json({ recommendationId: 7, created: true, status: "pending" })));
    await waitFor(() => expect((orderButton() as HTMLButtonElement).disabled).toBe(false));
  });
});
