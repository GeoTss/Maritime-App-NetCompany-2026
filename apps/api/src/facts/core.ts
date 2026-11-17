/**
 * The deterministic fact-id scheme and the two fact shapes every tool and read view builds: a fact
 * read from a stored calculation, and a fact read from a database row. Pure: no clock, no random
 * ids, so the same data always gives the same bytes (tool results are part of the next model
 * request and so of its replay key).
 */
import type { Fact, FactId, Id } from "@pharos/shared";

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
  row: { table: string; rowId: Id | string; field: string },
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
