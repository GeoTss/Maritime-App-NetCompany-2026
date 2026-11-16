/** The run so far: the agent's tool calls with their timings (no answer text exists yet). */
import { ThinkingState } from "@/components/primitives/thinking-state";
import { failRunning, ToolChips, toolCallsFromProgress } from "@/components/primitives/tool-chips";
import type { Turn } from "./assistant-store";

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
        : `Checked ${n} ${n === 1 ? "source" : "sources"}`;
  if (turn.status === "done" && n === 0) return null;
  return (
    <ThinkingState status={turn.status} label={label}>
      <ToolChips calls={calls} />
    </ThinkingState>
  );
}
