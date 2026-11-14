#!/usr/bin/env node
// SessionStart: prints where the build stands and which API keys the current phase still needs.
// Never prints key values — only whether a key is set.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { presentEnvKeys, REPO_ROOT, readStatus, run } from "./lib.mjs";

const status = readStatus();
const lines = ["## Pharos build status"];

if (status) {
  lines.push(`- Phase: ${status.phase} — ${status.phaseName}`);
  if (status.lastGate)
    lines.push(
      `- Last gate: ${status.lastGate.result} (${status.lastGate.at}) ${status.lastGate.note ?? ""}`,
    );
  const keys = presentEnvKeys();
  const needed = Object.entries(status.keyCheckpoints ?? {})
    .filter(([phase]) => Number(phase) <= Number(status.phase) + 1)
    .flatMap(([phase, names]) => names.map((n) => ({ phase, n })));
  for (const { phase, n } of needed) {
    lines.push(
      `- Key ${n} (needed from Phase ${phase}): ${keys.has(n) ? "set" : "NOT SET — ask the user to add it to .env"}`,
    );
  }
} else {
  lines.push("- No .claude/state/status.json found.");
}

const scorecard = join(REPO_ROOT, "evals/reports/latest/scorecard.json");
if (existsSync(scorecard)) {
  try {
    const s = JSON.parse(readFileSync(scorecard, "utf8"));
    lines.push(`- Last scorecard: ${s.headline ?? "(no headline)"}`);
  } catch {}
}

const ps = run("docker", ["compose", "ps", "--format", "{{.Service}}:{{.State}}"], {
  timeoutMs: 4000,
});
lines.push(
  `- Containers: ${ps.code === 0 && ps.out.trim() ? ps.out.trim().split("\n").join(", ") : "not running"}`,
);
lines.push("- Plan: docs/MASTER_PLAN.md · Phase plans: docs/superpowers/plans/");

process.stdout.write(`${lines.join("\n")}\n`);
