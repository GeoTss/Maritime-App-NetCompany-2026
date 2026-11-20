#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): protects secrets and eval ground truth.
import { appendFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { block, readStdinJson, repoRel, STATE_DIR } from "./lib.mjs";

const GOLDEN_UNLOCK = join(STATE_DIR, "golden-unlock.local.json");

/** @returns {string | null} reason to block, or null to allow */
export function checkEdit(filePath, { goldenUnlocked = existsSync(GOLDEN_UNLOCK) } = {}) {
  if (!filePath) return null;
  const name = basename(filePath);
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
    return `${name} holds secrets and is edited by the user only. Update .env.example instead.`;

  const rel = repoRel(filePath);
  if (rel && /^evals\/golden\/.*\.truth\.json$/.test(rel) && !goldenUnlocked)
    return (
      `${rel} is eval ground truth. It is never edited to make a score pass. ` +
      "If the label itself is wrong, ask the user; to unlock deliberately, create " +
      ".claude/state/golden-unlock.local.json with a reason."
    );
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = readStdinJson();
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  const reason = checkEdit(filePath);
  if (reason) block(`[guard-edit] ${reason}`);
  const rel = repoRel(filePath);
  if (rel && /^evals\/golden\/.*\.truth\.json$/.test(rel)) {
    appendFileSync(join(STATE_DIR, "golden-edits.log"), `${new Date().toISOString()} ${rel}\n`);
  }
}
