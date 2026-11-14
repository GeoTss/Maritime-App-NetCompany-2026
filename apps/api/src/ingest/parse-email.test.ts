import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateWorld } from "@pharos/db";
import { describe, expect, it } from "vitest";
import { buildDemoEmails, FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";
import { EmailParseError, parseEmail } from "./parse-email.js";

const INBOX = new URL("../../../../fixtures/demo-inbox/", import.meta.url);
const demo = buildDemoEmails(generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR }));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("parseEmail", () => {
  it("parses the Kestrel demo email: sender address, subject, Date, body and sha256 of the raw bytes", async () => {
    const raw = new Uint8Array(await readFile(new URL("01-kestrel-marsaxlokk.eml", INBOX)));
    const parsed = await parseEmail(raw);
    expect(parsed.sender).toBe("bunkers@kestrel-fuels.example");
    expect(parsed.subject).toBe("LSMGO offer - MV Aegean Pioneer - Marsaxlokk");
    expect(parsed.receivedAt?.toISOString()).toBe("2026-11-14T03:00:00.000Z");
    expect(parsed.sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    // CRLF on disk, LF in the stored body: identical to the fixture inbox body.
    expect(parsed.bodyText).toBe(demo[0]?.bodyText);
  });

  it("parses the Strait Line demo email body as plain text (no attachment present)", async () => {
    const raw = new Uint8Array(await readFile(new URL("02-straitline-gibraltar.eml", INBOX)));
    const parsed = await parseEmail(raw);
    expect(parsed.sender).toBe("sales@straitline-fuels.example");
    expect(parsed.bodyText).toBe(demo[2]?.bodyText);
  });

  it("converts an HTML-only body to text", async () => {
    const raw = bytes(
      [
        "From: Quotes <QUOTES@Nordwind-Bunker.example>",
        "Subject: Offer",
        "Date: Sat, 14 Nov 2026 05:00:00 +0000",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<html><body><p>Price: <b>EUR 690 / mt</b></p><p>Barge fee: EUR 3,000 lump sum</p></body></html>",
        "",
      ].join("\r\n"),
    );
    const parsed = await parseEmail(raw);
    expect(parsed.sender).toBe("quotes@nordwind-bunker.example");
    expect(parsed.bodyText).toContain("Price: EUR 690 / mt");
    expect(parsed.bodyText).toContain("Barge fee: EUR 3,000 lump sum");
    expect(parsed.bodyText).not.toContain("<");
  });

  it("returns receivedAt null when there is no usable Date header", async () => {
    const raw = bytes("From: a@b.example\r\nSubject: x\r\n\r\nhello\r\n");
    expect((await parseEmail(raw)).receivedAt).toBeNull();
    const bad = bytes("From: a@b.example\r\nDate: not a date\r\n\r\nhello\r\n");
    expect((await parseEmail(bad)).receivedAt).toBeNull();
  });

  it("rejects an empty message and a message with no text body", async () => {
    await expect(parseEmail(new Uint8Array())).rejects.toBeInstanceOf(EmailParseError);
    await expect(
      parseEmail(bytes("From: a@b.example\r\nSubject: empty\r\n\r\n   \r\n")),
    ).rejects.toBeInstanceOf(EmailParseError);
  });
});
