#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit): format + lint the file, enforce domain purity,
// and record prompt/schema changes so the Stop gate can ask for the right checks.
import { existsSync, readFileSync } from "node:fs";
import { checkSource } from "../../scripts/check-domain-purity.mjs";
import { bin, readStdinJson, repoRel, run, touchMarker } from "./lib.mjs";

const LINTABLE = /\.(ts|tsx|mts|js|mjs|cjs|jsx|json|jsonc|css)$/;
export const PROMPT_PATHS = [
  /^apps\/api\/src\/ai\/prompts\//,
  /^packages\/shared\/src\/extraction\//,
];
export const SCHEMA_PATHS = [/^packages\/db\/src\/schema\//];

const input = readStdinJson();
const filePath = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
const rel = repoRel(filePath);
if (!rel || !existsSync(filePath)) process.exit(0);

const problems = [];
const notes = [];

if (LINTABLE.test(rel) && existsSync(bin("biome"))) {
  const r = run(bin("biome"), [
    "check",
    "--write",
    "--no-errors-on-unmatched",
    "--files-ignore-unknown=true",
    rel,
  ]);
  if (r.code !== 0)
    problems.push(`Biome found issues it could not fix in ${rel}:\n${r.out.slice(0, 3000)}`);
}

if (/^packages\/domain\/src\/.*\.ts$/.test(rel) && !rel.endsWith(".test.ts")) {
  const v = checkSource(rel, readFileSync(filePath, "utf8"));
  if (v.length)
    problems.push(
      `Domain purity violation in ${rel} (all maths must be deterministic; pass clock/data in):\n` +
        v.map((x) => `  line ${x.line} [${x.rule}] ${x.snippet}`).join("\n"),
    );
}

if (PROMPT_PATHS.some((re) => re.test(rel))) {
  touchMarker("prompt-changed");
  notes.push("Prompt or extraction schema changed: a live smoke eval is required before stopping.");
}
if (SCHEMA_PATHS.some((re) => re.test(rel))) {
  notes.push(
    "DB schema changed: generate a migration (npm run db:generate -w @pharos/db) and update packages/shared contracts if affected.",
  );
}

if (problems.length) {
  process.stderr.write(`[post-edit] ${problems.join("\n\n")}\n`);
  process.exit(2);
}
if (notes.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join(" ") },
    }),
  );
}
