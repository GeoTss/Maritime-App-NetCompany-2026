#!/usr/bin/env node
// PreToolUse(Bash): blocks destructive, outward-facing or secret-revealing commands.
import { isAbsolute, resolve } from "node:path";
import { BUILDER_AGENTS, block, REPO_ROOT, readStdinJson } from "./lib.mjs";

/** @returns {string | null} reason to block, or null to allow */
export function checkCommand(command, { agentType = "", cwd = REPO_ROOT } = {}) {
  const cmd = String(command ?? "");
  const segments = cmd.split(/&&|\|\||;|\||\n/).map((s) => s.trim());

  if (/\bgit\s+push\b/.test(cmd))
    return "git push is not allowed: nothing is pushed unless the user asks.";
  if (/\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f/.test(cmd))
    return "Discarding work (git reset --hard / git clean -f) needs the user's confirmation.";
  if (/\bsudo\b/.test(cmd)) return "sudo is not allowed. Ask the user to run privileged commands.";
  if (/\bdocker\s+(volume|system|image|container)\s+prune\b/.test(cmd))
    return "docker prune is not allowed: it can delete data outside this project.";
  if (/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/.test(cmd))
    return "Piping downloads into a shell is not allowed.";

  // Secrets: never print .env or key variables.
  if (
    /\b(cat|less|more|head|tail|bat|grep|rg|sed|awk|cut|strings|xxd|od)\b[^|;&]*(^|[\s/'"])\.env(?![.\w])/.test(
      cmd,
    )
  )
    return "Reading .env would print secrets. Check for key presence with the SessionStart status instead.";
  if (
    /\$\{?(ANTHROPIC_API_KEY|AISSTREAM_API_KEY)\b/.test(cmd) &&
    /\b(echo|printf|print)\b/.test(cmd)
  )
    return "Printing API keys is not allowed.";
  if (segments.some((s) => /^(printenv|env)$/.test(s)))
    return "Dumping the environment would print secrets.";

  // Recursive deletes must stay inside the repo and not target the repo itself.
  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    const i = tokens.indexOf("rm");
    if (i === -1) continue;
    const args = tokens.slice(i + 1);
    const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive");
    if (!recursive) continue;
    for (const target of args.filter((a) => !a.startsWith("-"))) {
      if (
        /^(~|\$HOME|\/|\*|\.|\.\.)$/.test(target) ||
        target.startsWith("~") ||
        target.includes("$")
      )
        return `Refusing recursive delete of "${target}".`;
      const abs = isAbsolute(target) ? target : resolve(cwd, target);
      if (abs === REPO_ROOT || !abs.startsWith(`${REPO_ROOT}/`))
        return `Refusing recursive delete outside the repo: "${target}".`;
      if (/(^|\/)\.git(\/|$)/.test(abs)) return "Refusing to delete .git.";
    }
  }

  // Only the lead session changes dependencies (one shared lockfile).
  if (agentType && BUILDER_AGENTS.includes(agentType)) {
    if (
      /\bnpm\s+(install|i|add|ci|uninstall|remove|rm|update|up|exec)\b/.test(cmd) ||
      /\b(pnpm|yarn|bun)\s+(install|i|add|remove|dlx|x)\b/.test(cmd) ||
      /\bnpx\s+-y\b/.test(cmd) ||
      // These CLIs install packages or browsers themselves.
      /\bnpx\s+(--yes\s+)?shadcn(@\S+)?\b/.test(cmd) ||
      /\bnpx\s+(--yes\s+)?impeccable(@\S+)?\s+(install|update|link)\b/.test(cmd) ||
      /\bnpx\s+playwright\s+install\b/.test(cmd)
    )
      return `Dependency changes are lead-only. Ask the lead to add the package (agent: ${agentType}).`;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = readStdinJson();
  const reason = checkCommand(input?.tool_input?.command, {
    agentType: input?.agent_type ?? "",
    cwd: input?.cwd ?? REPO_ROOT,
  });
  if (reason) block(`[guard-bash] ${reason}`);
}
