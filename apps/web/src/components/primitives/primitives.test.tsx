import type { AskEvent } from "@pharos/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionButtons } from "@/components/primitives/approval-card";
import { DiffTable } from "@/components/primitives/diff-table";
import { ThinkingState } from "@/components/primitives/thinking-state";
import { ToolChips, toolCallsFromProgress } from "@/components/primitives/tool-chips";

afterEach(cleanup);

type Progress = Extract<AskEvent, { type: "progress" }>;
const p = (tool: Progress["tool"], phase: "started" | "finished", ms = 0): Progress => ({
  type: "progress",
  callId: `call-${tool}`,
  tool,
  phase,
  ms,
});

describe("toolCallsFromProgress", () => {
  it("pairs each finish with the earliest open start of the same tool", () => {
    const calls = toolCallsFromProgress([
      p("list_quotes", "started"),
      p("plan_bunkering", "started"),
      p("list_quotes", "started"),
      p("list_quotes", "finished", 40),
      p("plan_bunkering", "finished", 310),
    ]);
    expect(calls).toEqual([
      { id: "0", tool: "list_quotes", state: "done", ms: 40 },
      { id: "1", tool: "plan_bunkering", state: "done", ms: 310 },
      { id: "2", tool: "list_quotes", state: "running", ms: null },
    ]);
  });
});

describe("ToolChips", () => {
  it("names each tool in words, with its id and the time the API reported", () => {
    render(
      <ToolChips
        calls={[
          { id: "0", tool: "plan_bunkering", state: "done", ms: 310 },
          { id: "1", tool: "get_port_congestion", state: "running", ms: null },
        ]}
      />,
    );
    expect(screen.getByText("Bunker plan")).toBeTruthy();
    expect(screen.getByText("plan_bunkering")).toBeTruthy();
    expect(screen.getByText("310 ms")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
  });
});

describe("ThinkingState", () => {
  it("announces the working state and the settled state", () => {
    const { rerender } = render(<ThinkingState status="working">trace</ThinkingState>);
    expect(screen.getByRole("status").textContent).toContain("Working");
    rerender(<ThinkingState status="done">trace</ThinkingState>);
    expect(screen.getByRole("status").textContent).toContain("Done");
  });
});

describe("DiffTable", () => {
  it("shows both sides and marks the rows that change", () => {
    const { container } = render(
      <DiffTable
        beforeLabel="As written"
        afterLabel="Corrected"
        rows={[
          { key: "qty", label: "Quantity", before: "300/350 mt", after: "350 mt" },
          { key: "grade", label: "Grade", before: "VLSFO", after: "VLSFO" },
        ]}
      />,
    );
    const changed = container.querySelectorAll('[data-changed="true"]');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.textContent).toContain("300/350 mt");
    expect(changed[0]?.textContent).toContain("350 mt");
  });
});

describe("DecisionButtons", () => {
  it("approve runs only after the confirmation that says what will happen", async () => {
    const onApprove = vi.fn(async () => undefined);
    render(
      <DecisionButtons
        onApprove={onApprove}
        onReject={vi.fn()}
        approveConsequence="Writes purchase order and pushes it to the ERP simulator."
        rejectConsequence="Marks the proposal rejected. Nothing is ordered."
        confirmApproveLabel="Approve and push"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("pushes it to the ERP simulator");
    fireEvent.click(screen.getByRole("button", { name: "Approve and push" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
  });

  it("is single-flight: while a decision is pending both buttons are disabled", () => {
    render(
      <DecisionButtons
        pending="approve"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        approveConsequence="x"
        rejectConsequence="y"
      />,
    );
    expect(screen.getByRole("button", { name: /Approving/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled")).toBe(true);
  });
});
