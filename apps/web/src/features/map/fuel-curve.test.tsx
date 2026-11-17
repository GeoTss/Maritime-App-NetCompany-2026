import { cleanup, render, screen, within } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { curveSeries, curveTracks, FuelCurve, gradesBurned } from "./fuel-curve";
import { makeFuelPlan, makePlan } from "./map-fixtures";

// happy-dom lays nothing out, so a responsive chart measures 0 by 0 and draws nothing: give it a
// fixed size so the drawing can be inspected.
vi.mock("recharts", async (original) => {
  const actual = await original<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ width: number; height: number }>, {
            width: 400,
            height: 128,
          })
        : null,
  };
});

afterEach(cleanup);

const renderCurve = (plan = makeFuelPlan()) =>
  render(
    <MemoryRouter>
      <FuelCurve plan={plan} />
    </MemoryRouter>,
  );

describe("FuelCurve", () => {
  it("draws one chart per grade burned, the recommended plan and the fuel-blind best", () => {
    const plan = makeFuelPlan();
    const tracks = curveTracks(plan);
    expect(tracks.map((t) => t.key)).toEqual(["plan", "best"]);
    expect(gradesBurned(tracks)).toEqual(["LSMGO", "VLSFO"]);
    // The stop's jump is in the drawn data: arrival and departure at one distance.
    const stop = tracks[0]?.fuel.breakpoints.filter((b) => b.kind.startsWith("stop_")) ?? [];
    expect(stop.map((b) => [b.nm, b.robMt.LSMGO])).toEqual([
      [1020, 82],
      [1020, 381],
    ]);
    renderCurve(plan);
    expect(screen.getByTestId("fuel-curve-LSMGO")).toBeTruthy();
    expect(screen.getByTestId("fuel-curve-VLSFO")).toBeTruthy();
    expect(screen.queryByTestId("fuel-curve-HSFO")).toBeNull();
    const legend = screen.getByTestId("fuel-curve").textContent ?? "";
    expect(legend).toContain("Recommended plan");
    expect(legend).toContain("Best route ignoring fuel on board");
    expect(legend).toContain("safety margin");
    expect(legend).toContain("first below the margin");
  });

  it("prints only the cited margin: no other number but axis ticks", () => {
    renderCurve();
    const chart = screen.getByTestId("fuel-curve-LSMGO");
    const caption = chart.querySelector("figcaption") as HTMLElement;
    expect(
      within(caption).getByTestId("cell-margin-LSMGO").querySelector("[data-slot=fact-chip]"),
    ).not.toBeNull();
    // The drawing is there: two lines (the plan and the best route ignoring fuel), the margin.
    expect(chart.querySelectorAll(".recharts-line-curve")).toHaveLength(2);
    expect(chart.querySelectorAll(".recharts-reference-line")).toHaveLength(1);
    expect(chart.querySelectorAll(".recharts-reference-dot")).toHaveLength(1);
    const svgText = [...chart.querySelectorAll("svg text")];
    expect(svgText.length).toBeGreaterThan(0);
    expect(svgText.every((t) => t.classList.contains("recharts-cartesian-axis-tick-value"))).toBe(
      true,
    );
  });

  it("draws the stop's jump as a vertical step on the bought grade", () => {
    renderCurve();
    const lsmgo = screen.getByTestId("fuel-curve-LSMGO");
    const plan = lsmgo.querySelectorAll(".recharts-line-curve")[0];
    // A straight path through the breakpoints: two consecutive points share the stop's x.
    const xs = [...(plan?.getAttribute("d") ?? "").matchAll(/[ML]([\d.]+),/g)].map((m) => m[1]);
    expect(xs).toHaveLength(5);
    expect(xs[2]).toBe(xs[3]);
  });

  it("never animates", () => {
    const series = curveSeries(curveTracks(makeFuelPlan()));
    expect(series.length).toBe(2);
    expect(series.every((s) => s.isAnimationActive === false)).toBe(true);
    renderCurve();
    // The drawing itself: no animation or transition anywhere in it (chips beside it may fade).
    for (const drawing of screen.getAllByRole("img")) {
      expect(drawing.querySelector("[class*=animate], [class*=transition]")).toBeNull();
    }
    expect(document.querySelector("number-flow-react")).toBeNull();
  });

  it("draws the fuel-blind best in alarm when it runs short", () => {
    const [plan, best] = curveSeries(curveTracks(makeFuelPlan()));
    expect(plan?.stroke).toBe("var(--beacon)");
    expect(best?.stroke).toBe("var(--alarm)");
  });

  it("with no recommended plan draws the fuel-blind best alone", () => {
    expect(curveTracks(makeFuelPlan({ infeasible: true })).map((t) => t.key)).toEqual(["best"]);
  });

  it("draws nothing for a ship seen on AIS", () => {
    const { container } = renderCurve(makePlan());
    expect(container.textContent).toBe("");
  });
});
