/**
 * The shape of one golden extraction case before it is written to disk: the truth (written
 * first, from the case's spec), the email rendered from that spec, and the perfect transcription
 * of the rendered email (as-written spans only; evidence lines are attached later from the text
 * the extractor actually sees, see oracle.ts).
 */
import type { ExtractionTruth } from "@pharos/shared";

/** A text field as written. `near`: a word on the line the evidence should come from, if any. */
export interface TextSpan {
  value: string;
  near?: string;
}

export interface AmountSpan {
  value: number | null;
  unit: string | null;
  asWritten: string;
  near?: string;
}

export interface MoneySpan {
  value: number | null;
  currency: string | null;
  perUnit: string | null;
  asWritten: string;
  near?: string;
}

export interface DateSpan {
  asWritten: string;
  near?: string;
}

export interface LineTranscription {
  grade: TextSpan | null;
  quantity: AmountSpan | null;
  price: MoneySpan | null;
}

export interface QuoteTranscription {
  kind: "quote";
  supplierName: TextSpan | null;
  vesselName: TextSpan | null;
  vesselImo: TextSpan | null;
  port: TextSpan | null;
  deliveryFrom: DateSpan | null;
  deliveryTo: DateSpan | null;
  validUntil: DateSpan | null;
  bargeFee: MoneySpan | null;
  lines: LineTranscription[];
}

export interface NotAQuoteTranscription {
  kind: "not_a_quote";
  reason: string;
  /** Text on the line that shows what the document is; that whole line becomes the evidence. */
  evidence: TextSpan;
}

export type Transcription = QuoteTranscription | NotAQuoteTranscription;

export interface Mailbox {
  name: string;
  address: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  content: Uint8Array | string;
}

/** Everything needed to render one RFC 5322 message deterministically. */
export interface MailDraft {
  from: Mailbox;
  to: Mailbox;
  cc?: Mailbox[];
  subject: string;
  date: Date;
  /** Without angle brackets. */
  messageId: string;
  inReplyTo?: string;
  /** Plain-text body; at least one of text and html. */
  text?: string;
  html?: string;
  attachments?: Attachment[];
}

export interface GoldenCase {
  truth: ExtractionTruth;
  mail: MailDraft;
  transcription: Transcription;
  /** For REVIEW.md: what makes the case tricky (hard cases) or which variants it uses. */
  note: string;
}

/** The desk that receives every golden email. */
export const DESK: Mailbox = { name: "Bunker Desk", address: "bunker-desk@pharos-demo.example" };

/** Our own company domain (not a supplier): internal forwarders write from here. */
export const OWN_DOMAIN = "pharos-demo.example";
