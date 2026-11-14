// Shared helpers for the project's Claude Code hooks. Hooks read one JSON object on stdin.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const STATE_DIR = join(REPO_ROOT, ".claude/state");
export const MARKERS_DIR = join(STATE_DIR, "markers");

/** Agent names whose work is scoped to a part of the repo (see .claude/agents/). */
export const AGENT_SCOPES = {
  "domain-data-engineer": ["packages/db/", "packages/domain/"],
  "integrations-engineer": ["packages/integrations/", "apps/worker/", "services/erp-sim/"],
  "ai-backend-engineer": ["apps/api/"],
  "frontend-engineer": ["apps/web/"],
  "eval-engineer": ["evals/", "fixtures/"],
};
export const BUILDER_AGENTS = Object.keys(AGENT_SCOPES);

export function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Repo-relative path with forward slashes, or null if outside the repo. */
export function repoRel(p) {
  if (!p) return null;
  const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export function bin(name) {
  return join(REPO_ROOT, "node_modules/.bin", name);
}

/** Uncommitted files (modified, added, untracked), repo-relative. */
export function changedFiles() {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "-uall"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) =>
        l
          .slice(3)
          .replace(/^.* -> /, "")
          .replace(/^"|"$/g, ""),
      );
  } catch {
    return [];
  }
}

export function touchMarker(name) {
  mkdirSync(MARKERS_DIR, { recursive: true });
  writeFileSync(join(MARKERS_DIR, name), new Date().toISOString());
}

export function markerTime(name) {
  const p = join(MARKERS_DIR, name);
  return existsSync(p) ? statSync(p).mtimeMs : 0;
}

export function readStatus() {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, "status.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Names of keys in .env that have a non-empty value. Values are never returned. */
export function presentEnvKeys() {
  const p = join(REPO_ROOT, ".env");
  if (!existsSync(p)) return new Set();
  const keys = new Set();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m?.[1] && m[2] && m[2].trim().replace(/^["']|["']$/g, "") !== "") keys.add(m[1]);
  }
  return keys;
}
