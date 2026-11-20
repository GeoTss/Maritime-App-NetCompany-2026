/**
 * Ledger CLI for the current phase's live-spend budget (evals/budget.json).
 *
 *   npm run eval:ledger -- total
 *   npm run eval:ledger -- add --run <run> --label <label> --cost <usd>
 */
import { pathToFileURL } from "node:url";
import { appendSpend, budgetRemaining } from "./budget.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
  return v;
}

/** Runs one subcommand and returns the line to print. `path` overrides the ledger (tests). */
export function runLedgerCli(
  argv: string[],
  path?: string,
  now: () => Date = () => new Date(),
  configPath?: string,
): string {
  const [cmd, ...rest] = argv;
  if (cmd === "total") {
    const b = budgetRemaining(path, undefined, configPath);
    return `Phase ${b.phase} total $${b.spentUsd.toFixed(4)}; remaining $${b.remainingUsd.toFixed(4)} of $${b.capUsd.toFixed(2)}`;
  }
  if (cmd === "add") {
    const run = flag(rest, "--run");
    const label = flag(rest, "--label");
    const raw = flag(rest, "--cost");
    if (!run || !label || raw === undefined) {
      throw new Error("usage: add --run <run> --label <label> --cost <usd>");
    }
    const costUsd = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(costUsd) || costUsd < 0) {
      throw new Error(`--cost must be a non-negative number of USD, got "${raw}"`);
    }
    appendSpend({ at: now().toISOString(), run, label, costUsd }, path, configPath);
    return `added $${costUsd.toFixed(4)} (${run}: ${label}); ${runLedgerCli(["total"], path, now, configPath)}`;
  }
  throw new Error("usage: eval:ledger total | add --run <run> --label <label> --cost <usd>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(runLedgerCli(process.argv.slice(2)));
  } catch (err) {
    console.error(`[ledger] ${(err as Error).message}`);
    process.exit(1);
  }
}
