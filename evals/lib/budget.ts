/**
 * Eval spend controls: the ledger of live LLM spend, the per-phase budget check, the Haiku-only
 * model guard and the per-request spend guard that wraps an LLM transport (and, given an allowed
 * model, refuses every request after a response served by another).
 *
 * The ledger is `evals/spend-ledger.jsonl`, one JSON row per live run, each stamped with the phase
 * it was spent in (a row without one is Phase 3's). The current phase and its cap live in
 * `evals/budget.json`; a cap of 0 means the user has not set the budget yet, and nothing paid may
 * run. Every function takes optional paths so tests use temp files and never touch the real ones.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IsoDateTime } from "@pharos/shared";
import { z } from "zod";
import type { LlmFetch } from "../../apps/api/src/ai/llm.js";
import { costUsd, type LlmUsage, promptTokensOf } from "../../apps/api/src/ai/pricing.js";
import { readBodyOnce } from "../../apps/api/src/ai/read-body.js";

/** The only model any live run may use or be served by. */
export const HAIKU = "claude-haiku-5-5";

export const DEFAULT_LEDGER_PATH = fileURLToPath(new URL("../spend-ledger.jsonl", import.meta.url));
export const DEFAULT_BUDGET_PATH = fileURLToPath(new URL("../budget.json", import.meta.url));

/** Rows written before phases were recorded belong to Phase 3. */
export const LEGACY_LEDGER_PHASE = 3;

/** The current phase and its spend cap in USD; a cap of 0 means "not set yet". */
export const BudgetConfig = z
  .object({ phase: z.number().int().positive(), capUsd: z.number().finite().nonnegative() })
  .strict();
export type BudgetConfig = z.infer<typeof BudgetConfig>;

export const LedgerRow = z.object({
  /** The phase the spend belongs to; a missing value means Phase 3. */
  phase: z.number().int().positive().optional(),
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

export function readBudgetConfig(path: string = DEFAULT_BUDGET_PATH): BudgetConfig {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: cannot read the budget config (${(err as Error).message})`);
  }
  const parsed = BudgetConfig.safeParse(json);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
  return parsed.data;
}

/** The phase the budget file says is current. */
export function currentPhase(configPath?: string): number {
  return readBudgetConfig(configPath).phase;
}

/** The sum of the ledger's rows for `phase`; with no phase, of every row. */
export function ledgerTotal(path?: string, phase?: number): number {
  return readLedger(path)
    .filter((r) => phase === undefined || (r.phase ?? LEGACY_LEDGER_PHASE) === phase)
    .reduce((a, r) => a + r.costUsd, 0);
}

/**
 * The phase's cap, its ledger spend and what is left (never negative). Throws BudgetError when
 * `phase` is not the phase the budget file covers.
 */
export function budgetRemaining(
  path?: string,
  phase?: number,
  configPath?: string,
): { phase: number; capUsd: number; spentUsd: number; remainingUsd: number } {
  const config = readBudgetConfig(configPath);
  const p = phase ?? config.phase;
  if (p !== config.phase) {
    throw new BudgetError(`budget: evals/budget.json covers Phase ${config.phase}, not Phase ${p}`);
  }
  const spentUsd = ledgerTotal(path, p);
  return {
    phase: p,
    capUsd: config.capUsd,
    spentUsd,
    remainingUsd: Math.max(0, config.capUsd - spentUsd),
  };
}

/**
 * Throws BudgetError when this phase's ledger total plus the estimate would exceed its cap. A cap
 * of 0 refuses any positive estimate: the user has not set the phase's budget yet.
 */
export function assertBudget(
  estimateUsd: number,
  path?: string,
  phase?: number,
  configPath?: string,
): void {
  if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
    throw new BudgetError(`estimate must be a non-negative number, got ${estimateUsd}`);
  }
  const { phase: p, capUsd, spentUsd } = budgetRemaining(path, phase, configPath);
  if (capUsd === 0 && estimateUsd > 0) {
    throw new BudgetError(
      `budget: the Phase ${p} budget is not set (capUsd is 0 in evals/budget.json); the user must set it before any paid run`,
    );
  }
  if (spentUsd + estimateUsd > capUsd) {
    throw new BudgetError(
      `budget: Phase ${p} ledger total $${spentUsd.toFixed(4)} + estimate $${estimateUsd.toFixed(4)} exceeds the $${capUsd.toFixed(2)} cap`,
    );
  }
}

/** Appends one validated row, stamped with the current phase unless the row names one. */
export function appendSpend(
  row: LedgerRow,
  path: string = DEFAULT_LEDGER_PATH,
  configPath?: string,
): void {
  const valid = LedgerRow.parse({ ...row, phase: row.phase ?? currentPhase(configPath) });
  appendFileSync(
    path,
    `${JSON.stringify(valid)}
`,
  );
}

/** Throws unless every model is exactly the Haiku model (a dated snapshot of another model fails). */
export function assertHaikuOnly(models: string[]): void {
  const bad = [...new Set(models.filter((m) => m !== HAIKU))];
  if (bad.length > 0) {
    throw new ModelNotAllowedError(
      `only ${HAIKU} is allowed for live runs; refused: ${bad.join(", ")}`,
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
  /**
   * The only model a response may name. The first response served by another trips the guard
   * (source "model"), so the next request is refused; that response is still returned and costed.
   */
  allowedModel?: string;
}

export type GuardTrip = { source: "own" | "outer" | "model"; reason: string };

export interface SpendGuard {
  /** Wraps a transport; costs are priced for `model`. */
  wrap(inner: LlmFetch, model: string): LlmFetch;
  spentUsd(): number;
  /** The block reason if the sum is over the cap right now, else null. */
  overCap(): string | null;
  /**
   * The first stop, sticky: "own" for this cap, "outer" for onRequest, "model" for a response
   * served by a model other than `allowedModel`.
   */
  trip(): GuardTrip | null;
  /** Models the responses named, unreadable-body notes, and the reason for each blocked request. */
  served: string[];
  parseErrors: string[];
  blocked: string[];
}

/**
 * Per-request spend guard. Sums each response's cost from its `usage` and, once the sum is over
 * the cap (or a response named a model other than `allowedModel`), answers the next request with
 * a synthetic 400 (the SDK does not retry a 400) without calling the inner fetch, so overrun is
 * bounded to one in-flight request.
 */
export function createSpendGuard(opts: SpendGuardOptions): SpendGuard {
  const label = opts.label ?? "run";
  let spent = 0;
  let tripped: GuardTrip | null = null;
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
              message:
                tripped.source === "model"
                  ? `refused: ${tripped.reason}`
                  : `spend cap reached: ${tripped.reason}`,
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      const transported = await inner(url, init);
      // An error response carries no usage: hand it back unread.
      if (!transported.ok) return transported;
      // Read the body once and return a new Response over the same bytes, never a read through
      // `clone()` (see apps/api/src/ai/read-body.ts: a collected clone cancels the original body).
      const { json, response, nullBody } = await readBodyOnce(transported);
      // A 204 or 205 carries no body: there is nothing to cost.
      if (nullBody) return response;
      if (!json.ok) {
        parseErrors.push(`response body unreadable at the transport: ${json.error.message}`);
        return response;
      }
      const b = json.value as { model?: unknown; usage?: LlmUsage } | null;
      if (typeof b?.model === "string") {
        served.push(b.model);
        if (opts.allowedModel !== undefined && b.model !== opts.allowedModel && tripped === null) {
          tripped = {
            source: "model",
            reason: `model guard: a response was served by ${b.model}, not ${opts.allowedModel}`,
          };
        }
      }
      if (b?.usage) {
        const c = costUsd(model, b.usage, promptTokensOf(b.usage));
        spent += c;
        opts.onCost?.(c);
      }
      return response;
    },
  };
}
