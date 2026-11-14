/**
 * Raw RFC 5322 bytes -> the fields the ingestion workflow stores. Deterministic: the same bytes
 * always give the same result (no clock; a missing Date header gives `receivedAt: null`).
 */
import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import PostalMime from "postal-mime";
import { extractPdfText } from "./pdf-text.js";

export interface ParsedEmail {
  /** The From address, lowercased; null when the message has no single mailbox sender. */
  sender: string | null;
  subject: string | null;
  /** From the Date header; null when it is missing or does not parse. */
  receivedAt: Date | null;
  /**
   * Plain-text body (HTML-only bodies converted), then each attachment's text under a
   * `--- attachment: <filename> ---` marker. LF line endings, trailing whitespace removed.
   */
  bodyText: string;
  /** Every real attachment in MIME order (inline images such as signature logos are not listed). */
  attachments: ParsedAttachment[];
  /** True when a PDF or image attachment yielded no text: a human must look at it. */
  hasUnreadableAttachment: boolean;
  /** sha256 of the raw bytes, lowercase hex. */
  sha256: string;
}

export interface ParsedAttachment {
  filename: string | null;
  /** Lowercased MIME type. */
  contentType: string;
  /** Extracted text; null when the type is unsupported or no text could be read. */
  text: string | null;
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

const normalise = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\s+$/, "");

/** Text of one attachment, or null. A damaged PDF is doubt (null), never a crash. */
async function attachmentText(
  contentType: string,
  content: Uint8Array | string,
): Promise<string | null> {
  let text = "";
  if (contentType === "application/pdf" && typeof content !== "string") {
    try {
      text = await extractPdfText(content);
    } catch {
      return null;
    }
  } else if (contentType === "text/html") {
    text = htmlToText(typeof content === "string" ? content : new TextDecoder().decode(content));
  }
  const normalised = normalise(text);
  return normalised.trim() === "" ? null : normalised;
}

export async function parseEmail(raw: Uint8Array): Promise<ParsedEmail> {
  if (raw.byteLength === 0) throw new EmailParseError("The email is empty.");
  let email: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    email = await PostalMime.parse(raw);
  } catch (err) {
    throw new EmailParseError(`The email could not be parsed: ${(err as Error).message}`);
  }

  const body = normalise(
    email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : "",
  );

  const attachments: ParsedAttachment[] = [];
  let hasUnreadableAttachment = false;
  for (const a of email.attachments) {
    const contentType = a.mimeType.toLowerCase();
    const isImage = contentType.startsWith("image/");
    // An inline image (Content-ID or inline disposition, e.g. a signature logo) is not an attachment.
    if (isImage && (a.contentId || a.disposition === "inline")) continue;
    const text = await attachmentText(
      contentType,
      typeof a.content === "string" ? a.content : new Uint8Array(a.content),
    );
    if (text === null && (isImage || contentType === "application/pdf")) {
      hasUnreadableAttachment = true;
    }
    attachments.push({ filename: a.filename || null, contentType, text });
  }

  let bodyText = body;
  for (const a of attachments) {
    if (a.text === null) continue;
    bodyText += `${bodyText === "" ? "" : "\n\n"}--- attachment: ${a.filename ?? "(unnamed)"} ---\n${a.text}`;
  }
  if (bodyText.trim() === "") throw new EmailParseError("The email has no text body.");

  const from = email.from && "address" in email.from ? email.from.address : undefined;
  const date = email.date ? new Date(email.date) : null;

  return {
    sender: from ? from.trim().toLowerCase() : null,
    subject: email.subject?.trim() || null,
    receivedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    bodyText,
    attachments,
    hasUnreadableAttachment,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}
