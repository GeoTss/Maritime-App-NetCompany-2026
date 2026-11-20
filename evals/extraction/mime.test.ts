import { describe, expect, it } from "vitest";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import { DESK, type MailDraft } from "./case.js";
import { renderMime, rfc5322Date } from "./mime.js";
import { buildTextPdf } from "./pdf.js";

const base: MailDraft = {
  from: {
    name: "Maria Vella - Kestrel Marine Fuels",
    address: "maria.vella@kestrel-fuels.example",
  },
  to: DESK,
  subject: "LSMGO offer - MV Aegean Pioneer - Marsaxlokk",
  date: new Date("2026-11-13T09:40:00Z"),
  messageId: "abc123@kestrel-fuels.example",
};
const bytes = (s: string) => new TextEncoder().encode(s);

describe("renderMime", () => {
  it("writes an RFC 5322 date in UTC", () => {
    expect(rfc5322Date(new Date("2026-11-13T09:40:05Z"))).toBe("Fri, 13 Nov 2026 09:40:05 +0000");
  });

  it("renders a text email that parseEmail reads back exactly (CRLF on disk, final CRLF)", async () => {
    const eml = renderMime({ ...base, text: "Price: €690/mt\n\nRegards," }, "k1");
    expect(eml).toMatch(/\r\n$/);
    expect(eml.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const p = await parseEmail(bytes(eml));
    expect(p.sender).toBe("maria.vella@kestrel-fuels.example");
    expect(p.subject).toBe(base.subject);
    expect(p.receivedAt?.toISOString()).toBe("2026-11-13T09:40:00.000Z");
    expect(p.bodyText).toBe("Price: €690/mt\n\nRegards,");
  });

  it("renders HTML-only and multipart/mixed with a PDF attachment, deterministically", async () => {
    const pdf = await buildTextPdf([{ text: "Price: USD 738 per mt" }]);
    const draft: MailDraft = {
      ...base,
      text: "See attached.",
      attachments: [{ filename: "offer.pdf", contentType: "application/pdf", content: pdf }],
    };
    const a = renderMime(draft, "k2");
    expect(renderMime(draft, "k2")).toBe(a);
    expect(a).toContain('boundary="=_mix_k2"');
    const p = await parseEmail(bytes(a));
    expect(p.bodyText).toBe(
      "See attached.\n\n--- attachment: offer.pdf ---\nPrice: USD 738 per mt",
    );
    const html = await parseEmail(
      bytes(renderMime({ ...base, html: "<p>Port: <b>Genoa</b></p>" }, "k3")),
    );
    expect(html.bodyText).toBe("Port: Genoa");
  });

  it("refuses non-ASCII headers and an email without a body", () => {
    expect(() => renderMime({ ...base, subject: "Offer – Genoa", text: "x" }, "k")).toThrow(
      /ASCII/,
    );
    expect(() => renderMime(base, "k")).toThrow(/body/);
  });
});
