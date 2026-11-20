/**
 * Records the live extraction of every demo inbox email into RECORDINGS_DIR, for the replay tests.
 * Run on the host (the key stays in .env and is never printed):
 *
 *   LLM_MODE=record LLM_FALLBACKS=off npx tsx --env-file=.env apps/api/src/ingest/record-demo-extractions.ts
 *
 * Uses the fixed recording config below (not EXTRACT_MODEL / EXTRACT_EFFORT), so the request
 * bodies match what the replay tests send. Stops if the run's cost passes MAX_RUN_USD.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { captureLlmCall } from "../ai/call-capture.js";
import { createLlmExtractor, ExtractionError, type ExtractorConfig } from "../ai/extract.js";
import { type CallMetrics, createLlm } from "../ai/llm.js";
import { costUsd, promptTokensOf } from "../ai/pricing.js";
import { DEFAULT_RECORDINGS_DIR } from "../config.js";
import { DEMO_INBOX_DIR } from "../inbox/routes.js";
import { parseEmail } from "./parse-email.js";

/** The extraction config every committed recording was made with (Haiku defaults). */
export const DEMO_RECORDING_CONFIG: ExtractorConfig = {
  extractModel: "claude-haiku-5-5",
  extractEffort: "medium",
  llmFallbacks: false,
};

const MAX_RUN_USD = 0.25;

async function main() {
  if (process.env.LLM_MODE !== "record") {
    throw new Error("Run with LLM_MODE=record (this script only records).");
  }
  if (process.env.LLM_FALLBACKS && process.env.LLM_FALLBACKS !== "off") {
    throw new Error("Run with LLM_FALLBACKS=off: recordings are made without fallbacks.");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env).");

  const llm = createLlm({
    mode: "record",
    apiKey,
    recordingsDir: DEFAULT_RECORDINGS_DIR,
    onCall: captureLlmCall,
  });
  const extractor = createLlmExtractor(llm, DEMO_RECORDING_CONFIG);
  const files = (await readdir(DEMO_INBOX_DIR)).filter((f) => f.endsWith(".eml")).sort();

  let total = 0;
  const report = (file: string, m: CallMetrics) => {
    const cost = costUsd(m.model, m.usage, promptTokensOf(m.usage));
    total += cost;
    console.log(
      [
        file,
        `key=${m.requestKey.slice(0, 12)}`,
        m.model,
        `in=${m.usage.input_tokens}`,
        `out=${m.usage.output_tokens}`,
        `cacheRead=${m.usage.cache_read_input_tokens ?? 0}`,
        `cacheWrite=${m.usage.cache_creation_input_tokens ?? 0}`,
        `stop=${m.stopReason}`,
        `latencyMs=${Math.round(m.latencyMs)}`,
        `costUsd=${cost.toFixed(6)}`,
      ].join(" "),
    );
  };

  for (const file of files) {
    const email = await parseEmail(new Uint8Array(await readFile(join(DEMO_INBOX_DIR, file))));
    try {
      const { output, metrics } = await extractor.extract(email);
      for (const m of metrics) report(file, m);
      console.log(`${file}: kind=${output.kind}`);
    } catch (err) {
      if (err instanceof ExtractionError) for (const m of err.metrics) report(file, m);
      throw err;
    }
    if (total > MAX_RUN_USD) {
      throw new Error(`Run cost ${total.toFixed(4)} USD exceeds ${MAX_RUN_USD} USD; stopping.`);
    }
  }
  console.log(`total costUsd=${total.toFixed(6)} for ${files.length} recordings`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[record] ${(err as Error).message}`);
    process.exit(1);
  });
}
