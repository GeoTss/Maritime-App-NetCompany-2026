import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { makePlan } from "./map-fixtures";
import { RouteComparison } from "./route-tray";

afterEach(cleanup);

const renderComparison = (plan = makePlan()) =>
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
