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

  it("a route crossing where a storm was, after it ended, is told so", () => {
    const p = plan();
    const timeline = p.timeline;
    if (!timeline) throw new Error("no timeline");
    const events = timeline.events.map((e) =>
      e.kind === "storm_passed" ? { ...e, timing: "after" as const } : e,
    );
    renderSection({ ...p, timeline: { ...timeline, events } });
    const [storm] = rows("storm_passed");
    expect(storm?.textContent).toMatch(/Passes where a storm was: it ended 24 Nov 05:00Z/);
  });

  it("a click anywhere on a row picks it and marks it", () => {
    const picked: number[] = [];
    // Inside a dialog, as the route tray is.
    const inTray = (selected: number | null) => (
      <div role="dialog">
        <VoyageTimelineSection plan={plan()} onSelect={(i) => picked.push(i)} selected={selected} />
      </div>
    );
    const { rerender } = render(inTray(null));
    const [eca] = rows("eca_entry");
    fireEvent.click(within(eca as HTMLElement).getByText(/In a sulphur ECA/));
    expect(picked).toEqual([1]);
    rerender(inTray(1));
    expect(rows("eca_entry")[0]?.getAttribute("aria-current")).toBe("true");
  });

  it("a restock at the call is stated, with its quantity and the days it leaves", () => {
    const p = plan();
    const timeline = p.timeline;
    if (!timeline) throw new Error("no timeline");
    const arrival = timeline.events.find((e) => e.kind === "port_arrival");
    if (!arrival || arrival.kind !== "port_arrival") throw new Error("no call");
    const restock = {
      kind: "provisions_restock" as const,
      at: arrival.at,
      position: arrival.position,
      alongNm: arrival.alongNm,
      stopIndex: 0,
      unlocode: "MTMLA",
      jobIndex: 0,
    };
    renderSection({ ...p, timeline: { ...timeline, events: [...timeline.events, restock] } });
    const [row] = rows("provisions_restock");
    expect(row?.textContent).toMatch(/Restocks provisions: 1,115\.75 person-days/);
    expect(row?.textContent).toMatch(/51\.6 days left at the destination/);
  });
});
