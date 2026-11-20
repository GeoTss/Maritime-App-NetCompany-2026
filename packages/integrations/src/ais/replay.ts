import { readFile } from "node:fs/promises";
import { AisCaptureLine } from "@pharos/shared";
import { type AisProvider, abortableSleep } from "./types.js";

/** Parse a capture file; lines that are not a valid capture line are skipped. */
export function parseCapture(text: string): AisCaptureLine[] {
  const out: AisCaptureLine[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = AisCaptureLine.safeParse(JSON.parse(line) as unknown);
      if (parsed.success) out.push(parsed.data);
    } catch {
      // a truncated line (e.g. an interrupted recording) is skipped
    }
  }
  return out;
}

export async function readCaptureFile(path: string): Promise<AisCaptureLine[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`recorded AIS capture not found at ${path}; run npm run record:ais`);
    }
    throw err;
  }
  return parseCapture(text);
}

/** Replays a capture at its original timing divided by `speed` (Infinity emits at once). */
export function createReplayAis(opts: {
  path: string;
  speed?: number;
  loop?: boolean;
}): AisProvider {
  const speed = opts.speed ?? 1;
  return {
    mode: "replay",
    async run(onMessage, signal) {
      const lines = await readCaptureFile(opts.path);
      if (lines.length === 0) return;
      do {
        let prev = 0;
        for (const l of lines) {
          if (signal.aborted) return;
          const wait = (l.offsetMs - prev) / speed;
          prev = l.offsetMs;
          if (Number.isFinite(wait) && wait > 0) await abortableSleep(wait, signal);
          if (signal.aborted) return;
          onMessage(l.message);
        }
        // Between laps, so a looping replay at Infinity speed cannot spin.
        if (opts.loop) await abortableSleep(1_000, signal);
      } while (opts.loop && !signal.aborted);
    },
  };
}
