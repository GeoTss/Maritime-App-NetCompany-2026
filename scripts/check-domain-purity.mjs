#!/usr/bin/env node
// Enforces the deterministic-maths guarantee: packages/domain must stay pure.
// No network, no LLM SDK, no env, no hidden clock, no randomness, only allowlisted imports.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_IMPORTS = [/^\.{1,2}\//, /^zod$/, /^@pharos\/shared$/, /^@turf\//];

const CODE_RULES = [
  { rule: "network", re: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/ },
  { rule: "randomness", re: /\bMath\.random\s*\(|\bcrypto\.(randomUUID|getRandomValues)\s*\(/ },
  { rule: "hidden-clock", re: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/ },
  { rule: "env", re: /\bprocess\.env\b/ },
];

const IMPORT_RE =
  /\bfrom\s*(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3\s*\)|\bimport\s+(["'])([^"']+)\5|\brequire\s*\(\s*(["'])([^"']+)\7\s*\)/g;

/** Returns [withoutComments, withoutCommentsOrStringContents], both preserving newlines. */
function lex(text) {
  let noComments = "";
  let codeOnly = "";
  let state = "code";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i++;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        state = "string";
        quote = c;
      }
      noComments += c;
      codeOnly += c;
    } else if (state === "line") {
      if (c === "\n") {
        state = "code";
        noComments += c;
        codeOnly += c;
      }
    } else if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i++;
      } else if (c === "\n") {
        noComments += c;
        codeOnly += c;
      }
    } else {
      // string
      if (c === "\\") {
        noComments += c + (next ?? "");
        codeOnly += "  ";
        i++;
        continue;
      }
      noComments += c;
      if (c === quote) {
        state = "code";
        codeOnly += c;
      } else {
        codeOnly += c === "\n" ? "\n" : " ";
      }
    }
  }
  return [noComments, codeOnly];
}

/** @returns {{line:number, rule:string, snippet:string}[]} */
export function checkSource(_path, text) {
  const [noComments, codeOnly] = lex(text);
  const srcLines = noComments.split("\n");
  const codeLines = codeOnly.split("\n");
  const violations = [];
  srcLines.forEach((srcLine, idx) => {
    const codeLine = codeLines[idx] ?? "";
    for (const { rule, re } of CODE_RULES) {
      if (re.test(codeLine)) violations.push({ line: idx + 1, rule, snippet: srcLine.trim() });
    }
    for (const m of srcLine.matchAll(IMPORT_RE)) {
      const spec = m[2] ?? m[4] ?? m[6] ?? m[8];
      // Only count it if the keyword sits in real code, not inside a string literal.
      const at = m.index ?? 0;
      if (codeLine.slice(at, at + 4).trim() === "") continue;
      if (spec && !ALLOWED_IMPORTS.some((re) => re.test(spec))) {
        violations.push({ line: idx + 1, rule: "forbidden-import", snippet: srcLine.trim() });
      }
    }
  });
  return violations;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

export function checkDomain(root) {
  const dir = join(root, "packages/domain/src");
  const results = [];
  for (const file of walk(dir)) {
    for (const v of checkSource(file, readFileSync(file, "utf8"))) {
      results.push({ file: relative(root, file), ...v });
    }
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(import.meta.url), "../..");
  const results = checkDomain(root);
  if (results.length > 0) {
    console.error("Domain purity violations (packages/domain must be deterministic):");
    for (const r of results) console.error(`  ${r.file}:${r.line} [${r.rule}] ${r.snippet}`);
    process.exit(1);
  }
  console.log("Domain purity: OK");
}
