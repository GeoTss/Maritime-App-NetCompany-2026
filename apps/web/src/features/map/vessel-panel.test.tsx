import type { TrackFuel } from "@pharos/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VESSEL_DETAIL } from "./map-fixtures";
import { alertText, CurrentPlanFuel, shortText } from "./vessel-panel";

// happy-dom lays nothing out, so a responsive chart measures 0 by 0 and draws nothing: give it a
// fixed size so the drawing can be inspected.
vi.mock("recharts", async (original) => {
  const actual = await original<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ width: number; height: number }>, {
            width: 320,
            height: 96,
          })
        : null,
  };
});

afterEach(cleanup);

const track = VESSEL_DETAIL.fuelTrack as TrackFuel;

describe("vessel alert copy", () => {
  it("words each known alert flag", () => {
    expect(alertText("lsmgo_below_margin_for_eca")).toMatch(/below the safety margin/);
    expect(alertText("lsmgo_runs_out")).toBe("LSMGO runs out before arrival at the planned speed");
  });

  it("makes an unknown flag readable", () => {
    expect(alertText("some_new_flag")).toBe("Some new flag");
  });
});

describe("fuel on board along the current plan", () => {
  it("says where along the plan a grade falls below its margin and runs out, as returned", () => {
    expect(shortText("LSMGO", track)).toBe(
      "LSMGO falls below its margin 1,562 nm along the current plan and runs out at 3,111 nm.",
    );
    expect(shortText("VLSFO", track)).toBeNull();
    const lsmgo = track.grades.LSMGO;
    const belowOnly: TrackFuel = {
      ...track,
      grades: { ...track.grades, LSMGO: { ...lsmgo, runsDryAt: null } },
    };
    expect(shortText("LSMGO", belowOnly)).toBe(
      "LSMGO falls below its margin 1,562 nm along the current plan.",
    );
  });

  it("draws one chart per grade burned, from the track's breakpoints, with no leg wording", () => {
    render(<CurrentPlanFuel fuel={track} />);
    expect(screen.getByTestId("plan-fuel-LSMGO")).toBeTruthy();
    expect(screen.getByTestId("plan-fuel-VLSFO")).toBeTruthy();
    expect(screen.queryByTestId("plan-fuel-HSFO")).toBeNull();
    const all = screen.getByTestId("current-plan-fuel");
    expect(all.textContent).not.toMatch(/\bleg\b/i);
    expect(screen.getByTestId("plan-fuel-short").textContent).toBe(
      "LSMGO falls below its margin 1,562 nm along the current plan and runs out at 3,111 nm.",
    );
    expect(all.textContent).toContain("safety margin");
    expect(all.textContent).toContain("first below the margin");

    const lsmgo = screen.getByTestId("plan-fuel-LSMGO");
    // One line straight through the four breakpoints, the empty-tank and margin lines (LSMGO runs
    // dry) and the first-below dot.
    const line = lsmgo.querySelectorAll(".recharts-line-curve");
    expect(line).toHaveLength(1);
    expect([...(line[0]?.getAttribute("d") ?? "").matchAll(/[ML][\d.-]+,[\d.-]+/g)]).toHaveLength(
      4,
    );
    expect(lsmgo.querySelectorAll(".recharts-reference-line")).toHaveLength(2);
    expect(lsmgo.querySelectorAll(".recharts-reference-dot")).toHaveLength(1);
    // VLSFO keeps its margin: the margin line, no dot.
    const vlsfo = screen.getByTestId("plan-fuel-VLSFO");
    expect(vlsfo.querySelectorAll(".recharts-reference-line")).toHaveLength(1);
    expect(vlsfo.querySelectorAll(".recharts-reference-dot")).toHaveLength(0);
  });

  it("prints no number on the drawing but axis ticks, and never animates", () => {
    render(<CurrentPlanFuel fuel={track} />);
    for (const drawing of screen.getAllByRole("img")) {
      const svgText = [...drawing.querySelectorAll("svg text")];
      expect(svgText.length).toBeGreaterThan(0);
      expect(svgText.every((t) => t.classList.contains("recharts-cartesian-axis-tick-value"))).toBe(
        true,
      );
      expect(drawing.querySelector("[class*=animate], [class*=transition]")).toBeNull();
    }
    expect(document.querySelector("number-flow-react")).toBeNull();
  });

  it("says every grade keeps its margin when none falls below it", () => {
    const keeps: TrackFuel = {
      ...track,
      grades: {
        ...track.grades,
        LSMGO: { ...track.grades.LSMGO, belowMarginAt: null, runsDryAt: null, shortfallMt: 0 },
      },
      keepsMargins: true,
    };
    render(<CurrentPlanFuel fuel={keeps} />);
    expect(screen.queryByTestId("plan-fuel-short")).toBeNull();
    expect(screen.getByTestId("current-plan-fuel").textContent).toContain(
      "Every grade keeps its safety margin to the destination.",
    );
    expect(screen.getByTestId("current-plan-fuel").textContent).not.toContain(
      "first below the margin",
    );
  });
});
