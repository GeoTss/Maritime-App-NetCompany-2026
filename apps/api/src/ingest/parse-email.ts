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
  /**
   * True when an attachment yielded no text (a scanned PDF, an image, a spreadsheet, a Word file,
   * an attached email, ...): a human must look at it. Inline images (signature logos) and
   * attachments that carry no offer (calendar invites, contact cards, signatures) never set it.
   */
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

const isPdf = (contentType: string, filename: string | null) =>
  contentType === "application/pdf" || (filename?.toLowerCase().endsWith(".pdf") ?? false);

/** Plain text or CSV, by type or by a .txt / .csv filename: read as UTF-8 text. */
const isPlainText = (contentType: string, filename: string | null) =>
  contentType === "text/plain" ||
  contentType === "text/csv" ||
  /\.(?:txt|csv)$/i.test(filename ?? "");

/** Attachment types that carry no offer, so having no text is not a reason for review. */
const NO_OFFER_TYPES = new Set([
  "text/calendar",
  "application/ics",
  "text/vcard",
  "text/x-vcard",
  "text/directory",
  "application/pkcs7-signature",
  "application/x-pkcs7-signature",
  "application/pgp-signature",
  "application/pgp-keys",
]);
/** The same kinds sent under a generic type: an invite, a contact card, an S/MIME signature. */
const NO_OFFER_EXTENSION = /\.(?:ics|vcf|p7s)$/i;

const carriesNoOffer = (contentType: string, filename: string | null) =>
  NO_OFFER_TYPES.has(contentType) || NO_OFFER_EXTENSION.test(filename ?? "");

/**
 * Decoded text that is really binary (a spreadsheet or archive labelled text/plain): a NUL, or
 * more than 1 in 20 characters a control or replacement character.
 */
function looksBinary(text: string): boolean {
  if (text.includes("\u0000")) return true;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
  const odd = text.match(/[\u0001-\u0008\u000e-\u001f\ufffd]/g)?.length ?? 0;
  return text.length > 0 && odd / text.length > 0.05;
}

/** Marker-safe filename: attacker text can't fake a marker line. Only the marker is sanitised. */
function markerName(filename: string | null): string {
  const clean = (filename ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
    .replace(/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .slice(0, 120)
    .trim();
  return clean === "" ? "(unnamed)" : clean;
}

/** Text of one attachment, or null. A damaged PDF is doubt (null), never a crash. */
async function attachmentText(
  contentType: string,
  filename: string | null,
  content: Uint8Array | string,
): Promise<string | null> {
  let text = "";
  if (isPdf(contentType, filename) && typeof content !== "string") {
    try {
      text = await extractPdfText(content);
    } catch {
      return null;
    }
  } else if (contentType === "text/html") {
    text = htmlToText(typeof content === "string" ? content : new TextDecoder().decode(content));
  } else if (isPlainText(contentType, filename)) {
    text = typeof content === "string" ? content : new TextDecoder().decode(content);
    if (looksBinary(text)) return null;
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
    const filename = a.filename || null;
    const text = await attachmentText(
      contentType,
      filename,
      typeof a.content === "string" ? a.content : new Uint8Array(a.content),
    );
    // Any attachment that yields no text may hold the offer, unless its type never does.
    if (text === null && !carriesNoOffer(contentType, filename)) hasUnreadableAttachment = true;
    attachments.push({ filename, contentType, text });
  }

  let bodyText = body;
  for (const a of attachments) {
    if (a.text === null) continue;
    bodyText += `${bodyText === "" ? "" : "\n\n"}--- attachment: ${markerName(a.filename)} ---\n${a.text}`;
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
