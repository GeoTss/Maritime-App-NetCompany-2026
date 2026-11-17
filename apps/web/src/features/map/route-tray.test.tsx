import type { RoutePlanView } from "@pharos/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { makeFuelPlan, makePlan } from "./map-fixtures";
import { RouteComparison, RouteTray } from "./route-tray";

afterEach(cleanup);

const renderComparison = (plan: RoutePlanView = makePlan()) =>
  render(
    <MemoryRouter>
      <RouteComparison plan={plan} />
    </MemoryRouter>,
  );

const rowFor = (id: string) => {
  const row = screen.getByTestId(`route-row-${id}`);
  return within(row);
};

describe("RouteComparison", () => {
  it("route numbers come only from facts", () => {
    // Route C's total cost is still in `result.options[2]` (439075), but its fact is gone.
    const plan = makePlan({ omitFact: (f) => f.id === "f_plan_options.2.totalCostUsd" });
    renderComparison(plan);
    const c = rowFor("C");
    expect(c.getByTestId("cell-totalCostUsd").textContent).toBe("—");
    expect(screen.queryByText(/439,?075/)).toBeNull();
    // The same column on route B still has its fact as a chip.
    const b = rowFor("B");
    expect(b.getByTestId("cell-totalCostUsd").textContent).toMatch(/405,103/);
    expect(b.getByTestId("cell-totalCostUsd").querySelector("button")).not.toBeNull();
  });

  it("an infeasible route shows its reason", () => {
    renderComparison();
    const a = rowFor("A");
    expect(a.getByText("Blocked: crosses the reported hazard")).toBeTruthy();
    expect(screen.queryByText(/infeasible/i)).toBeNull();
    expect(screen.getByTestId("route-row-baseline").textContent).toMatch(
      /Current plan \(route [A-Z] at [\d.]+ kn\)/,
    );
    expect(screen.getByTestId("route-row-A").getAttribute("data-feasible")).toBe("false");
    expect(screen.getByTestId("route-row-B").getAttribute("data-feasible")).toBe("true");
  });

  it("marks the recommended route and writes the facts' own digits", () => {
    renderComparison();
    expect(rowFor("B").getByText("Recommended")).toBeTruthy();
    expect(rowFor("C").queryByText("Recommended")).toBeNull();
    expect(rowFor("B").getByTestId("cell-speedKn").textContent).toMatch(/11(\.0+)? kn/);
  });

  it("shows the saving only as the fact the API returned", () => {
    renderComparison();
    expect(screen.getByTestId("plan-saving").textContent).toMatch(/48,02[45]/);
    cleanup();
    renderComparison(makePlan({ omitFact: (f) => f.id === "f_plan_savingVsBaselineUsd" }));
    expect(screen.getByTestId("plan-saving").textContent).toBe("—");
  });

  it("shows load only from the plan's facts", () => {
    renderComparison();
    expect(screen.getByTestId("plan-load").textContent).toMatch(/65,000/);
    cleanup();
    renderComparison(makePlan({ omitFact: (f) => f.id === "f_plan_displacement" }));
    expect(within(screen.getByTestId("plan-load")).getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("RouteComparison with the fuel on board", () => {
  it("marks the best route ignoring fuel as blocked when it runs short", () => {
    renderComparison(makeFuelPlan());
    const best = screen.getByTestId("fuel-blind-best-summary");
    expect(best.textContent).toMatch(/^Best route ignoring fuel on board/);
    expect(within(best).getByRole("heading").textContent).toBe("Route B, Shortest sea route");
    const short = within(best).getByTestId("runs-short-LSMGO");
    const words = within(short).getByText("Runs short of LSMGO");
    expect(words.className).toMatch(/\btext-alarm\b/);
    expect(words.querySelector("[data-flag=V]")?.getAttribute("aria-hidden")).toBe("true");
    const nm = within(short).getByTestId("cell-short-LSMGO-nm");
    expect(nm.querySelector("[data-slot=fact-chip]")?.getAttribute("data-fact-id")).toBe(
      "f_plan_options.1.fuel.grades.LSMGO.belowMarginAt.nm",
    );
    expect(nm.textContent).toBe("2,511 nm");
    // In the table, the same route is ruled out for its fuel and named as the fuel-blind best.
    const row = rowFor("B");
    expect(row.getByText("Blocked: runs below the fuel margin")).toBeTruthy();
    expect(row.getByTestId("fuel-blind-best")).toBeTruthy();
    expect(screen.getByTestId("route-row-B").getAttribute("data-role")).toBe("infeasible");
  });

  it("leads with the recommended plan, then the fuel curve, then every route", () => {
    renderComparison(makeFuelPlan());
    const plan = screen.getByTestId("plan-summary");
    const curve = screen.getByTestId("fuel-curve");
    const table = screen.getByTestId("route-row-A");
    expect(plan.compareDocumentPosition(curve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(curve.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No route row is recommended when the plan calls at a bunker port.
    for (const id of ["A", "B", "C"]) {
      expect(screen.getByTestId(`route-row-${id}`).getAttribute("data-role")).not.toBe(
        "recommended",
      );
    }
  });

  it("a ship seen on AIS gets the routes alone", () => {
    renderComparison(makePlan());
    expect(screen.queryByTestId("plan-summary")).toBeNull();
    expect(screen.queryByTestId("fuel-curve")).toBeNull();
    expect(screen.queryByTestId("fuel-blind-best")).toBeNull();
  });
});

describe("RouteTray", () => {
  it("runs non-modal: the rest of the page is not hidden from assistive tech", () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(
      <MemoryRouter>
        <header>Status</header>
        <main id="screen" />
        <aside aria-label="Assistant" />
        <RouteTray
          plan={makePlan()}
          container={host}
          snap={0.4}
          onSnapChange={() => {}}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
    for (const el of document.querySelectorAll("header, main, aside, body > div")) {
      expect(el.getAttribute("aria-hidden"), el.outerHTML.slice(0, 120)).not.toBe("true");
    }
    host.remove();
  });
});
