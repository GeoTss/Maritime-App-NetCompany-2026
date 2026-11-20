/**
 * Ties the gateway's per-call metrics to the code that made the call, so the caller can record
 * each call with its links (document, conversation). Build the client with
 * `createLlm({ ..., onCall: captureLlmCall })` and make calls inside `withCallCapture`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { CallMetrics } from "./llm.js";

const scope = new AsyncLocalStorage<CallMetrics[]>();

/** `onCall` for `createLlm`: appends the metrics to the enclosing capture scope. */
export function captureLlmCall(metrics: CallMetrics): void {
  const calls = scope.getStore();
  if (!calls) {
    // A call outside any scope cannot be linked or recorded; say so instead of dropping silently.
    console.warn(
      `[llm] call ${metrics.requestKey} (${metrics.model}) made outside a capture scope; not recorded`,
    );
    return;
  }
  calls.push(metrics);
}

/** Runs `fn`, collecting the metrics of every LLM call it makes (also when it throws). */
export async function withCallCapture<T>(
  fn: () => Promise<T>,
): Promise<{ calls: CallMetrics[] } & ({ ok: true; value: T } | { ok: false; error: unknown })> {
  const calls: CallMetrics[] = [];
  return scope.run(calls, async () => {
    try {
      return { calls, ok: true as const, value: await fn() };
    } catch (error) {
      return { calls, ok: false as const, error };
    }
  });
}
