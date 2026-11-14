import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateWorld } from "@pharos/db";
import { PDFDocument, StandardFonts } from "pdf-lib";
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

  describe("attachments", () => {
    const pdfBytes = async (text?: string) => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage();
      if (text)
        page.drawText(text, {
          font: await doc.embedFont(StandardFonts.Helvetica),
          size: 12,
          x: 50,
          y: 700,
        });
      return doc.save();
    };
    const mime = (parts: string[], body = "See attached.") =>
      bytes(
        [
          "From: a@b.example",
          "Subject: Offer",
          "MIME-Version: 1.0",
          'Content-Type: multipart/mixed; boundary="B"',
          "",
          "--B",
          "Content-Type: text/plain; charset=utf-8",
          "",
          body,
          ...parts.flatMap((p) => ["--B", p]),
          "--B--",
          "",
        ].join("\r\n"),
      );
    const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
    const part = (headers: string[], content: string) => [...headers, "", content].join("\r\n");
    const pdfPart = (u: Uint8Array, name = "quote.pdf") =>
      part(
        [
          `Content-Type: application/pdf; name="${name}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${name}"`,
        ],
        b64(u),
      );

    it("appends a PDF attachment's text after the marker line", async () => {
      const parsed = await parseEmail(mime([pdfPart(await pdfBytes("Price EUR 690 per mt"))]));
      expect(parsed.bodyText).toBe(
        "See attached.\n\n--- attachment: quote.pdf ---\nPrice EUR 690 per mt",
      );
      expect(parsed.attachments).toEqual([
        { filename: "quote.pdf", contentType: "application/pdf", text: "Price EUR 690 per mt" },
      ]);
      expect(parsed.hasUnreadableAttachment).toBe(false);
    });

    it("is deterministic for the same bytes", async () => {
      const raw = mime([pdfPart(await pdfBytes("Price EUR 690 per mt"))]);
      expect(await parseEmail(raw)).toEqual(await parseEmail(raw));
    });

    it("accepts an empty body when the PDF has text, with no leading blank lines", async () => {
      const parsed = await parseEmail(mime([pdfPart(await pdfBytes("Offer text"))], ""));
      expect(parsed.bodyText).toBe("--- attachment: quote.pdf ---\nOffer text");
    });

    it("flags an image-only PDF as unreadable: text null, no marker", async () => {
      const parsed = await parseEmail(mime([pdfPart(await pdfBytes())]));
      expect(parsed.attachments).toEqual([
        { filename: "quote.pdf", contentType: "application/pdf", text: null },
      ]);
      expect(parsed.hasUnreadableAttachment).toBe(true);
      expect(parsed.bodyText).toBe("See attached.");
    });

    it("treats a corrupt PDF as unreadable instead of throwing", async () => {
      const parsed = await parseEmail(mime([pdfPart(bytes("this is not a pdf"))]));
      expect(parsed.attachments[0]?.text).toBeNull();
      expect(parsed.hasUnreadableAttachment).toBe(true);
    });

    it("still rejects an email with no body and no attachment text", async () => {
      await expect(parseEmail(mime([pdfPart(await pdfBytes())], ""))).rejects.toBeInstanceOf(
        EmailParseError,
      );
    });

    it("turns an HTML table attachment into data-table text", async () => {
      const html =
        "<html><body><table><tr><th>Item</th><th>Price</th></tr><tr><td>LSMGO</td><td>EUR 690</td></tr></table></body></html>";
      const parsed = await parseEmail(
        mime([
          part(
            [
              'Content-Type: TEXT/HTML; name="offer.html"',
              'Content-Disposition: attachment; filename="offer.html"',
            ],
            html,
          ),
        ]),
      );
      expect(parsed.attachments[0]).toMatchObject({
        filename: "offer.html",
        contentType: "text/html",
      });
      expect(parsed.bodyText).toContain("--- attachment: offer.html ---\n");
      expect(parsed.bodyText).toMatch(/ITEM\s+PRICE/);
      expect(parsed.bodyText).toMatch(/LSMGO\s+EUR 690/);
      expect(parsed.bodyText).not.toContain("<");
      expect(parsed.hasUnreadableAttachment).toBe(false);
    });

    it("lists an unsupported type with null text without flagging it, and uses (unnamed) for no filename", async () => {
      const parsed = await parseEmail(
        mime([
          part(["Content-Type: application/zip", "Content-Disposition: attachment"], "UEsDBA=="),
          pdfPart(await pdfBytes("Hello")).replace(
            /; name="quote.pdf"|; filename="quote.pdf"/g,
            "",
          ),
        ]),
      );
      expect(parsed.attachments.map((a) => [a.filename, a.contentType, a.text])).toEqual([
        [null, "application/zip", null],
        [null, "application/pdf", "Hello"],
      ]);
      expect(parsed.hasUnreadableAttachment).toBe(false);
      expect(parsed.bodyText).toContain("--- attachment: (unnamed) ---\nHello");
    });

    it("flags a real image attachment but ignores an inline cid logo", async () => {
      const png = "iVBORw0KGgo=";
      const logo = part(
        [
          'Content-Type: image/png; name="logo.png"',
          "Content-Transfer-Encoding: base64",
          "Content-ID: <logo@sig>",
          'Content-Disposition: inline; filename="logo.png"',
        ],
        png,
      );
      const inlineOnly = await parseEmail(mime([logo]));
      expect(inlineOnly.attachments).toEqual([]);
      expect(inlineOnly.hasUnreadableAttachment).toBe(false);

      const scan = part(
        [
          'Content-Type: IMAGE/JPEG; name="scan.jpg"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename="scan.jpg"',
        ],
        png,
      );
      const withScan = await parseEmail(mime([logo, scan]));
      expect(withScan.attachments).toEqual([
        { filename: "scan.jpg", contentType: "image/jpeg", text: null },
      ]);
      expect(withScan.hasUnreadableAttachment).toBe(true);
    });

    it("reports no attachments for a plain email", async () => {
      const parsed = await parseEmail(bytes("From: a@b.example\r\n\r\nhello\r\n"));
      expect(parsed.attachments).toEqual([]);
      expect(parsed.hasUnreadableAttachment).toBe(false);
    });
  });
});
