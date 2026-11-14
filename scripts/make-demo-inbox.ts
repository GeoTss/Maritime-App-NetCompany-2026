// Builds fixtures/demo-inbox/*.eml from the demo emails in apps/api/src/read/fixtures.ts so the
// inbox's "Deliver next email" bodies stay byte-identical to the fixture inbox bodies.
// Pinned world: anchor 2026-11-14T08:00:00Z, seed 20261114. Run: npx tsx scripts/make-demo-inbox.ts [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorld } from "@pharos/db";
import { buildDemoEmails, FIXTURE_ANCHOR, FIXTURE_SEED } from "../apps/api/src/read/fixtures.js";

export const DEMO_INBOX_DIR = join(import.meta.dirname, "../fixtures/demo-inbox");
const DESK_ADDRESS = "bunker-desk@pharos-demo.example";

/** Demo emails delivered in Phase 2, in delivery (filename) order: file name -> index into buildDemoEmails. */
const FILES: { name: string; index: number }[] = [
  { name: "01-kestrel-marsaxlokk.eml", index: 0 },
  { name: "02-straitline-gibraltar.eml", index: 2 },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

function rfc5322Date(d: Date): string {
  return `${DAYS[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}

export function buildDemoInboxFiles(): { name: string; content: Buffer }[] {
  const world = generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR });
  const emails = buildDemoEmails(world);
  return FILES.map(({ name, index }) => {
    const e = emails[index];
    if (!e) throw new Error(`demo email ${index} missing`);
    const domain = e.sender.split("@")[1];
    const headers = [
      `From: ${e.supplierName} <${e.sender}>`,
      `To: Bunker Desk <${DESK_ADDRESS}>`,
      `Subject: ${e.subject}`,
      `Date: ${rfc5322Date(e.receivedAt)}`,
      `Message-ID: <${name.replace(/\.eml$/, "")}@${domain}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
    ];
    const body = e.bodyText.replace(/\r?\n/g, "\r\n");
    return { name, content: Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`, "utf8") };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = buildDemoInboxFiles();
  if (process.argv.includes("--check")) {
    const stale = files.filter((f) => {
      const path = join(DEMO_INBOX_DIR, f.name);
      return !existsSync(path) || !readFileSync(path).equals(f.content);
    });
    if (stale.length > 0) {
      console.error(`demo inbox out of date: ${stale.map((f) => f.name).join(", ")}`);
      process.exit(1);
    }
    console.log("demo inbox up to date");
  } else {
    mkdirSync(DEMO_INBOX_DIR, { recursive: true });
    for (const f of files) writeFileSync(join(DEMO_INBOX_DIR, f.name), f.content);
    console.log(`wrote ${files.length} files to ${DEMO_INBOX_DIR}`);
  }
}
