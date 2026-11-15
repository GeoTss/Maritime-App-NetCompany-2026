/**
 * What every agent tool shares: the per-ask context (database, clock, fact ledger, call log), the
 * deterministic fact-id scheme, and the wrapper that runs one tool call.
 *
 * Tools only load data and call `packages/domain`; they never compute a number themselves.
 * Their output must be deterministic for the same database state (no wall clock, no random ids),
 * because tool results are part of the next model request and so of its replay key.
 */
import type { Sql, World } from "@pharos/db";
import { DOMAIN_CODE_VERSION, isoDayAfter } from "@pharos/domain";
import type { Calculation, Fact, FactId, Id, Quote, ToolResult, Vessel } from "@pharos/shared";
import { resolveVessel } from "../../ingest/resolve.js";

export interface ToolCallLog {
  tool: string;
  input: unknown;
  isError: boolean;
  /** The ToolResult on success, the error message on failure. */
  result: ToolResult | { error: string };
}

export interface ToolContext {
  sql: Sql;
  /** The agent's clock: "now" for next-port lookups and row timestamps. */
  now: () => Date;
  /** Every fact returned in this conversation so far (earlier turns first), by id. */
  ledger: Map<FactId, Fact>;
  /** This ask's tool calls, in the order they ran. */
  calls: ToolCallLog[];
  /** Recommendations `propose_action` created or returned during this ask. */
  recommendationIds: Id[];
  /** Runs tool calls one at a time, in call order, so serial ids do not depend on timing. */
  serial: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function createToolContext(opts: {
  sql: Sql;
  now: () => Date;
  priorFacts?: Fact[];
}): ToolContext {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    sql: opts.sql,
    now: opts.now,
    ledger: new Map((opts.priorFacts ?? []).map((f) => [f.id, f])),
    calls: [],
    recommendationIds: [],
    serial: (fn) => {
      const run = tail.then(fn, fn);
      tail = run.catch(() => {});
      return run;
    },
  };
}

/**
 * `f_<tool>_<calculationId|rowId>_<path>`: `[n]` becomes `.n`, any other character outside the
 * FactId alphabet becomes `_`.
 */
export function factId(tool: string, key: number | string, path: string): FactId {
  const raw = `f_${tool}_${key}_${path.replace(/\[(\d+)\]/g, ".$1")}`;
  return raw.replace(/[^A-Za-z0-9_.:-]/g, "_");
}

export function calcFact(
  tool: string,
  calc: { id: Id; calculator: string },
  path: string,
  label: string,
  value: number | string | boolean,
  unit: string | null,
): Fact {
  return {
    id: factId(tool, calc.id, path),
    label,
    value,
    unit,
    provenance: {
      source: "calculation",
      calculationId: calc.id,
      calculator: calc.calculator,
      path,
    },
  };
}

export function dbFact(
  tool: string,
  row: { table: string; rowId: Id; field: string },
  label: string,
  value: number | string | boolean,
  unit: string | null,
): Fact {
  return {
    id: factId(tool, row.rowId, `${row.table}.${row.field}`),
    label,
    value,
    unit,
    provenance: { source: "db", table: row.table, rowId: row.rowId, field: row.field },
  };
}

/**
 * Runs one tool call: serialised, logged, and its facts added to the ledger. A thrown error is
 * logged and rethrown; the tool runner returns its message to the model as an `is_error` result.
 */
export function runTool(
  ctx: ToolContext,
  tool: string,
  input: unknown,
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  return ctx.serial(async () => {
    try {
      const result = await fn();
      for (const f of result.facts) ctx.ledger.set(f.id, f);
      ctx.calls.push({ tool, input, isError: false, result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.calls.push({ tool, input, isError: true, result: { error: message } });
      throw err;
    }
  });
}

/** jsonb parameter, sent as JSON text and cast with `::jsonb` at the call site. */
export const json = (value: unknown): string => JSON.stringify(value);

/**
 * Stores one calculation (domain inputs and outputs, at the current domain code version) and
 * returns its id, the id every calculation fact and any proposal points at.
 */
export async function insertCalculation(
  ctx: ToolContext,
  calc: {
    kind: Calculation["kind"];
    inputs: unknown;
    outputs: unknown;
    voyageId: Id | null;
    operandFactIds?: FactId[];
  },
): Promise<Id> {
  const operands = calc.operandFactIds ? json(calc.operandFactIds) : null;
  const [row] = await ctx.sql<{ id: number }[]>`
    insert into calculations (kind, inputs, outputs, code_version, voyage_id, weather_snapshot_id,
                              operand_fact_ids, created_at)
    values (${calc.kind}, ${json(calc.inputs)}::jsonb, ${json(calc.outputs)}::jsonb,
            ${DOMAIN_CODE_VERSION}, ${calc.voyageId}, null, ${operands}::jsonb,
            ${ctx.now().toISOString()}::timestamptz)
    returning id`;
  if (!row) throw new Error("calculations insert returned no row");
  return row.id;
}

/**
 * Why a quote is expired, or null while it is valid: its status says so, or its validity day
 * (stored as the day's start, UTC) is before the clock's UTC day. A quote is valid through its
 * last day, the rule ingestion applies to a quote's validity on receipt.
 */
export function quoteExpiry(
  quote: Pick<Quote, "status" | "validUntil">,
  now: Date,
): "status" | "validUntil" | null {
  if (quote.status === "expired") return "status";
  if (quote.validUntil && isoDayAfter(quote.validUntil, 0) < isoDayAfter(now, 0)) {
    return "validUntil";
  }
  return null;
}

/** A fleet vessel from free text: a standalone 7-digit IMO in it, otherwise the name. */
export function findVessel(world: World, text: string): Vessel {
  const imo = text.match(/(?<!\d)\d{7}(?!\d)/)?.[0] ?? null;
  const { vessel, detail } = resolveVessel(world, imo ? { name: null, imo } : { name: text, imo });
  if (!vessel) throw new Error(detail ?? `No fleet vessel matches "${text}".`);
  return vessel;
}
