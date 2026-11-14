/** Plain-text quote emails: labelled lines, short prose, or a compact one-line summary. */
import type { GoldenCase } from "../case.js";
import { drawQuoteFacts } from "../facts.js";
import { prngPick } from "../prng.js";
import {
  bargeText,
  baseDraft,
  greetingOf,
  introOf,
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
} from "./quote-block.js";

export type PlainLayout = "labels" | "prose" | "compact";

/** The plain-text body and the transcription hints for one layout. */
export function plainBody(
  ctx: TemplateContext,
  pq: PhrasedQuote,
  layout: PlainLayout,
  address: string,
) {
  const { prng } = ctx;
  const sig = signatureOf(prng, pq, address);
  const line = pq.lines[0];
  if (layout === "labels" || !line || pq.lines.length > 1) {
    const labels = pickLabels(prng);
    const body = [
      greetingOf(prng),
      "",
      introOf(prng),
      "",
      ...labelledOfferLines(pq, labels),
      "",
      ...termsOf(prng),
      "",
      ...sig,
    ];
    return { text: body.join("\n"), hints: { labels, lineLabels: true } };
  }
  const w = pq.window;
  const windowText = w.kind === "one" ? w.text : `${w.from} to ${w.to}`;
  const barge = bargeText(pq.barge);
  if (layout === "prose") {
    const body = [
      greetingOf(prng),
      "",
      `We are pleased to offer ${line.gradeText} for ${pq.vessel.text} at ${pq.port.text}.`,
      `Quantity ${line.qty.asWritten}, price ${line.price.asWritten}.`,
      w.kind === "one" ? `Delivery ${w.text}.` : `Delivery from ${w.from}, delivery to ${w.to}.`,
      ...(barge === null ? [] : [`Barging ${barge}.`]),
      `This offer is valid until ${pq.validity}.`,
      "",
      ...termsOf(prng),
      "",
      ...sig,
    ];
    return { text: body.join("\n"), hints: {} };
  }
  // compact: one summary line, then the dates.
  const body = [
    prngPick(prng, ["Hi,", "Morning,", "Dear all,"]),
    "",
    `${pq.vessel.text} / ${pq.port.text} / ${line.gradeText} ${line.qty.asWritten} @ ${line.price.asWritten}`,
    w.kind === "one" ? `Delivery: ${windowText}` : `Delivery from: ${w.from}`,
    ...(w.kind === "two" ? [`Delivery to: ${w.to}`] : []),
    ...(barge === null ? [] : [`Barge: ${barge}`]),
    `Valid until: ${pq.validity}`,
    "",
    ...sig,
  ];
  return { text: body.join("\n"), hints: {} };
}

export function renderPlain(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawQuoteFacts(prng, world, { currency: "USD" });
  const pq = phraseQuote(prng, facts);
  const layout = prngPick(prng, ["labels", "labels", "prose", "compact"] as const);
  const from = senderOf(prng, pq);
  const { text, hints } = plainBody(ctx, pq, layout, from.address);
  const tags = [
    "plain",
    `layout:${layout}`,
    `vessel:${pq.vessel.form}`,
    `window:${pq.window.form}`,
    `barge:${pq.barge.kind}`,
  ];
  return {
    truth: quoteTruth(id, tags, facts),
    mail: baseDraft(ctx, pq, { text }, from, subjectOf(prng, pq)),
    transcription: transcribe(pq, hints),
    note: `Plain-text quote, ${layout} layout.`,
  };
}
