/**
 * Phase 3 eval spend controls: the ledger of live LLM spend, the $3 budget check, the Haiku-only
 * model guard and the per-request spend guard that wraps an LLM transport.
 *
 * The ledger is `evals/spend-ledger.jsonl`, one JSON row per live run, committed empty. Every
 * function takes an optional path so tests use temp files and never touch the real ledger.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IsoDateTime } from "@pharos/shared";
import { z } from "zod";
import type { LlmFetch } from "../../apps/api/src/ai/llm.js";
import { costUsd, type LlmUsage, promptTokensOf } from "../../apps/api/src/ai/pricing.js";

/** Hard cap for all live LLM spend in Phase 3 (evals, smokes, recordings). */
export const SPEND_CAP_USD = 3;
/** The only model any Phase 3 live run may use or be served by. */
export const HAIKU = "claude-haiku-5-5";

export const DEFAULT_LEDGER_PATH = fileURLToPath(new URL("../spend-ledger.jsonl", import.meta.url));

export const LedgerRow = z.object({
  at: IsoDateTime,
  run: z.string().min(1),
  label: z.string().min(1),
  costUsd: z.number().finite().nonnegative(),
});
export type LedgerRow = z.infer<typeof LedgerRow>;

export class BudgetError extends Error {
  override name = "BudgetError";
}
export class ModelNotAllowedError extends Error {
  override name = "ModelNotAllowedError";
}

/** Reads and validates the ledger; a missing file is an empty ledger. Throws naming the bad line. */
export function readLedger(path: string = DEFAULT_LEDGER_PATH): LedgerRow[] {
  if (!existsSync(path)) return [];
  const rows: LedgerRow[] = [];
  for (const [i, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (err) {
      throw new Error(`${path} line ${i + 1}: not valid JSON (${(err as Error).message})`);
    }
    const parsed = LedgerRow.safeParse(json);
    if (!parsed.success) throw new Error(`${path} line ${i + 1}: ${parsed.error.message}`);
    rows.push(parsed.data);
  }
  return rows;
}

export function ledgerTotal(path?: string): number {
  return readLedger(path).reduce((a, r) => a + r.costUsd, 0);
}

/** Throws BudgetError when the ledger total plus this run's estimate would exceed the cap. */
export function assertBudget(estimateUsd: number, path?: string): void {
  if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
    throw new BudgetError(`estimate must be a non-negative number, got ${estimateUsd}`);
  }
  const total = ledgerTotal(path);
  if (total + estimateUsd > SPEND_CAP_USD) {
    throw new BudgetError(
      `budget: ledger total $${total.toFixed(4)} + estimate $${estimateUsd.toFixed(4)} exceeds the $${SPEND_CAP_USD.toFixed(2)} cap`,
    );
  }
}

/** Appends one validated row. */
export function appendSpend(row: LedgerRow, path: string = DEFAULT_LEDGER_PATH): void {
  const valid = LedgerRow.parse(row);
  appendFileSync(path, `${JSON.stringify(valid)}\n`);
}

/** Throws unless every model is exactly the Haiku model (a dated snapshot of another model fails). */
export function assertHaikuOnly(models: string[]): void {
  const bad = [...new Set(models.filter((m) => m !== HAIKU))];
  if (bad.length > 0) {
    throw new ModelNotAllowedError(
      `only ${HAIKU} is allowed for live runs in Phase 3; refused: ${bad.join(", ")}`,
    );
  }
}

export interface SpendGuardOptions {
  capUsd: number;
  /** Names the scope in the block reason, e.g. "model" or "run". Default "run". */
  label?: string;
  /** Checked before every request: a block reason from an outer cap, or null. */
  onRequest?: () => string | null;
  /** Called with each response's cost (lets an outer guard add it to its own sum). */
  onCost?: (usd: number) => void;
}

export interface SpendGuard {
  /** Wraps a transport; costs are priced for `model`. */
  wrap(inner: LlmFetch, model: string): LlmFetch;
  spentUsd(): number;
  /** The block reason if the sum is over the cap right now, else null. */
  overCap(): string | null;
  /** The first cap crossed, sticky; `source` is "own" for this cap and "outer" for onRequest. */
  trip(): { source: "own" | "outer"; reason: string } | null;
  /** Models the responses named, unreadable-body notes, and the reason for each blocked request. */
  served: string[];
  parseErrors: string[];
  blocked: string[];
}

/**
 * Per-request spend guard. Sums each response's cost from its `usage` and, once the sum is over
 * the cap, answers the next request with a synthetic 400 (the SDK does not retry a 400) without
 * calling the inner fetch, so overrun is bounded to one in-flight request.
 */
export function createSpendGuard(opts: SpendGuardOptions): SpendGuard {
  const label = opts.label ?? "run";
  let spent = 0;
  let tripped: { source: "own" | "outer"; reason: string } | null = null;
  const served: string[] = [];
  const parseErrors: string[] = [];
  const blocked: string[] = [];

  const overCap = () =>
    spent > opts.capUsd
      ? `per-request guard: ${label} cost $${spent.toFixed(4)} > $${opts.capUsd.toFixed(2)}`
      : null;

  return {
    served,
    parseErrors,
    blocked,
    spentUsd: () => spent,
    overCap,
    trip: () => tripped,
    wrap: (inner, model) => async (url, init) => {
      if (tripped === null) {
        const own = overCap();
        if (own !== null) tripped = { source: "own", reason: own };
        else {
          const outer = opts.onRequest?.() ?? null;
          if (outer !== null) tripped = { source: "outer", reason: outer };
        }
      }
      if (tripped !== null) {
        blocked.push(tripped.reason);
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: `spend cap reached: ${tripped.reason}`,
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      const transported = await inner(url, init);
      // An error response carries no usage: hand it back unread.
      if (!transported.ok) return transported;
      // Read the body once and return a new Response over the same bytes. Never read through
      // `clone()`: Node 22's fetch (undici 6.21) cancels the original body when the clone is
      // garbage collected, which fails the caller's read (as in apps/api/src/ai/llm.ts).
      const bytes = await transported.arrayBuffer();
      // A 204 or 205 may not carry a body, not even an empty one; there is nothing to cost.
      const nullBody = transported.status === 204 || transported.status === 205;
      if (!nullBody) {
        try {
          const b = JSON.parse(new TextDecoder().decode(bytes)) as {
            model?: unknown;
            usage?: LlmUsage;
          } | null;
          if (typeof b?.model === "string") served.push(b.model);
          if (b?.usage) {
            const c = costUsd(model, b.usage, promptTokensOf(b.usage));
            spent += c;
            opts.onCost?.(c);
          }
        } catch (err) {
          parseErrors.push(`response body unreadable at the transport: ${(err as Error).message}`);
        }
      }
      return new Response(nullBody ? null : bytes, {
        status: transported.status,
        statusText: transported.statusText,
        headers: transported.headers,
      });
    },
  };
}
