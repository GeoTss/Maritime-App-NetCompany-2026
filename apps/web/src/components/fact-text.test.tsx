import type { Fact } from "@pharos/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactChip } from "@/components/fact-chip";
import { FactText, parseFactText } from "@/components/fact-text";

afterEach(cleanup);

const price: Fact = {
  id: "f_q1_price",
  label: "Aegean Bunkers VLSFO price at Piraeus",
  value: 612.5,
  unit: "USD/mt",
  provenance: { source: "db", table: "quote_lines", rowId: 12, field: "price_per_mt" },
};
const qty: Fact = {
  id: "f_req_vlsfo",
  label: "VLSFO to buy",
  value: 1500,
  unit: "mt",
  provenance: {
    source: "calculation",
    calculationId: 9,
    calculator: "bunker_planner",
    path: "requirements[0].qtyMt",
  },
};
const saving: Fact = {
  id: "f_saving",
  label: "Saving against Algeciras",
  value: 18250,
  unit: "USD",
  provenance: { source: "derived", operation: "difference", operands: ["f_q1_price", "f_gone"] },
};

const renderText = (text: string, facts: Fact[], onUnknownIds?: (ids: string[]) => void) =>
  render(
    <MemoryRouter>
      <FactText text={text} facts={facts} onUnknownIds={onUnknownIds} />
    </MemoryRouter>,
  );

describe("FactText", () => {
  // Untouched except for the one documented display form: ISO instants (next test).
  it("FactText leaves the written number untouched and attaches the chip", () => {
    const { container } = renderText(
      "Buy 1,500 mt [f_req_vlsfo] at $612.50/mt [f_q1_price] from Aegean Bunkers.",
      [price, qty],
    );
    // The model's own digits stay exactly as written; the markers are gone.
    expect(container.textContent).toBe("Buy 1,500 mt at $612.50/mt from Aegean Bunkers.");
    const chips = screen.getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["1,500 mt", "$612.50/mt"]);
    expect(chips[1]?.getAttribute("data-fact-id")).toBe("f_q1_price");
  });

  // The one documented display form (Ruling 27): an ISO instant is one whole chip, shown in the
  // desk's short UTC form, with the full value in its popover. Every other number stays as written.
  it("an ISO instant is one chip, shown as 26 Nov 15:01Z, with the full value in the popover", () => {
    const eta: Fact = {
      id: "f_plan_route_speed_5_options.1.eta",
      label: "MV Aegean Pioneer, route B: ETA at Rotterdam (UTC)",
      value: "2026-11-26T15:01:46.466Z",
      unit: null,
      provenance: {
        source: "calculation",
        calculationId: 5,
        calculator: "route_speed",
        path: "options[1].eta",
      },
    };
    const { container } = renderText(
      "arrives at Rotterdam at 2026-11-26T15:01:46.466Z [f_plan_route_speed_5_options.1.eta]",
      [eta],
    );
    expect(container.textContent).toBe("arrives at Rotterdam at 26 Nov 15:01Z");
    const chips = screen.getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["26 Nov 15:01Z"]);
    fireEvent.click(chips[0] as HTMLElement);
    expect(screen.getByRole("dialog").textContent).toContain("2026-11-26T15:01:46.466Z");
    const { parts } = parseFactText(
      "arrives at Rotterdam at 2026-11-26T15:01:46.466Z [f_plan_route_speed_5_options.1.eta]",
      [eta],
    );
    expect(parts).toEqual([
      { kind: "text", text: "arrives at Rotterdam at " },
      { kind: "fact", written: "2026-11-26T15:01:46.466Z", facts: [eta], unknownIds: [] },
    ]);
  });

  it("a chip whose fact value is an ISO instant shows the short form, and the popover the full one", () => {
    const eta: Fact = {
      id: "f_eta",
      label: "ETA at Rotterdam (UTC)",
      value: "2026-11-26T15:01:46.466Z",
      unit: null,
      provenance: {
        source: "calculation",
        calculationId: 5,
        calculator: "route_speed",
        path: "eta",
      },
    };
    render(
      <MemoryRouter>
        <FactChip fact={eta} />
      </MemoryRouter>,
    );
    const chip = screen.getByRole("button");
    expect(chip.textContent).toBe("26 Nov 15:01Z");
    fireEvent.click(chip);
    expect(screen.getByRole("dialog").textContent).toContain("2026-11-26T15:01:46.466Z");
  });

  it("opens the chip's source: label, value and unit as returned, and the database row", () => {
    renderText("Buy at $612.50/mt [f_q1_price].", [price]);
    fireEvent.click(screen.getByRole("button", { name: /612\.50/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Aegean Bunkers VLSFO price at Piraeus");
    expect(dialog.textContent).toContain("612.5");
    expect(dialog.textContent).toContain("USD/mt");
    expect(dialog.textContent).toContain("quote_lines");
    expect(dialog.textContent).toContain("price_per_mt");
    expect(dialog.textContent).toContain("12");
  });

  it("an unknown id renders as plain text and is counted", () => {
    const onUnknown = vi.fn();
    const { container } = renderText("Wait 14 h [f_missing] at anchor.", [price], onUnknown);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toContain("14 h");
    expect(container.textContent).toContain("[f_missing]");
    expect(onUnknown).toHaveBeenCalledWith(["f_missing"]);
    expect(
      container.querySelector("[data-unknown-facts]")?.getAttribute("data-unknown-facts"),
    ).toBe("1");
  });

  it("a derived fact shows its operands as nested chips, and names one it cannot find", () => {
    renderText("You save $18,250 [f_saving].", [price, saving]);
    fireEvent.click(screen.getByRole("button", { name: /18,250/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Difference");
    const nested = dialog.querySelector('[data-fact-id="f_q1_price"]');
    expect(nested).not.toBeNull();
    expect(dialog.textContent).toContain("f_gone");
  });

  it("a citation with no number before it still gets a chip", () => {
    renderText("Route B [f_q1_price] is recommended.", [price]);
    expect(screen.getByRole("button", { name: /source/i })).toBeTruthy();
  });
});

describe("parseFactText", () => {
  it("splits text, chips and unknowns without touching the text between them", () => {
    const { parts, unknownIds } = parseFactText("A $612.50/mt [f_q1_price, f_x] b.", [price]);
    expect(unknownIds).toEqual(["f_x"]);
    expect(parts).toEqual([
      { kind: "text", text: "A " },
      { kind: "fact", written: "$612.50/mt", facts: [price], unknownIds: ["f_x"] },
      { kind: "text", text: " b." },
    ]);
  });
});
