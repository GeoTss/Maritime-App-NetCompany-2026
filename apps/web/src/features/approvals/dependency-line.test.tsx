import type { RecommendationDependency, RecommendationView } from "@pharos/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { approveHeld, DependencyLine } from "./dependency-line";

afterEach(cleanup);

const dep = (over: Partial<RecommendationDependency> = {}): RecommendationDependency => ({
  quoteId: 11,
  optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
  recommendationId: 4,
  status: "pending",
  satisfied: false,
  ...over,
});

const rec = (status: RecommendationView["status"], dependsOn: RecommendationDependency | null) =>
  ({ status, dependsOn }) as RecommendationView;

describe("approveHeld", () => {
  it("holds Approve only on a pending proposal whose order is not approved", () => {
    expect(approveHeld(rec("pending", dep()))?.blocked).toBe(false);
    expect(approveHeld(rec("pending", dep({ status: "approved", satisfied: true })))).toBeNull();
    expect(approveHeld(rec("pending", null))).toBeNull();
    expect(approveHeld(rec("rejected", dep()))).toBeNull();
  });

  it("calls a rejected or failed order blocked", () => {
    expect(approveHeld(rec("pending", dep({ status: "rejected" })))).toEqual({
      text: "Blocked: its purchase order (proposal 4) was rejected. Only Reject is open.",
      blocked: true,
    });
    expect(approveHeld(rec("pending", dep({ status: "failed" })))?.text).toMatch(/not executed/);
  });
});

describe("DependencyLine", () => {
  it("renders the order's label as text, never markup", () => {
    render(
      <MemoryRouter>
        <DependencyLine dep={dep({ optionLabel: "<b>Kestrel</b> at Marsaxlokk" })} />
      </MemoryRouter>,
    );
    const line = screen.getByTestId("dependency-line");
    expect(line.textContent).toContain("<b>Kestrel</b> at Marsaxlokk");
    expect(line.querySelector("b")).toBeNull();
  });
});
