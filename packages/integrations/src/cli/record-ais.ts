import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AIS_BOXES } from "../ais/boxes.js";
import { createLiveAis } from "../ais/live.js";
import { normaliseAisMessage } from "../ais/normalise.js";
import { RECORDED_DIR } from "../recorded.js";
import { flag, requireAisKey } from "./args.js";

const MAX_SECONDS = 600;
const MAX_MESSAGES = 6000;

const apiKey = requireAisKey("record:ais");
const bboxName = flag(process.argv, "bbox") ?? "demo";
const boxes = AIS_BOXES[bboxName];
if (!boxes) {
  console.error(
    `record:ais: unknown --bbox "${bboxName}"; known: ${Object.keys(AIS_BOXES).join(", ")}`,
  );
  process.exit(1);
}
const seconds = Math.min(Number(flag(process.argv, "seconds") ?? 240) || 240, MAX_SECONDS);
const out = join(RECORDED_DIR, "ais-capture.jsonl");

const lines: string[] = [];
const start = Date.now();
let positions = 0;
let skipped = 0;
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), seconds * 1000);

console.log(
  `record:ais: recording the "${bboxName}" boxes for up to ${seconds} s (max ${MAX_MESSAGES} messages)`,
);
await createLiveAis({ apiKey, boxes }).run((raw) => {
  const obs = normaliseAisMessage(raw);
  if (!obs) {
    skipped++;
    return;
  }
  if (obs.kind === "position") positions++;
  lines.push(JSON.stringify({ offsetMs: Date.now() - start, message: raw }));
  if (lines.length >= MAX_MESSAGES) ctrl.abort();
}, ctrl.signal);
clearTimeout(timer);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(
  `record:ais: wrote ${lines.length} messages (${positions} positions, ${skipped} skipped) to ${out}`,
);
