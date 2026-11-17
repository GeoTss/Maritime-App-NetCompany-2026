import { AgentToolName, type AskEvent } from "@pharos/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionButtons } from "@/components/primitives/approval-card";
import { DiffTable } from "@/components/primitives/diff-table";
import { ThinkingState } from "@/components/primitives/thinking-state";
import { TOOL_LABEL, ToolChips, toolCallsFromProgress } from "@/components/primitives/tool-chips";

afterEach(cleanup);

type Progress = Extract<AskEvent, { type: "progress" }>;
const p = (callId: string, tool: Progress["tool"], phase: Progress["phase"], ms = 0): Progress => ({
  type: "progress",
  callId,
  tool,
  phase,
  ms,
});

describe("toolCallsFromProgress", () => {
  it("chips pair by call id: two calls of one tool, the first failing", () => {
    const calls = toolCallsFromProgress([
      p("a", "list_quotes", "started"),
      p("b", "list_quotes", "started"),
      p("b", "list_quotes", "finished", 40),
      p("a", "list_quotes", "failed", 12),
    ]);
    expect(calls).toEqual([
      { id: "a", tool: "list_quotes", state: "failed", ms: 12 },
      { id: "b", tool: "list_quotes", state: "done", ms: 40 },
    ]);
  });

  it("leaves a call running until its own call id closes it", () => {
    const calls = toolCallsFromProgress([
      p("a", "plan_bunkering", "started"),
      p("b", "list_quotes", "started"),
      p("b", "list_quotes", "finished", 5),
    ]);
    expect(calls.map((c) => [c.id, c.state])).toEqual([
      ["a", "running"],
      ["b", "done"],
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
          { id: "2", tool: "list_quotes", state: "failed", ms: 9 },
        ]}
      />,
    );
    expect(screen.getByText("Bunker plan")).toBeTruthy();
    expect(screen.getByText("plan_bunkering")).toBeTruthy();
    expect(screen.getByText("310 ms")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
  });

  it("failed chip reads failed", () => {
    render(<ToolChips calls={[{ id: "x", tool: "list_quotes", state: "failed", ms: 9 }]} />);
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("a call cut short by a failed ask reads stopped", () => {
    render(<ToolChips calls={[{ id: "x", tool: "list_quotes", state: "stopped", ms: null }]} />);
    expect(screen.getByText("stopped")).toBeTruthy();
    expect(screen.queryByText("failed")).toBeNull();
    expect(screen.queryByText("done")).toBeNull();
  });

  it("every agent tool has a label", () => {
    for (const tool of AgentToolName.options) expect(TOOL_LABEL[tool]).toBeTruthy();
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

  it("names its triggers as given, Reject before Approve", () => {
    render(
      <DecisionButtons
        onApprove={vi.fn()}
        onReject={vi.fn()}
        approveConsequence="x"
        rejectConsequence="y"
        approveLabel="Approve purchase order…"
        rejectLabel="Reject…"
      />,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Reject…",
      "Approve purchase order…",
    ]);
  });
});
