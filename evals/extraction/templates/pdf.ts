/**
 * Quotes delivered as a PDF attachment (with a real text layer) under a short cover note. The
 * cover note never carries the offer's values; the PDF is a supplier letterhead with labelled
 * rows, or a grade grid.
 */
import type { GoldenCase } from "../case.js";
import { drawQuoteFacts } from "../facts.js";
import { buildTextPdf, type PdfRow } from "../pdf.js";
import { prngPick } from "../prng.js";
import { longDate } from "./phrasing.js";
import {
  bargeText,
  baseDraft,
  labelledOfferLines,
  type PhrasedQuote,
  phraseQuote,
  pickLabels,
  quoteTruth,
  senderOf,
  signatureOf,
  subjectOf,
  type TemplateContext,
  termsOf,
  transcribe,
  windowLines,
} from "./quote-block.js";

export type PdfLayout = "letter" | "grid";

const isoDayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function pdfOffer(ctx: TemplateContext, pq: PhrasedQuote, layout: PdfLayout) {
  const { prng } = ctx;
  const l = pickLabels(prng);
  const { supplier } = pq.facts;
  const rows: PdfRow[] = [
    { text: supplier.name.toUpperCase(), bold: true, size: 15 },
    { text: `Trading desk: trading@${supplier.emailDomain}` },
    { gap: 10 },
    { text: "BUNKER OFFER", bold: true, size: 12 },
    { text: `Ref: ${pq.ref}` },
    { text: `Issued: ${longDate(isoDayOf(pq.facts.receivedAt))}` },
    { gap: 8 },
  ];
  let hints: Parameters<typeof transcribe>[1];
  if (layout === "letter") {
    rows.push(...labelledOfferLines(pq, l).map((text) => ({ text })));
    hints = { labels: l, lineLabels: true };
  } else {
    rows.push(
      { text: `${l.vessel}: ${pq.vessel.text}` },
      { text: `${l.port}: ${pq.port.text}` },
      ...windowLines(pq.window, l).map((text) => ({ text })),
      { gap: 6 },
      {
        cells: [
          { text: l.grade, x: 0, bold: true },
          { text: l.qty, x: 170, bold: true },
          { text: l.price, x: 290, bold: true },
        ],
      },
      ...pq.lines.map((line) => ({
        cells: [
          { text: line.gradeText, x: 0 },
          { text: line.qty.asWritten, x: 170 },
          { text: line.price.asWritten, x: 290 },
        ],
      })),
      { gap: 6 },
    );
    const barge = bargeText(pq.barge);
    if (barge !== null) rows.push({ text: `${l.barge}: ${barge}` });
    rows.push({ text: `${l.validity}: ${pq.validity}` });
    hints = { labels: l, lineLabels: false };
  }
  rows.push(
    { gap: 10 },
    ...termsOf(prng).map((text) => ({ text, size: 9 })),
    { gap: 10 },
    { text: `For and on behalf of ${supplier.name}`, bold: true },
  );
  return { pdf: await buildTextPdf(rows), hints };
}

export function coverNote(ctx: TemplateContext, pq: PhrasedQuote, address: string): string {
  const { prng } = ctx;
  const sig = signatureOf(prng, pq, address);
  return [
    prngPick(prng, ["Dear Sirs,", "Dear Bunker Desk,", "Good afternoon,", "Hello,"]),
    "",
    prngPick(prng, [
      "Please find our offer attached.",
      "Attached please find our quotation as requested.",
      "Our offer is in the attached PDF.",
      "As requested, our offer is attached for your review.",
    ]),
    ...[prngPick(prng, ["Looking forward to your nomination.", "Happy to discuss.", ""])].filter(
      (l) => l !== "",
    ),
    "",
    ...sig,
  ].join("\n");
}

export async function renderPdf(ctx: TemplateContext): Promise<GoldenCase> {
  const { prng, world, id } = ctx;
  const facts = drawQuoteFacts(prng, world, { currency: "USD" });
  const pq = phraseQuote(prng, facts);
  const layout = prngPick(prng, ["letter", "grid"] as const);
  const from = senderOf(prng, pq);
  const { pdf, hints } = await pdfOffer(ctx, pq, layout);
  const filename = `${pq.ref}.pdf`;
  const tags = [
    "pdf",
    `layout:${layout}`,
    `vessel:${pq.vessel.form}`,
    `window:${pq.window.form}`,
    `barge:${pq.barge.kind}`,
  ];
  return {
    truth: quoteTruth(id, tags, facts),
    mail: baseDraft(
      ctx,
      pq,
      {
        text: coverNote(ctx, pq, from.address),
        attachments: [{ filename, contentType: "application/pdf", content: pdf }],
      },
      from,
      subjectOf(prng, pq),
    ),
    transcription: transcribe(pq, hints),
    note: `Offer only in a PDF attachment (${layout} layout) under a cover note.`,
  };
}
