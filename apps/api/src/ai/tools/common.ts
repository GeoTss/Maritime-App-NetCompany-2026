/**
 * What every agent tool shares: the per-ask context (database, clock, fact ledger, call log) and
 * the wrapper that runs one tool call. The fact-id scheme and fact shapes are in `facts/core.ts`.
 *
 * Tools only load data and call `packages/domain`; they never compute a number themselves.
 * Their output must be deterministic for the same database state (no wall clock, no random ids),
 * because tool results are part of the next model request and so of its replay key.
 */
import type { Sql, World } from "@pharos/db";
import { DOMAIN_CODE_VERSION, isoDayAfter } from "@pharos/domain";
import type {
  AskSubject,
  Calculation,
  Fact,
  FactId,
  Id,
  Quote,
  ToolResult,
  Vessel,
} from "@pharos/shared";
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
  /** The ships this ask's tools resolved, in order of first appearance (see `addSubject`). */
  subjects: AskSubject[];
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
    subjects: [],
    serial: (fn) => {
      const run = tail.then(fn, fn);
      tail = run.catch(() => {});
      return run;
    },
  };
}

/**
 * Records a ship the ask is about, once. A side effect on the context only, never on a tool
 * result (those are replay-keyed). Call it after the ship is resolved, so a failed call adds none.
 */
export function addSubject(ctx: Pick<ToolContext, "subjects">, subject: AskSubject): void {
  const same = (s: AskSubject) =>
    s.kind === "vessel"
      ? subject.kind === "vessel" && subject.vesselId === s.vesselId
      : subject.kind === "ais" && subject.mmsi === s.mmsi;
  if (!ctx.subjects.some(same)) ctx.subjects.push(subject);
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
  ctx: Pick<ToolContext, "sql" | "now">,
  calc: {
    kind: Calculation["kind"];
    inputs: unknown;
    outputs: unknown;
    voyageId: Id | null;
    operandFactIds?: FactId[];
    /** The weather snapshot the calculation read, when it used one. */
    weatherSnapshotId?: Id | null;
  },
): Promise<Id> {
  const operands = calc.operandFactIds ? json(calc.operandFactIds) : null;
  const [row] = await ctx.sql<{ id: number }[]>`
    insert into calculations (kind, inputs, outputs, code_version, voyage_id, weather_snapshot_id,
                              operand_fact_ids, created_at)
    values (${calc.kind}, ${json(calc.inputs)}::jsonb, ${json(calc.outputs)}::jsonb,
            ${DOMAIN_CODE_VERSION}, ${calc.voyageId}, ${calc.weatherSnapshotId ?? null}, ${operands}::jsonb,
            ${ctx.now().toISOString()}::timestamptz)
    returning id`;
  if (!row) throw new Error("calculations insert returned no row");
  return row.id;
}

/** Why a quote can no longer be accepted (one rule, in `@pharos/db`). */
export { quoteExpiry } from "@pharos/db";

/** A fleet vessel from free text: a standalone 7-digit IMO in it, otherwise the name. */
export function findVessel(world: World, text: string): Vessel {
  const imo = text.match(/(?<!\d)\d{7}(?!\d)/)?.[0] ?? null;
  const { vessel, detail } = resolveVessel(world, imo ? { name: null, imo } : { name: text, imo });
  if (!vessel) throw new Error(detail ?? `No fleet vessel matches "${text}".`);
  return vessel;
}
