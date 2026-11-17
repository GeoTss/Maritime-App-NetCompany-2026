import type { RecommendationDependency, RecommendationView } from "@pharos/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approveHeld, DependencyLine, orderToPropose } from "./dependency-line";

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
  ({
    status,
    dependsOn,
    type: "voyage_instruction",
    calculationId: 5,
    optionId: "MTMLA-kestrel",
  }) as RecommendationView;

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

describe("orderToPropose", () => {
  it("proposes the stop's order from the instruction's own plan while no order is live", () => {
    const body = {
      type: "purchase_order",
      calculationId: 5,
      optionId: "MTMLA-kestrel",
    };
    expect(orderToPropose(rec("pending", dep({ recommendationId: null, status: null })))).toEqual(
      body,
    );
    expect(orderToPropose(rec("pending", dep({ status: "rejected" })))).toEqual(body);
  });

  it("proposes nothing while an order is live, once it is approved, or for a decided instruction", () => {
    expect(orderToPropose(rec("pending", dep()))).toBeNull();
    expect(orderToPropose(rec("pending", dep({ status: "approved", satisfied: true })))).toBeNull();
    expect(orderToPropose(rec("pending", null))).toBeNull();
    expect(
      orderToPropose(rec("rejected", dep({ recommendationId: null, status: null }))),
    ).toBeNull();
  });
});

describe("DependencyLine", () => {
  it("offers to propose the order only when asked to, and waits while it runs", () => {
    const onPropose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <DependencyLine dep={dep({ recommendationId: null, status: null })} />
      </MemoryRouter>,
    );
    const line = screen.getByTestId("dependency-line");
    expect(within(line).queryByRole("button")).toBeNull();
    rerender(
      <MemoryRouter>
        <DependencyLine
          dep={dep({ recommendationId: null, status: null })}
          propose={{ onPropose, pending: false }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(within(line).getByRole("button", { name: "Propose the purchase order" }));
    expect(onPropose).toHaveBeenCalledTimes(1);
    rerender(
      <MemoryRouter>
        <DependencyLine
          dep={dep({ recommendationId: null, status: null })}
          propose={{ onPropose, pending: true }}
        />
      </MemoryRouter>,
    );
    const button = within(line).getByRole("button", { name: "Propose the purchase order" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

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
