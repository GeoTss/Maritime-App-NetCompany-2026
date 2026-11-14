/**
 * Generates the extraction golden set: 200 generated cases from the seeded PRNG (truth first,
 * then rendered through templates) plus the 20 hand-specified hard cases.
 *
 *   npm run eval:golden              write evals/golden/extraction/ (removes stale case files)
 *   npm run eval:golden -- --check   exit 1 if any file on disk differs (byte-stable)
 *
 * Per case: <id>.truth.json, <id>.eml, <id>.oracle.json. Plus split.json and REVIEW.md.
 * No clock, no network, no model: the same code always writes the same bytes.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { World } from "@pharos/db";
import { ExtractionTruth } from "@pharos/shared";
import { type ExtractInput, sourceText } from "../../apps/api/src/ai/extract.js";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import type { GoldenCase } from "./case.js";
import { HARD_CASES, renderHardCase } from "./hard-cases.js";
import { stableJson } from "./json.js";
import { renderMime } from "./mime.js";
import { buildOracle } from "./oracle.js";
import { casePrng, sha256Hex } from "./prng.js";
import { type ReviewCase, renderReview } from "./review.js";
import { computeSplit, GOLDEN_DIR, splitJson } from "./split.js";
import { renderEur } from "./templates/eur.js";
import { renderForwarded } from "./templates/forwarded.js";
import { renderHtml } from "./templates/html.js";
import { renderMultiGrade } from "./templates/multi-grade.js";
import { NOT_A_QUOTE_KINDS, renderNotAQuote } from "./templates/not-a-quote.js";
import { renderPdf } from "./templates/pdf.js";
import { renderPlain } from "./templates/plain.js";
import type { Template } from "./templates/quote-block.js";
import { EVAL_SEED, evalWorld } from "./world.js";

/** Generated categories: id prefix, count, template. tags[0] is set by each template. */
export const GENERATED: readonly { prefix: string; count: number; template: Template }[] = [
  { prefix: "plain", count: 40, template: renderPlain },
  { prefix: "html", count: 30, template: renderHtml },
  { prefix: "pdf", count: 30, template: renderPdf },
  { prefix: "eur", count: 25, template: renderEur },
  { prefix: "multi-grade", count: 20, template: renderMultiGrade },
  { prefix: "forwarded", count: 15, template: renderForwarded },
  {
    prefix: "not-a-quote",
    count: 40,
    // Kinds in rotation: 7 each of the first four, 6 each of the last two.
    template: (ctx) => {
      const n = Number(ctx.id.slice(-3)) - 1;
      return renderNotAQuote(ctx, NOT_A_QUOTE_KINDS[n % NOT_A_QUOTE_KINDS.length] ?? "invoice");
    },
  },
];

export async function buildCases(world: World): Promise<GoldenCase[]> {
  const cases: GoldenCase[] = [];
  for (const { prefix, count, template } of GENERATED) {
    for (let i = 1; i <= count; i++) {
      const id = `${prefix}-${String(i).padStart(3, "0")}`;
      cases.push(await template({ world, prng: casePrng(EVAL_SEED, id), id }));
    }
  }
  for (const spec of HARD_CASES) cases.push(await renderHardCase(spec));
  return cases;
}

export interface RenderedCase {
  truth: ExtractionTruth;
  eml: string;
  /** What the extractor reads, from parseEmail of the .eml bytes. */
  doc: ExtractInput;
  receivedAt: Date | null;
  hasUnreadableAttachment: boolean;
  oracle: ReturnType<typeof buildOracle>;
  review: ReviewCase;
}

export async function renderCase(c: GoldenCase): Promise<RenderedCase> {
  const truth = ExtractionTruth.parse(c.truth);
  const eml = renderMime(c.mail, sha256Hex(`boundary:${truth.id}`).slice(0, 24));
  const parsed = await parseEmail(new TextEncoder().encode(eml));
  const doc: ExtractInput = {
    sender: parsed.sender,
    subject: parsed.subject,
    bodyText: parsed.bodyText,
  };
  const oracle = buildOracle(c.transcription, doc);
  return {
    truth,
    eml,
    doc,
    receivedAt: parsed.receivedAt,
    hasUnreadableAttachment: parsed.hasUnreadableAttachment,
    oracle,
    review: {
      truth,
      seen: sourceText(doc),
      receivedAt: parsed.receivedAt,
      attachments: parsed.attachments,
      note: c.note,
    },
  };
}

/** Every golden file, by name, with its exact contents. */
export async function renderGoldenFiles(world: World = evalWorld()): Promise<{
  files: Map<string, string>;
  cases: RenderedCase[];
}> {
  const cases = await Promise.all((await buildCases(world)).map(renderCase));
  const ids = cases.map((c) => c.truth.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate golden case ids");
  const files = new Map<string, string>();
  for (const c of cases) {
    files.set(`${c.truth.id}.truth.json`, stableJson(c.truth));
    files.set(`${c.truth.id}.eml`, c.eml);
    files.set(`${c.truth.id}.oracle.json`, stableJson(c.oracle));
  }
  files.set("split.json", splitJson(computeSplit(cases.map((c) => c.truth))));
  files.set(
    "REVIEW.md",
    renderReview(
      world,
      cases.map((c) => c.review),
    ),
  );
  return { files, cases };
}

const CASE_FILE = /\.(?:truth\.json|oracle\.json|eml)$/;

/** Names of files that differ from, are missing in, or are extra in `dir`. */
export async function diffGolden(files: Map<string, string>, dir: string): Promise<string[]> {
  const onDisk = await readdir(dir).catch(() => [] as string[]);
  const problems: string[] = [];
  for (const [name, content] of files) {
    const current = await readFile(join(dir, name), "utf8").catch(() => null);
    if (current === null) problems.push(`missing: ${name}`);
    else if (current !== content) problems.push(`differs: ${name}`);
  }
  for (const name of onDisk) {
    if (
      !files.has(name) &&
      (CASE_FILE.test(name) || name === "split.json" || name === "REVIEW.md")
    ) {
      problems.push(`stale: ${name}`);
    }
  }
  return problems.sort();
}

export async function writeGolden(files: Map<string, string>, dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const stale = (await readdir(dir)).filter((n) => CASE_FILE.test(n) && !files.has(n));
  for (const name of stale) await rm(join(dir, name));
  for (const [name, content] of files) await writeFile(join(dir, name), content);
  return stale.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const { files, cases } = await renderGoldenFiles();
  if (check) {
    const problems = await diffGolden(files, GOLDEN_DIR);
    if (problems.length > 0) {
      console.error(`golden set is not byte-stable (${problems.length}):\n${problems.join("\n")}`);
      process.exit(1);
    }
    console.log(`golden set OK: ${files.size} files match (${cases.length} cases)`);
  } else {
    const removed = await writeGolden(files, GOLDEN_DIR);
    console.log(
      `wrote ${files.size} files for ${cases.length} cases to ${GOLDEN_DIR}${removed ? ` (removed ${removed} stale)` : ""}`,
    );
  }
}
