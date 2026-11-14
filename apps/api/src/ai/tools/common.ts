/**
 * What every agent tool shares: the per-ask context (database, clock, fact ledger, call log), the
 * deterministic fact-id scheme, and the wrapper that runs one tool call.
 *
 * Tools only load data and call `packages/domain`; they never compute a number themselves.
 * Their output must be deterministic for the same database state (no wall clock, no random ids),
 * because tool results are part of the next model request and so of its replay key.
 */
import type { Sql, World } from "@pharos/db";
import type { Fact, FactId, Id, ToolResult, Vessel, Voyage } from "@pharos/shared";
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

/** A fleet vessel from free text: a standalone 7-digit IMO in it, otherwise the name. */
export function findVessel(world: World, text: string): Vessel {
  const imo = text.match(/(?<!\d)\d{7}(?!\d)/)?.[0] ?? null;
  const { vessel, detail } = resolveVessel(world, imo ? { name: null, imo } : { name: text, imo });
  if (!vessel) throw new Error(detail ?? `No fleet vessel matches "${text}".`);
  return vessel;
}

/** The vessel's voyage that is not completed, if any. */
export function currentVoyage(world: World, vessel: Vessel): Voyage | null {
  return world.voyages.find((v) => v.vesselId === vessel.id && v.status !== "completed") ?? null;
}
