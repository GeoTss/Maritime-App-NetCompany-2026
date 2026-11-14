/** EUR-priced quotes ("EUR", "€"), as plain text or HTML. Price band via the latest EURUSD rate. */
import type { GoldenCase } from "../case.js";
import { drawQuoteFacts } from "../facts.js";
import { prngPick } from "../prng.js";
import { type HtmlLayout, htmlBody } from "./html.js";
import { type PlainLayout, plainBody } from "./plain.js";
import {
  baseDraft,
  phraseQuote,
  quoteTruth,
  senderOf,
  subjectOf,
  type TemplateContext,
  transcribe,
} from "./quote-block.js";

export function renderEur(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawQuoteFacts(prng, world, { currency: "EUR" });
  const pq = phraseQuote(prng, facts);
  const from = senderOf(prng, pq);
  const asHtml = prng() < 0.4;
  const layout = asHtml
    ? prngPick(prng, ["kv-table", "grid", "paragraphs"] as const satisfies HtmlLayout[])
    : prngPick(prng, ["labels", "labels", "prose", "compact"] as const satisfies PlainLayout[]);
  const body = asHtml
    ? htmlBody(ctx, pq, layout as HtmlLayout, from.address)
    : plainBody(ctx, pq, layout as PlainLayout, from.address);
  const tags = [
    "eur",
    `body:${asHtml ? "html" : "plain"}`,
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
      "html" in body ? { html: body.html } : { text: body.text },
      from,
      subjectOf(prng, pq),
    ),
    transcription: transcribe(pq, body.hints),
    note: `EUR-priced quote, ${asHtml ? "HTML" : "plain text"} ${layout} layout.`,
  };
}
