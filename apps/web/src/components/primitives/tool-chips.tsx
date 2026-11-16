/**
 * The agent's tool calls as compact rows (Beautiful UI's tool-chips pattern, composed from our
 * tokens and fed by `AskEvent.progress`): what each tool is in words, its id, and its time as the
 * API reported it. Progress events carry no input, output or text, so neither does this.
 */
import { Alert02Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AskEvent } from "@pharos/shared";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ToolCallState = "running" | "done" | "failed";

export interface ToolCall {
  /** Position in the run, as a string key. */
  id: string;
  tool: string;
  state: ToolCallState;
  /** Duration the API reported on `finished`; null while running. */
  ms: number | null;
}

/** What each agent tool does, for the operator. Unknown tools show their id only. */
export const TOOL_LABEL: Record<string, string> = {
  list_fleet: "Fleet list",
  get_vessel_status: "Vessel status",
  list_quotes: "Supplier quotes",
  plan_bunkering: "Bunker plan",
  get_emissions: "Emissions and ETS",
  plan_route_speed: "Route and speed plan",
  get_port_congestion: "Port congestion",
  calculate: "Calculation",
  propose_action: "Proposal for approval",
};

type Progress = Extract<AskEvent, { type: "progress" }>;

/** Folds progress events into calls: each finish closes the earliest open start of its tool. */
export function toolCallsFromProgress(events: Progress[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const e of events) {
    if (e.phase === "started") {
      calls.push({ id: String(calls.length), tool: e.tool, state: "running", ms: null });
      continue;
    }
    const open = calls.find((c) => c.tool === e.tool && c.state === "running");
    if (open) {
      open.state = "done";
      open.ms = e.ms;
    } else {
      calls.push({ id: String(calls.length), tool: e.tool, state: "done", ms: e.ms });
    }
  }
  return calls;
}

/** Marks calls still running when the ask ended in an error. */
export const failRunning = (calls: ToolCall[]): ToolCall[] =>
  calls.map((c) => (c.state === "running" ? { ...c, state: "failed" } : c));

const STATE_ICON = { running: Loading03Icon, done: Tick02Icon, failed: Alert02Icon };

export function ToolChips({ calls, className }: { calls: ToolCall[]; className?: string }) {
  if (calls.length === 0) return null;
  return (
    <ol className={cn("flex flex-col py-0.5", className)} aria-label="Tool calls">
      {calls.map((call) => (
        <li key={call.id} className="flex h-7 min-w-0 items-center gap-2 text-xs">
          <HugeiconsIcon
            icon={STATE_ICON[call.state]}
            strokeWidth={2}
            className={cn(
              "size-3 shrink-0",
              call.state === "running" && "animate-spin text-text-2 motion-reduce:animate-none",
              call.state === "done" && "text-text-3",
              call.state === "failed" && "text-alarm",
            )}
          />
          <span className="shrink-0 text-text-1">{TOOL_LABEL[call.tool] ?? call.tool}</span>
          {TOOL_LABEL[call.tool] ? (
            <span className="min-w-0 truncate rounded-sm border border-line bg-ink-850 px-1 font-mono text-2xs text-text-3">
              {call.tool}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-2xs tabular-nums text-text-3">
            {call.state === "running"
              ? "running"
              : call.state === "failed"
                ? "stopped"
                : call.ms === null
                  ? ""
                  : formatNumber(call.ms, "ms")}
          </span>
        </li>
      ))}
    </ol>
  );
}
