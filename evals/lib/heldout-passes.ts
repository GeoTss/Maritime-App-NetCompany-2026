/**
 * The held-out passes file: one row per case run of a final live held-out pass, so a held-out case
 * runs once (Ruling R8). A runner appends a row next to each `rows.jsonl` row it writes (errors
 * included), and refuses to start a final live held-out pass when a selected case already has a
 * row. A case with no row (the pass stopped first) may still run, once; the reports are then
 * merged with `npm run eval:merge`.
 *
 * The file is `evals/heldout-passes.jsonl` (tracked). Every function takes an explicit path; only
 * the runners' CLI `main()` passes `HELDOUT_PASSES_PATH`, so tests never touch the real file.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IsoDateTime } from "@pharos/shared";
import { z } from "zod";

export const HELDOUT_PASSES_PATH = fileURLToPath(
  new URL("../heldout-passes.jsonl", import.meta.url),
);

/** One case run of a final live held-out pass. `outcome` is "graded" or "error:<kind>". */
export const PassRow = z
  .object({
    suite: z.enum(["extraction", "qa"]),
    id: z.string().min(1),
    run: z.number().int().positive(),
    at: IsoDateTime,
    label: z.string().min(1),
    report: z.string().min(1),
    outcome: z.string().min(1),
  })
  .strict();
export type PassRow = z.infer<typeof PassRow>;

export class HeldoutRerunError extends Error {
  override name = "HeldoutRerunError";
}

/** Reads and validates the passes file; a missing file has no rows. Throws naming a bad line. */
export function readPasses(path: string): PassRow[] {
  if (!existsSync(path)) return [];
  const rows: PassRow[] = [];
  for (const [i, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (err) {
      throw new Error(`${path} line ${i + 1}: not valid JSON (${(err as Error).message})`);
    }
    const parsed = PassRow.safeParse(json);
    if (!parsed.success) throw new Error(`${path} line ${i + 1}: ${parsed.error.message}`);
    rows.push(parsed.data);
  }
  return rows;
}

/** Throws HeldoutRerunError naming every id of `ids` that already has a row for `suite`. */
export function assertNotRun(suite: PassRow["suite"], ids: readonly string[], path: string): void {
  const run = new Set(readPasses(path).flatMap((r) => (r.suite === suite ? [r.id] : [])));
  const again = [...new Set(ids.filter((id) => run.has(id)))];
  if (again.length > 0) {
    throw new HeldoutRerunError(
      `a held-out case runs once: ${again.length} selected ${suite} case(s) already ran in a final pass (${path}): ${again.join(", ")}. Run only the cases with no row (--offset), then merge the reports with npm run eval:merge.`,
    );
  }
}

/** Appends one validated row (one JSON line); an invalid row is refused and nothing is written. */
export function appendPass(row: PassRow, path: string): void {
  const valid = PassRow.parse(row);
  appendFileSync(path, `${JSON.stringify(valid)}\n`);
}
