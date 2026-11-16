/**
 * The assistant dock: suggested questions, the run's progress trace, the released answer (every
 * number a fact chip) and the composer. No answer text streams before the release gate passes it.
 * The dock proposes nothing by itself: a proposal it makes is decided on the approvals screen.
 */
import { AiChat02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queries";
import { AnswerMessage } from "./answer-message";
import { ask, isRunning, resetAssistant, retry, type Turn, useAssistant } from "./assistant-store";
import { Composer } from "./composer";
import { ProgressTrace } from "./progress-trace";

export const SUGGESTED_QUESTIONS = [
  "Where should Aegean Pioneer bunker, and who should we buy from?",
  "What is the best route and speed to make the berth window in this weather?",
  "How long is the queue at Rotterdam?",
];

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  const routeAnswer = turn.progress.some((p) => p.tool === "plan_route_speed");
  return (
    <section
      className="flex flex-col gap-2 border-b border-line p-3"
      aria-label="Question and answer"
    >
      <p className="max-w-[60ch] text-sm font-medium text-text-1">{turn.question}</p>
      <ProgressTrace turn={turn} />
      {turn.status === "failed" ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-1.5 border-l-2 border-alarm pl-3"
        >
          <p className="text-xs/relaxed text-text-1">{turn.error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} data-icon="inline-start" />
            Try again
          </Button>
        </div>
      ) : null}
      {turn.response ? <AnswerMessage response={turn.response} routeAnswer={routeAnswer} /> : null}
    </section>
  );
}

export function AssistantDock() {
  const client = useQueryClient();
  const state = useAssistant();
  const scroller = useRef<HTMLDivElement>(null);
  const busy = isRunning(state);

  const onAnswer = (response: { recommendationIds: number[] }) => {
    if (response.recommendationIds.length > 0)
      void client.invalidateQueries({ queryKey: queryKeys.recommendations });
  };
  const send = (q: string) => ask(q, onAnswer);

  // Keep the newest turn in view as the run progresses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any change to the turns.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.turns]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="text-xs font-medium text-text-2 font-label">Assistant</h2>
        <DataTag kind="simulated" />
        {state.turns.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={resetAssistant}
            title="Start a new conversation"
          >
            New conversation
          </Button>
        ) : null}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {state.turns.length === 0 ? (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={AiChat02Icon}
                strokeWidth={1.75}
                className="size-4 text-text-3"
              />
              <h3 className="text-sm font-medium text-text-1">Ask about the fleet</h3>
            </div>
            <p className="max-w-[44ch] text-xs/relaxed text-text-2">
              Every number in an answer opens to the fact behind it. Answers are checked before they
              are shown.
            </p>
            <ul className="flex flex-col gap-1">
              {SUGGESTED_QUESTIONS.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => send(q)}
                    className="min-h-7 w-full border border-line px-2 py-1 text-left text-xs text-text-1 hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-beacon/40 outline-none"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          state.turns.map((t) => (
            <TurnView key={t.id} turn={t} onRetry={() => retry(t.id, onAnswer)} />
          ))
        )}
      </div>
      <Composer onAsk={send} busy={busy} />
    </div>
  );
}
