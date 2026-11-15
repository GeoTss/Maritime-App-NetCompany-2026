/**
 * The dev / held-out split of the Q&A golden set: stratified by tags[0] (the category), dev count
 * per stratum = ceil(n / 2), the dev questions chosen by sorting the stratum on sha256(seed + id).
 * Random, stable, never hand-picked.
 *
 *   npm run eval:qa-split        rewrites evals/golden/qa/split.json from the truth files
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { QaTruth } from "@pharos/shared";
import { stableJson } from "../extraction/json.js";
import { sha256Hex } from "../extraction/prng.js";
import { EVAL_SEED } from "../extraction/world.js";

export const QA_GOLDEN_DIR = resolve(import.meta.dirname, "../golden/qa");

export interface QaSplit {
  seed: number;
  rule: string;
  strata: Record<string, { total: number; dev: number; heldout: number }>;
  dev: string[];
  heldout: string[];
}

export const devCount = (n: number): number => Math.ceil(n / 2);

export function computeQaSplit(
  cases: readonly { id: string; tags: readonly string[] }[],
  seed: number = EVAL_SEED,
): QaSplit {
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error("duplicate ids");
  const byStratum = new Map<string, string[]>();
  for (const c of cases) {
    const stratum = c.tags[0];
    if (!stratum) throw new Error(`case ${c.id} has no tags[0]`);
    byStratum.set(stratum, [...(byStratum.get(stratum) ?? []), c.id]);
  }
  const dev: string[] = [];
  const heldout: string[] = [];
  const strata: QaSplit["strata"] = {};
  for (const stratum of [...byStratum.keys()].sort()) {
    const ids = byStratum.get(stratum) ?? [];
    const ranked = ids
      .map((id) => ({ id, key: sha256Hex(`${seed}${id}`) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((x) => x.id);
    const n = devCount(ids.length);
    dev.push(...ranked.slice(0, n));
    heldout.push(...ranked.slice(n));
    strata[stratum] = { total: ids.length, dev: n, heldout: ids.length - n };
  }
  return {
    seed,
    rule: "stratified by tags[0]; dev = ceil(n / 2) per stratum, lowest sha256(seed + id) first",
    strata,
    dev: dev.sort(),
    heldout: heldout.sort(),
  };
}

export const qaSplitJson = (split: QaSplit): string => stableJson(split);

export async function readQaTruths(dir: string = QA_GOLDEN_DIR): Promise<QaTruth[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".truth.json")).sort();
  return Promise.all(
    files.map(async (f) => QaTruth.parse(JSON.parse(await readFile(join(dir, f), "utf8")))),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const split = computeQaSplit(await readQaTruths());
  await writeFile(join(QA_GOLDEN_DIR, "split.json"), qaSplitJson(split));
  const summary = Object.entries(split.strata)
    .map(([k, v]) => `${k} ${v.dev}/${v.total}`)
    .join(", ");
  console.log(
    `qa split.json: dev ${split.dev.length}, held-out ${split.heldout.length} (${summary})`,
  );
}
