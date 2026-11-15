import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AIS_BOXES } from "../ais/boxes.js";
import { createLiveAis } from "../ais/live.js";
import { normaliseAisMessage } from "../ais/normalise.js";
import { flag, requireAisKey } from "./args.js";

const apiKey = requireAisKey("smoke:ais");
const seconds = Math.min(Number(flag(process.argv, "seconds") ?? 20) || 20, 120);

let messages = 0;
let positions = 0;
let dropped = 0;
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), seconds * 1000);
const at = new Date();

await createLiveAis({ apiKey, boxes: AIS_BOXES.demo ?? [] }).run((raw) => {
  messages++;
  const obs = normaliseAisMessage(raw);
  if (!obs) dropped++;
  else if (obs.kind === "position") positions++;
}, ctrl.signal);
clearTimeout(timer);

const stamp = at
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z");
const dir = join("evals", "reports", `${stamp}-smoke-ais`);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "summary.json"),
  `${JSON.stringify({ at: at.toISOString(), seconds, messages, positions, dropped }, null, 2)}\n`,
);
console.log(
  `smoke:ais: ${messages} messages, ${positions} positions, ${dropped} dropped in ${seconds} s`,
);
if (positions < 1) {
  console.error("smoke:ais: no position parsed");
  process.exit(1);
}
