/**
 * The assistant dock: suggested questions, the run's progress trace, the released answer (every
 * number a fact chip) and the composer. No answer text streams before the release gate passes it.
 * The dock proposes nothing by itself: a proposal it makes is decided on the approvals screen.
 *
 * Ruling U4: when an answer that cites a plan arrives while the map is on screen (`/`), the dock
 * moves the map to the answer's ship and plan (`replace`, so Back is not filled with answers).
 * Elsewhere, and for an answer that cites no plan (ruling T5-a), the answer only offers "Show on
 * map".
 */
import { AiChat02Icon, Alert02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { queryKeys, useHealth } from "@/lib/queries";
import { AnswerMessage } from "./answer-message";
import { answerMapLink, answerPlan } from "./answer-plan";
import { ask, isRunning, resetAssistant, retry, type Turn, useAssistant } from "./assistant-store";
import { Composer } from "./composer";
import { ProgressTrace } from "./progress-trace";

/**
 * The demo story's three questions, word for word and in story order (e2e/demo.spec.ts), so in
 * replay every suggestion has a recorded answer.
 */
export const SUGGESTED_QUESTIONS = [
  "Where should Aegean Pioneer bunker, and who should we buy from?",
  "What is the best route and speed for Aegean Pioneer to make its berth window?",
  "Instruct the master of Aegean Pioneer to sail the recommended route at the recommended speed.",
];

/** How the API answers: replayed recordings (offline demo) or live model calls. */
function ModelMode() {
  const health = useHealth();
  const mode = health.data?.llmMode;
  if (!mode) return null;
  const kind = { replay: "model-recorded", record: "model-recording", live: "model-live" } as const;
  return <DataTag kind={kind[mode]} />;
}

/**
 * Ruling U4: an answer that arrives while the map is on screen moves the map to its link. Ruling
 * T5-a: only an answer that cites a plan does; one that only names a ship never moves the map by
 * itself. Answers already shown when the dock mounted (the phone drawer opening again) have arrived
 * before: they never navigate. A withheld answer never does.
 */
function useDrawArrivingAnswers(turns: Turn[]) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const seen = useRef<Set<number> | null>(null);
  seen.current ??= new Set(turns.filter((t) => t.response !== null).map((t) => t.id));
  useEffect(() => {
    const handled = seen.current;
    if (!handled) return;
    for (const turn of turns) {
      if (turn.response === null || handled.has(turn.id)) continue;
      handled.add(turn.id);
      if (pathname !== "/" || turn.response.answer === null) continue;
      if (answerPlan(turn.response) === null) continue;
      const link = answerMapLink(turn.response);
      if (link !== null) navigate(link, { replace: true });
    }
  }, [turns, pathname, navigate]);
}

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  return (
    <section
      className="flex flex-col gap-2 border-b border-line p-3"
      aria-label="Question and answer"
    >
      <p className="max-w-[60ch] text-sm font-medium text-text-1">{turn.question}</p>
      <ProgressTrace turn={turn} />
      {turn.status === "failed" ? (
        <div role="alert" className="flex items-start gap-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-alarm"
          />
          <div className="flex flex-col items-start gap-1.5">
            <p className="max-w-[60ch] text-xs/relaxed text-text-1">{turn.error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} data-icon="inline-start" />
              Try again
            </Button>
          </div>
        </div>
      ) : null}
      {turn.response ? <AnswerMessage response={turn.response} /> : null}
    </section>
  );
}

export function AssistantDock() {
  const client = useQueryClient();
  const state = useAssistant();
  const scroller = useRef<HTMLDivElement>(null);
  const busy = isRunning(state);
  useDrawArrivingAnswers(state.turns);

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
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1">
        <h2 className="text-xs font-medium text-text-2 font-label">Assistant</h2>
        <DataTag kind="simulated" />
        <ModelMode />
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
