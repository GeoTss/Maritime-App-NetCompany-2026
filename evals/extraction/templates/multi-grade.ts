/**
 * Quotes for two grades: the vessel's required grade plus one more with tank capacity. Only the
 * required grade has an open requirement (requirement_found needs one line), and the lines keep
 * the order printed in the email, which is random.
 */
import type { GoldenCase } from "../case.js";
import { drawQuoteFacts } from "../facts.js";
import { prngPick } from "../prng.js";
import { htmlBody } from "./html.js";
import {
  bargeText,
  baseDraft,
  greetingOf,
  introOf,
  labelledOfferLines,
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

export type MultiLayout = "text-grid" | "per-grade" | "html-grid";

export function renderMultiGrade(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawQuoteFacts(prng, world, { currency: "USD", extraGrades: 1 });
  if (prng() < 0.5) facts.lines.reverse();
  const pq = phraseQuote(prng, facts);
  const layout = prngPick(prng, ["text-grid", "per-grade", "html-grid"] as const);
  const from = senderOf(prng, pq);
  let body: { text?: string; html?: string };
  let hints: Parameters<typeof transcribe>[1];
  if (layout === "html-grid") {
    const h = htmlBody(ctx, pq, "grid", from.address);
    body = { html: h.html };
    hints = h.hints;
  } else if (layout === "per-grade") {
    const l = pickLabels(prng);
    body = {
      text: [
        greetingOf(prng),
        "",
        introOf(prng),
        "",
        ...labelledOfferLines(pq, l),
        "",
        ...termsOf(prng),
        "",
        ...signatureOf(prng, pq, from.address),
      ].join("\n"),
    };
    hints = { labels: l, lineLabels: true };
  } else {
    const l = pickLabels(prng);
    const width = Math.max(...pq.lines.map((x) => x.gradeText.length), l.grade.length) + 4;
    const qtyWidth = Math.max(...pq.lines.map((x) => x.qty.asWritten.length), l.qty.length) + 4;
    const row = (a: string, b: string, c: string) =>
      `${a.padEnd(width)}${b.padEnd(qtyWidth)}${c}`.trimEnd();
    const barge = bargeText(pq.barge);
    body = {
      text: [
        greetingOf(prng),
        "",
        introOf(prng),
        "",
        `${l.vessel}: ${pq.vessel.text}`,
        `${l.port}: ${pq.port.text}`,
        ...windowLines(pq.window, l),
        "",
        row(l.grade, l.qty, l.price),
        ...pq.lines.map((x) => row(x.gradeText, x.qty.asWritten, x.price.asWritten)),
        "",
        ...(barge === null ? [] : [`${l.barge}: ${barge}`]),
        `${l.validity}: ${pq.validity}`,
        "",
        ...termsOf(prng),
        "",
        ...signatureOf(prng, pq, from.address),
      ].join("\n"),
    };
    hints = { labels: l, lineLabels: false };
  }
  const tags = [
    "multi_grade",
    `layout:${layout}`,
    `grades:${facts.lines.map((l) => l.grade).join("+")}`,
    `vessel:${pq.vessel.form}`,
    `window:${pq.window.form}`,
    `barge:${pq.barge.kind}`,
  ];
  return {
    truth: quoteTruth(id, tags, facts),
    mail: baseDraft(ctx, pq, body, from, subjectOf(prng, pq)),
    transcription: transcribe(pq, hints),
    note: `Two-grade quote (${facts.lines.map((l) => l.grade).join(" + ")}), ${layout} layout; only one grade has an open requirement.`,
  };
}
