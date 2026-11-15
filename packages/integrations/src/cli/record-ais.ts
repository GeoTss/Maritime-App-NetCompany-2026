import { join } from "node:path";
import { AIS_BOXES } from "../ais/boxes.js";
import { createLiveAis } from "../ais/live.js";
import { recordCapture } from "../ais/record.js";
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

console.log(
  `record:ais: recording the "${bboxName}" boxes for up to ${seconds} s (max ${MAX_MESSAGES} messages)`,
);
const r = await recordCapture({
  provider: createLiveAis({ apiKey, boxes }),
  out,
  seconds,
  maxMessages: MAX_MESSAGES,
});
if (!r.written) {
  console.error(`record:ais: no position received in ${seconds} s; ${out} left unchanged`);
  process.exit(1);
}
console.log(
  `record:ais: wrote ${r.messages} messages (${r.positions} positions, ${r.hazardMessages} hazard messages, ${r.skipped} skipped) to ${out}`,
);
