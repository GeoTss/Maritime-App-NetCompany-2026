/**
 * The assistant's conversation, kept outside React so it survives the dock being unmounted (the
 * phone drawer closing mid-run) and so a run in flight is never cancelled by a re-render. One ask
 * at a time (single-flight). The conversation id the API returns is kept across turns.
 */
import type { AskEvent, AskResponse } from "@pharos/shared";
import { useSyncExternalStore } from "react";
import { askStream } from "@/lib/sse";

export type Progress = Extract<AskEvent, { type: "progress" }>;

export interface Turn {
  id: number;
  question: string;
  status: "working" | "done" | "failed";
  progress: Progress[];
  response: AskResponse | null;
  error: string | null;
}

interface State {
  turns: Turn[];
  conversationId: number | null;
  /** A question another screen put in the composer for the operator to read and send. */
  draft: string | null;
}

let state: State = { turns: [], conversationId: null, draft: null };
let nextId = 1;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

const set = (next: State) => {
  state = next;
  for (const l of listeners) l();
};
const patch = (id: number, change: Partial<Turn>) =>
  set({ ...state, turns: state.turns.map((t) => (t.id === id ? { ...t, ...change } : t)) });

export const isRunning = (s: State = state) => s.turns.some((t) => t.status === "working");

/** Asks one question. Ignored while another ask is running or the question is blank. */
export function ask(question: string, onAnswer?: (response: AskResponse) => void): void {
  const text = question.trim();
  if (!text || isRunning()) return;
  const id = nextId++;
  set({
    ...state,
    turns: [
      ...state.turns,
      { id, question: text, status: "working", progress: [], response: null, error: null },
    ],
  });
  const run = new AbortController();
  controller = run;
  void askStream(
    { question: text, conversationId: state.conversationId },
    (e) => {
      if (e.type === "progress") {
        const turn = state.turns.find((t) => t.id === id);
        patch(id, { progress: [...(turn?.progress ?? []), e] });
      } else if (e.type === "answer") {
        set({
          ...state,
          conversationId: e.response.conversationId,
          turns: state.turns.map((t) =>
            t.id === id ? { ...t, status: "done", response: e.response } : t,
          ),
        });
        onAnswer?.(e.response);
      } else {
        patch(id, { status: "failed", error: e.message });
      }
    },
    run.signal,
  ).finally(() => {
    if (controller === run) controller = null;
  });
}

/** Drops a failed turn and asks its question again. */
export function retry(turnId: number, onAnswer?: (response: AskResponse) => void): void {
  const turn = state.turns.find((t) => t.id === turnId);
  if (!turn || turn.status !== "failed" || isRunning()) return;
  set({ ...state, turns: state.turns.filter((t) => t.id !== turnId) });
  ask(turn.question, onAnswer);
}

/** Starts a fresh conversation (and stops a run in flight). */
export function resetAssistant(): void {
  controller?.abort();
  controller = null;
  set({ turns: [], conversationId: null, draft: state.draft });
}

/** Puts a question in the composer (it asks nothing until the operator sends it). */
export function setDraft(text: string | null): void {
  set({ ...state, draft: text });
}

export function useAssistant(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
