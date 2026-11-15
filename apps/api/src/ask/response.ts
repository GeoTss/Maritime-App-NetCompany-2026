/**
 * The HTTP boundary of an ask: the agent's result with the gate reduced to counts. A withheld
 * number never leaves the API, not even in the list of what was withheld; the full lists stay on
 * the stored assistant message (`content.gate`, `gate_attempts`), where review, audit and evals
 * read them.
 */
import { AskResponse, type AskResult, type GateResult, type GateSummary } from "@pharos/shared";

export function summariseGate(gate: GateResult): GateSummary {
  return {
    passed: gate.passed,
    repaired: gate.repaired,
    ungroundedCount: gate.ungroundedNumbers.length,
    attempts: gate.attempts.map((a) => ({
      attempt: a.attempt,
      passed: a.passed,
      ungroundedCount: a.ungroundedNumbers.length,
    })),
  };
}

/** The response `POST /api/ask` and the stream's answer event carry. */
export function toAskResponse(result: AskResult): AskResponse {
  const { gate, ...rest } = result;
  return AskResponse.parse({ ...rest, gate: summariseGate(gate) });
}
