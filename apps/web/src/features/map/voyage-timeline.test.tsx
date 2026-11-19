import type { RoutePlanView } from "@pharos/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFuelPlan } from "./map-fixtures";
import { VoyageTimelineSection } from "./voyage-timeline";

afterEach(cleanup);

const plan = () => makeFuelPlan({ portCall: true, timeline: true });
const renderSection = (p: RoutePlanView = plan()) => render(<VoyageTimelineSection plan={p} />);
const rows = (kindPrefix: string) =>
  screen.queryAllByTestId(/^timeline-event-/).filter((r) => r.dataset.kind?.startsWith(kindPrefix));

describe("VoyageTimelineSection", () => {
  it("toggle hides a group", () => {
    renderSection();
    expect(rows("sewage_window")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Sewage discharge" }));
    expect(rows("sewage_window")).toHaveLength(0);
    expect(rows("port_arrival")).toHaveLength(1);
    expect(rows("eca_")).toHaveLength(2);
  });

  it("port arrival lists its actions and expands", () => {
    renderSection();
    const [arrival] = rows("port_arrival");
    if (!arrival) throw new Error("no port arrival row");
    expect(arrival.textContent).toContain(
      "Bunkers, provisions, charts and publications, port dues",
    );
    fireEvent.click(within(arrival).getByRole("button", { name: /what the call does/i }));
    expect(within(arrival).getByTestId("port-call")).toBeTruthy();
    expect(within(arrival).getByTestId("timeline-bunkers").textContent).toMatch(/300/);
  });

  it("no number without a fact", () => {
    const p = plan();
    const timeline = p.timeline;
    if (!timeline) throw new Error("no timeline");
    const withoutWindow = {
      ...p,
      timeline: { ...timeline, facts: timeline.facts.filter((f) => !f.id.endsWith("events.2.at")) },
    };
    renderSection(withoutWindow);
    const [open] = rows("sewage_window_open");
    expect(within(open as HTMLElement).getByTestId("timeline-at").textContent).toBe("—");
    // Its hours still come from their own fact.
    expect(open?.textContent).toMatch(/30\.5/);
  });

  it("a plan without a timeline says so", () => {
    renderSection(makeFuelPlan({ portCall: true }));
    expect(screen.getByText("No timeline for this plan.")).toBeTruthy();
  });
});
