/**
 * Raw RFC 5322 bytes -> the fields the ingestion workflow stores. Deterministic: the same bytes
 * always give the same result (no clock; a missing Date header gives `receivedAt: null`).
 */
import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import PostalMime from "postal-mime";

export interface ParsedEmail {
  /** The From address, lowercased; null when the message has no single mailbox sender. */
  sender: string | null;
  subject: string | null;
  /** From the Date header; null when it is missing or does not parse. */
  receivedAt: Date | null;
  /** Plain-text body (HTML-only bodies converted), LF line endings, trailing whitespace removed. */
  bodyText: string;
  /** sha256 of the raw bytes, lowercase hex. */
  sha256: string;
}

export class EmailParseError extends Error {
  override name = "EmailParseError";
}

function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [{ selector: "table", format: "dataTable" }],
  });
}

export async function parseEmail(raw: Uint8Array): Promise<ParsedEmail> {
  if (raw.byteLength === 0) throw new EmailParseError("The email is empty.");
  let email: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    email = await PostalMime.parse(raw);
  } catch (err) {
    throw new EmailParseError(`The email could not be parsed: ${(err as Error).message}`);
  }

  const text = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : "";
  const bodyText = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  if (bodyText.trim() === "") throw new EmailParseError("The email has no text body.");

  const from = email.from && "address" in email.from ? email.from.address : undefined;
  const date = email.date ? new Date(email.date) : null;

  return {
    sender: from ? from.trim().toLowerCase() : null,
    subject: email.subject?.trim() || null,
    receivedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    bodyText,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}
