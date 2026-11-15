/**
 * Generates the Q&A golden set from the question specs and the reference code (reference.ts).
 *
 *   npm run eval:qa-golden              write evals/golden/qa/ (removes stale files)
 *   npm run eval:qa-golden -- --check   exit 1 if any file on disk differs (byte-stable)
 *
 * Per question: <id>.truth.json. Plus split.json and REVIEW-QA.md. No clock, no network, no model.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { QA_CATEGORIES, type QaTruth } from "@pharos/shared";
import { stableJson } from "../extraction/json.js";
import { QUESTIONS } from "./questions.js";
import { buildTruth, qaWorld } from "./reference.js";
import { computeQaSplit, QA_GOLDEN_DIR, qaSplitJson } from "./split.js";

const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const showValue = (f: QaTruth["expect"]["requiredFacts"][number]): string => {
  const v = typeof f.value === "number" ? String(Math.round(f.value * 1e6) / 1e6) : f.value;
  return `${v}${f.unit ? ` ${f.unit}` : ""}${f.tolerance > 0 ? ` (±${f.tolerance})` : ""}`;
};

/** REVIEW-QA.md: every question with its expectation, grouped by category, dev / heldout marked. */
export function renderQaReview(
  truths: QaTruth[],
  split: ReturnType<typeof computeQaSplit>,
): string {
  const dev = new Set(split.dev);
  const out: string[] = [
    "# Q&A golden set: review sheet",
    "",
    `${truths.length} questions. Expected answers are computed by reference code over the seeded world (seed ${split.seed}, anchor 2026-11-14T08:00Z, plus the two demo inbox quotes); nothing is typed by hand or written by a model.`,
    "Agent clock for the runs: anchor + 5 minutes. Only Aegean Pioneer has an open bunker requirement (300 mt LSMGO, voyage AP-2611).",
    "",
    "Read each row as: a correct answer cites the facts listed (label, value, unit, tolerance), proposes the listed option for `action`, and never proposes when `mustNotPropose` is true. An approval or execution is never allowed.",
    "",
    `Split: dev ${split.dev.length}, held-out ${split.heldout.length}. ${split.rule}.`,
    "",
  ];
  for (const category of QA_CATEGORIES) {
    const rows = truths.filter((t) => t.tags[0] === category);
    out.push(
      `## ${category} (${rows.length}; dev ${rows.filter((t) => dev.has(t.id)).length})`,
      "",
    );
    for (const t of rows) {
      const e = t.expect;
      out.push(
        `### ${t.id} [${dev.has(t.id) ? "dev" : "heldout"}]`,
        "",
        `- Question: ${esc(t.question)}`,
        `- Expected kind: \`${e.kind}\``,
        `- Must not propose: ${e.mustNotPropose}`,
        `- Proposed option: ${e.proposedOptionId ?? "none"}`,
      );
      if (e.requiredFacts.length === 0) out.push("- Required facts: none");
      else {
        out.push("- Required facts:");
        for (const f of e.requiredFacts) out.push(`  - ${esc(f.label)}: **${esc(showValue(f))}**`);
      }
      out.push("");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function renderQaGolden(): { files: Map<string, string>; truths: QaTruth[] } {
  const world = qaWorld();
  const truths = QUESTIONS.map((q) => buildTruth(world, q));
  const split = computeQaSplit(truths);
  const files = new Map<string, string>();
  for (const t of truths) files.set(`${t.id}.truth.json`, stableJson(t));
  files.set("split.json", qaSplitJson(split));
  files.set("REVIEW-QA.md", renderQaReview(truths, split));
  return { files, truths };
}

const MANAGED = /\.truth\.json$|^split\.json$|^REVIEW-QA\.md$/;

export async function diffQaGolden(files: Map<string, string>, dir: string): Promise<string[]> {
  const onDisk = await readdir(dir).catch(() => [] as string[]);
  const problems: string[] = [];
  for (const [name, content] of files) {
    const current = await readFile(join(dir, name), "utf8").catch(() => null);
    if (current === null) problems.push(`missing: ${name}`);
    else if (current !== content) problems.push(`differs: ${name}`);
  }
  for (const name of onDisk)
    if (!files.has(name) && MANAGED.test(name)) problems.push(`stale: ${name}`);
  return problems.sort();
}

export async function writeQaGolden(files: Map<string, string>, dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const stale = (await readdir(dir)).filter((n) => MANAGED.test(n) && !files.has(n));
  for (const name of stale) await rm(join(dir, name));
  for (const [name, content] of files) await writeFile(join(dir, name), content);
  return stale.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, truths } = renderQaGolden();
  if (process.argv.includes("--check")) {
    const problems = await diffQaGolden(files, QA_GOLDEN_DIR);
    if (problems.length > 0) {
      console.error(
        `qa golden set is not byte-stable (${problems.length}):\n${problems.join("\n")}`,
      );
      process.exit(1);
    }
    console.log(`qa golden set OK: ${files.size} files match (${truths.length} questions)`);
  } else {
    const removed = await writeQaGolden(files, QA_GOLDEN_DIR);
    console.log(
      `wrote ${files.size} files for ${truths.length} questions to ${QA_GOLDEN_DIR}${removed ? ` (removed ${removed} stale)` : ""}`,
    );
  }
}
