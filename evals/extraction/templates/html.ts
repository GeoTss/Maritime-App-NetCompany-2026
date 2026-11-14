/**
 * HTML-only quote emails (no text/plain part): a two-column table, a grade grid, or labelled
 * paragraphs. parseEmail converts the HTML with html-to-text (tables as data tables).
 */
import type { GoldenCase } from "../case.js";
import { drawQuoteFacts } from "../facts.js";
import { prngPick } from "../prng.js";
import {
  bargeText,
  baseDraft,
  greetingOf,
  introOf,
  type Labels,
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

export type HtmlLayout = "kv-table" | "grid" | "paragraphs";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Label/value pairs of the offer header (everything except the grade lines). */
function headerPairs(pq: PhrasedQuote, l: Labels): [string, string][] {
  const w = pq.window;
  const pairs: [string, string][] = [
    [l.vessel, pq.vessel.text],
    [l.port, pq.port.text],
    ...(w.kind === "one"
      ? ([[l.delivery, w.text]] as [string, string][])
      : ([
          [l.deliveryFrom, w.from],
          [l.deliveryTo, w.to],
        ] as [string, string][])),
  ];
  return pairs;
}

function tailPairs(pq: PhrasedQuote, l: Labels): [string, string][] {
  const barge = bargeText(pq.barge);
  return [
    ...(barge === null ? [] : [[l.barge, barge] as [string, string]]),
    [l.validity, pq.validity],
  ];
}

function linePairs(pq: PhrasedQuote, l: Labels): [string, string][] {
  return pq.lines.flatMap((line, i) => {
    const n = pq.lines.length > 1 ? ` ${i + 1}` : "";
    return [
      [`${l.grade}${n}`, line.gradeText],
      [l.qty, line.qty.asWritten],
      [l.price, line.price.asWritten],
    ] as [string, string][];
  });
}

const STYLE = "font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a";

/** The HTML body for one layout and the transcription hints that hold for it. */
export function htmlBody(
  ctx: TemplateContext,
  pq: PhrasedQuote,
  layout: HtmlLayout,
  address: string,
) {
  const { prng } = ctx;
  const l = pickLabels(prng);
  const sig = signatureOf(prng, pq, address);
  const kvRows = (pairs: [string, string][], th: boolean) =>
    pairs
      .map(([k, v]) =>
        th
          ? `<tr><th align="left">${esc(k)}</th><td>${esc(v)}</td></tr>`
          : `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`,
      )
      .join("\n");
  const parts: string[] = [
    "<!DOCTYPE html>",
    `<html><head><meta charset="utf-8"><title>Offer ${esc(pq.ref)}</title></head>`,
    `<body style="${STYLE}">`,
    `<p>${esc(greetingOf(prng))}</p>`,
    `<p>${esc(introOf(prng))}</p>`,
  ];
  let hints: Parameters<typeof transcribe>[1];
  if (layout === "kv-table") {
    const th = prng() < 0.5;
    parts.push(
      '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">',
      kvRows([...headerPairs(pq, l), ...linePairs(pq, l), ...tailPairs(pq, l)], th),
      "</table>",
    );
    hints = { labels: l, lineLabels: true };
  } else if (layout === "grid") {
    parts.push(
      '<table cellpadding="3">',
      kvRows(headerPairs(pq, l), false),
      "</table>",
      "<br>",
      '<table border="1" cellpadding="4" cellspacing="0">',
      `<tr><th>${esc(l.grade)}</th><th>${esc(l.qty)}</th><th>${esc(l.price)}</th></tr>`,
      ...pq.lines.map(
        (line) =>
          `<tr><td>${esc(line.gradeText)}</td><td>${esc(line.qty.asWritten)}</td><td>${esc(line.price.asWritten)}</td></tr>`,
      ),
      "</table>",
      ...tailPairs(pq, l).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`),
    );
    hints = { labels: l, lineLabels: false };
  } else {
    parts.push(
      ...[...headerPairs(pq, l), ...linePairs(pq, l), ...tailPairs(pq, l)].map(
        ([k, v]) => `<p style="margin:2px 0"><b>${esc(k)}:</b> ${esc(v)}</p>`,
      ),
    );
    hints = { labels: l, lineLabels: true };
  }
  parts.push(
    `<p style="font-size:11px;color:#555">${termsOf(prng).map(esc).join("<br>\n")}</p>`,
    `<p>${sig.map(esc).join("<br>\n")}</p>`,
    "</body></html>",
  );
  return { html: parts.join("\n"), hints };
}

export function renderHtml(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawQuoteFacts(prng, world, { currency: "USD" });
  const pq = phraseQuote(prng, facts);
  const layout = prngPick(prng, ["kv-table", "grid", "paragraphs"] as const);
  const from = senderOf(prng, pq);
  const { html, hints } = htmlBody(ctx, pq, layout, from.address);
  const tags = [
    "html",
    `layout:${layout}`,
    `vessel:${pq.vessel.form}`,
    `window:${pq.window.form}`,
    `barge:${pq.barge.kind}`,
  ];
  return {
    truth: quoteTruth(id, tags, facts),
    mail: baseDraft(ctx, pq, { html }, from, subjectOf(prng, pq)),
    transcription: transcribe(pq, hints),
    note: `HTML-only quote, ${layout} layout.`,
  };
}
