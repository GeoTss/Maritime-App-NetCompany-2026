import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoInboxFiles, DEMO_INBOX_DIR } from "./make-demo-inbox.js";

describe("demo inbox fixtures", () => {
  const files = buildDemoInboxFiles();

  it("reproduces the committed .eml files byte for byte", () => {
    expect(files.map((f) => f.name)).toEqual([
      "01-kestrel-marsaxlokk.eml",
      "02-straitline-gibraltar.eml",
    ]);
    for (const f of files) {
      expect(readFileSync(join(DEMO_INBOX_DIR, f.name)).equals(f.content), f.name).toBe(true);
    }
  });

  it("is RFC 5322 shaped: CRLF only, required headers, fixed Date and Message-ID", () => {
    for (const f of files) {
      const text = f.content.toString("utf8");
      expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      const [head] = text.split("\r\n\r\n");
      for (const h of ["From:", "To:", "Subject:", "Date:", "Message-ID:", "MIME-Version: 1.0"]) {
        expect(head).toContain(h);
      }
      expect(head).toContain("Content-Type: text/plain; charset=utf-8");
      expect(head).toMatch(/Date: \w{3}, \d{2} \w{3} 2026 \d{2}:\d{2}:\d{2} \+0000/);
    }
  });

  it("uses each supplier's seeded email domain as sender", () => {
    const [kes, str] = files.map((f) => f.content.toString("utf8"));
    expect(kes).toContain("From: Kestrel");
    expect(kes).toContain("@kestrel-fuels.example>");
    expect(str).toContain("@straitline-fuels.example>");
  });
});
