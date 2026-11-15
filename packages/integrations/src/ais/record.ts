import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normaliseAisMessage } from "./normalise.js";
import type { AisProvider } from "./types.js";

export interface RecordResult {
  written: boolean;
  messages: number;
  positions: number;
  hazardMessages: number;
  skipped: number;
}

/**
 * Record raw messages from `provider` to `out` (one `{offsetMs, message}` per line) until `seconds`
 * pass or `maxMessages` are kept. A run that received no position writes nothing, so a good capture
 * is never replaced by an empty one.
 */
export async function recordCapture(opts: {
  provider: AisProvider;
  out: string;
  seconds: number;
  maxMessages: number;
  now?: () => number;
}): Promise<RecordResult> {
  const now = opts.now ?? Date.now;
  const lines: string[] = [];
  const start = now();
  let positions = 0;
  let hazardMessages = 0;
  let skipped = 0;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.seconds * 1000);
  await opts.provider.run((raw) => {
    const obs = normaliseAisMessage(raw);
    if (!obs) {
      skipped++;
      return;
    }
    if (obs.kind === "position") positions++;
    else if (obs.kind !== "static") hazardMessages++;
    lines.push(JSON.stringify({ offsetMs: now() - start, message: raw }));
    if (lines.length >= opts.maxMessages) ctrl.abort();
  }, ctrl.signal);
  clearTimeout(timer);

  const result = { messages: lines.length, positions, hazardMessages, skipped };
  if (positions === 0) return { written: false, ...result };
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, `${lines.join("\n")}\n`);
  return { written: true, ...result };
}
