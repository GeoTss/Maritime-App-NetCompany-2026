import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { makeFuelPlan, makePlan, STOP_NAMES } from "./map-fixtures";
import { FuelBlindBest, PlanSummary } from "./plan-summary";

afterEach(cleanup);

const renderSummary = (plan = makeFuelPlan(), names = STOP_NAMES) =>
  render(
    <MemoryRouter>
      <PlanSummary plan={plan} names={names} />
      <FuelBlindBest plan={plan} />
    </MemoryRouter>,
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
