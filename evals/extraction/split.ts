/**
 * The dev / held-out split of the extraction golden set (ruling R20): stratified by tags[0],
 * dev count per stratum = ceil(n x 60/220), the dev cases chosen by sorting the stratum on
 * sha256(seed + id). Random, stable, never hand-picked.
 *
 * Dev-only trap variants (user decision 2026-11-14): cases tagged `variant:v2` form their own
 * stratum, `hard-variant`, with dev fraction 1, so every one is in dev. They are second versions
 * of the 20 hard traps, added so the dev gate exercises each trap; the 220 approved cases keep
 * exactly the split they had before the variants existed.
 *
 *   npm run eval:split        rewrites evals/golden/extraction/split.json from the truth files
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ExtractionTruth } from "@pharos/shared";
import { stableJson } from "./json.js";
import { sha256Hex } from "./prng.js";
import { EVAL_SEED } from "./world.js";

export const GOLDEN_DIR = resolve(import.meta.dirname, "../golden/extraction");
export const DEV_SHARE = { dev: 60, of: 220 } as const;

export interface Split {
  seed: number;
  rule: string;
  strata: Record<string, { total: number; dev: number; heldout: number }>;
  dev: string[];
  heldout: string[];
}

export const devCount = (n: number): number => Math.ceil((n * DEV_SHARE.dev) / DEV_SHARE.of);

/** Tag of the dev-only trap variants, and their stratum (all of it in dev). */
export const VARIANT_TAG = "variant:v2";
export const VARIANT_STRATUM = "hard-variant";

const stratumOf = (tags: readonly string[]): string | undefined =>
  tags.includes(VARIANT_TAG) ? VARIANT_STRATUM : tags[0];

export function computeSplit(
  cases: readonly { id: string; tags: readonly string[] }[],
  seed: number = EVAL_SEED,
): Split {
  const byStratum = new Map<string, string[]>();
  for (const c of cases) {
    const stratum = stratumOf(c.tags);
    if (!stratum) throw new Error(`case ${c.id} has no tags[0]`);
    byStratum.set(stratum, [...(byStratum.get(stratum) ?? []), c.id]);
  }
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error("duplicate case ids");
  const dev: string[] = [];
  const heldout: string[] = [];
  const strata: Split["strata"] = {};
  for (const stratum of [...byStratum.keys()].sort()) {
    const ids = byStratum.get(stratum) ?? [];
    const ranked = ids
      .map((id) => ({ id, key: sha256Hex(`${seed}${id}`) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((x) => x.id);
    const n = stratum === VARIANT_STRATUM ? ids.length : devCount(ids.length);
    dev.push(...ranked.slice(0, n));
    heldout.push(...ranked.slice(n));
    strata[stratum] = { total: ids.length, dev: n, heldout: ids.length - n };
  }
  return {
    seed,
    rule: "stratified by tags[0]; dev = ceil(n * 60 / 220) per stratum, lowest sha256(seed + id) first; dev-only trap variants (tag variant:v2, stratum hard-variant) are all dev",
    strata,
    dev: dev.sort(),
    heldout: heldout.sort(),
  };
}

export const splitJson = (split: Split): string => stableJson(split);

/** The split of the truth files on disk. */
export async function splitFromDisk(dir: string = GOLDEN_DIR): Promise<Split> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".truth.json")).sort();
  const cases = await Promise.all(
    files.map(async (f) => ExtractionTruth.parse(JSON.parse(await readFile(join(dir, f), "utf8")))),
  );
  return computeSplit(cases);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const split = await splitFromDisk();
  await writeFile(join(GOLDEN_DIR, "split.json"), splitJson(split));
  const summary = Object.entries(split.strata)
    .map(([k, v]) => `${k} ${v.dev}/${v.total}`)
    .join(", ");
  console.log(`split.json: dev ${split.dev.length}, held-out ${split.heldout.length} (${summary})`);
}
