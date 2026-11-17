/** The run so far: the agent's tool calls with their timings (no answer text exists yet). */
import { ThinkingState } from "@/components/primitives/thinking-state";
import {
  failRunning,
  TOOL_LABEL,
  type ToolCall,
  ToolChips,
  toolCallsFromProgress,
} from "@/components/primitives/tool-chips";
import type { Turn } from "./assistant-store";

/** "Ran Bunker plan, Proposal for approval": each tool's label once, in the order first called. */
export function ranLabel(calls: ToolCall[]): string {
  const labels = [...new Set(calls.map((c) => TOOL_LABEL[c.tool]))];
  return `Ran ${labels.join(", ")}`;
}

export function ProgressTrace({ turn }: { turn: Turn }) {
  const raw = toolCallsFromProgress(turn.progress);
  const calls = turn.status === "failed" ? failRunning(raw) : raw;
  const n = calls.length;
  const label =
    turn.status === "working"
      ? n === 0
        ? "Working"
        : `Working, ${n} ${n === 1 ? "tool" : "tools"} called`
      : turn.status === "failed"
        ? "Stopped"
        : ranLabel(calls);
  if (turn.status === "done" && n === 0) return null;
  return (
    <ThinkingState status={turn.status} label={label}>
      <ToolChips calls={calls} />
    </ThinkingState>
  );
}
