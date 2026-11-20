#!/usr/bin/env node
// Stop / SubagentStop quality gate. Blocks the stop (and feeds errors back) when changed code
// fails typecheck, tests, or domain purity, or when a prompt changed without a live smoke eval.
// Usage: node stop-gate.mjs            (Stop: whole repo)
//        node stop-gate.mjs --subagent (SubagentStop: only the agent's own package)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_SCOPES,
  bin,
  changedFiles,
  markerTime,
  REPO_ROOT,
  readStdinJson,
  run,
} from "./lib.mjs";

const CODE = /\.(ts|tsx|mts|cts|mjs|js|jsx|json|css)$/;

/** The TypeScript projects to check for a set of changed files (the web app has its own). */
export function typecheckProjects(changed) {
  const projects = ["tsconfig.json"];
  if (changed.some((f) => f.startsWith("apps/web/"))) projects.push("apps/web/tsconfig.json");
  return projects;
}

/**
 * Pure decision function (unit-tested).
 * @param {{changed:string[], scope:string[]|null, tsc:{code:number,out:string}|null,
 *   tests:{code:number,out:string}|null, purity:{code:number,out:string}|null,
 *   promptChangedAt:number, liveSmokeAt:number}} s
 * @returns {string|null} reason to block, or null
 */
export function evaluateGate(s) {
  const inScope = (f) => !s.scope || s.scope.some((p) => f.startsWith(p));
  const reasons = [];
  if (s.tsc && s.tsc.code !== 0) {
    const lines = s.tsc.out.split("\n").filter((l) => /error TS\d+/.test(l));
    const mine = s.scope ? lines.filter((l) => inScope(l.trim())) : lines;
    if (mine.length) reasons.push(`Typecheck failed:\n${mine.slice(0, 30).join("\n")}`);
  }
  if (s.tests && s.tests.code !== 0) reasons.push(`Tests failed:\n${tail(s.tests.out, 60)}`);
  if (s.purity && s.purity.code !== 0)
    reasons.push(`Domain purity failed:\n${tail(s.purity.out, 30)}`);
  if (s.promptChangedAt > s.liveSmokeAt)
    reasons.push(
      "A prompt or extraction schema changed since the last live smoke eval. Run `npm run eval:smoke` (live, a few dev cases) before stopping.",
    );
  return reasons.length ? reasons.join("\n\n") : null;
}

function tail(text, n) {
  return text.trim().split("\n").slice(-n).join("\n");
}

function hasScript(name) {
  try {
    return Boolean(
      JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts?.[name],
    );
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = readStdinJson();
  if (input?.stop_hook_active) process.exit(0); // loop guard: we already blocked once this turn

  const subagent = process.argv.includes("--subagent");
  const scope = subagent ? (AGENT_SCOPES[input?.agent_type ?? ""] ?? null) : null;
  if (subagent && !scope) process.exit(0); // read-only agents (verifier) or unknown types: nothing to gate

  const changed = changedFiles().filter(
    (f) => CODE.test(f) && (!scope || scope.some((p) => f.startsWith(p))),
  );
  if (changed.length === 0 || !existsSync(bin("tsc"))) process.exit(0);

  const runs = typecheckProjects(changed).map((p) =>
    run(bin("tsc"), ["-p", p], { timeoutMs: 180_000 }),
  );
  const tsc = {
    code: runs.some((r) => r.code !== 0) ? 1 : 0,
    out: runs.map((r) => r.out).join("\n"),
  };
  const testArgs = ["run", "--changed", "--passWithNoTests", ...(scope ?? [])];
  const tests = run(bin("vitest"), testArgs, { timeoutMs: 240_000 });
  const purity = changed.some((f) => f.startsWith("packages/domain/"))
    ? run("node", ["scripts/check-domain-purity.mjs"])
    : null;

  const reason = evaluateGate({
    changed,
    scope,
    tsc,
    tests,
    purity,
    promptChangedAt: hasScript("eval:smoke") ? markerTime("prompt-changed") : 0,
    liveSmokeAt: markerTime("live-smoke"),
  });
  if (reason) {
    process.stdout.write(
      JSON.stringify({ decision: "block", reason: `[quality gate] ${reason}`.slice(0, 6000) }),
    );
  }
}
