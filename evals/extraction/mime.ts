/**
 * Deterministic RFC 5322 / MIME rendering for golden emails: fixed boundaries derived from the
 * case id, CRLF line endings, 8bit UTF-8 text parts, base64 attachments. No clock, no randomness.
 */
import type { Mailbox, MailDraft } from "./case.js";

const CRLF = "\r\n";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const two = (n: number) => String(n).padStart(2, "0");

/** RFC 5322 date in UTC, e.g. "Fri, 13 Nov 2026 09:40:00 +0000". */
export function rfc5322Date(d: Date): string {
  return (
    `${WEEKDAYS[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ` +
    `${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:` +
    `${two(d.getUTCSeconds())} +0000`
  );
}

const ascii = (s: string, what: string): string => {
  if (/[^\x20-\x7e]/.test(s)) throw new Error(`${what} must be printable ASCII: ${s}`);
  return s;
};

const mailbox = (m: Mailbox): string =>
  `${ascii(m.name.includes(",") ? `"${m.name}"` : m.name, "display name")} <${ascii(m.address, "address")}>`;

/** CRLF text with no bare CR/LF and no line over 998 octets. */
function crlfText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > 998) throw new Error("MIME line longer than 998 octets");
  }
  return lines.join(CRLF);
}

function base64Lines(content: Uint8Array | string): string {
  const b64 = Buffer.from(typeof content === "string" ? Buffer.from(content, "utf8") : content)
    .toString("base64")
    .replace(/.{1,76}/g, (line) => `${line}${CRLF}`);
  return b64.endsWith(CRLF) ? b64.slice(0, -CRLF.length) : b64;
}

const textPart = (subtype: "plain" | "html", body: string): string =>
  [
    `Content-Type: text/${subtype}; charset=utf-8`,
    "Content-Transfer-Encoding: 8bit",
    "",
    crlfText(body),
  ].join(CRLF);

function multipart(subtype: string, boundary: string, parts: string[]): string {
  return [
    `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
    "",
    ...parts.flatMap((p) => [`--${boundary}`, p]),
    `--${boundary}--`,
  ].join(CRLF);
}

/** The whole message as text with CRLF line endings and a final CRLF. */
export function renderMime(draft: MailDraft, boundaryKey: string): string {
  if (draft.text === undefined && draft.html === undefined) {
    throw new Error("a golden email needs a text or an html body");
  }
  const headers = [
    `From: ${mailbox(draft.from)}`,
    `To: ${mailbox(draft.to)}`,
    ...(draft.cc && draft.cc.length > 0 ? [`Cc: ${draft.cc.map(mailbox).join(", ")}`] : []),
    `Subject: ${ascii(draft.subject, "subject")}`,
    `Date: ${rfc5322Date(draft.date)}`,
    `Message-ID: <${ascii(draft.messageId, "message id")}>`,
    ...(draft.inReplyTo
      ? [`In-Reply-To: <${draft.inReplyTo}>`, `References: <${draft.inReplyTo}>`]
      : []),
    "MIME-Version: 1.0",
  ];

  let body: string;
  if (draft.text !== undefined && draft.html !== undefined) {
    body = multipart("alternative", `=_alt_${boundaryKey}`, [
      textPart("plain", draft.text),
      textPart("html", draft.html),
    ]);
  } else if (draft.text !== undefined) {
    body = textPart("plain", draft.text);
  } else {
    body = textPart("html", draft.html as string);
  }

  const attachments = draft.attachments ?? [];
  if (attachments.length > 0) {
    const parts = attachments.map((a) =>
      [
        `Content-Type: ${a.contentType}; name="${ascii(a.filename, "filename")}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        base64Lines(a.content),
      ].join(CRLF),
    );
    body = multipart("mixed", `=_mix_${boundaryKey}`, [body, ...parts]);
  }
  return `${headers.join(CRLF)}${CRLF}${body}${CRLF}`;
}
