/**
 * Forwarded / revised offers (ruling R22): sent by the supplier's own desk (From is the supplier's
 * domain), the newest complete offer on top and an older offer from the same supplier quoted
 * below with a different price, validity and delivery window. Truth is the newest values.
 */
import type { GoldenCase } from "../case.js";
import { drawPrice, drawQuoteFacts, type QuoteFacts } from "../facts.js";
import { prngInt, prngPick } from "../prng.js";
import { addDays, isoDay, longDate } from "./phrasing.js";
import {
  baseDraft,
  greetingOf,
  labelledOfferLines,
  phraseQuote,
  pickLabels,
  quoteTruth,
  senderOf,
  signatureOf,
  subjectOf,
  type TemplateContext,
  transcribe,
} from "./quote-block.js";

export type ForwardStyle = "outlook" | "gmail-forward" | "reply-quoted";

/** The earlier offer: same vessel, port, grade and qty; another price, validity and window. */
function olderFacts(ctx: TemplateContext, newest: QuoteFacts): QuoteFacts {
  const { prng, world } = ctx;
  const hoursBefore = prngInt(prng, 18, 40);
  const receivedAt = new Date(newest.receivedAt.getTime() - hoursBefore * 3_600_000);
  let price = drawPrice(prng, world, newest.port.id, newest.lines[0]?.grade ?? "LSMGO", "USD");
  if (price === newest.lines[0]?.pricePerMt) price += 4;
  const validUntil = addDays(isoDay(receivedAt), prngInt(prng, 0, 1));
  const shift = prngPick(prng, [-1, 1, 2]);
  return {
    ...newest,
    lines: newest.lines.map((l) => ({ ...l, pricePerMt: price })),
    receivedAt,
    validUntil: validUntil === newest.validUntil ? addDays(validUntil, -1) : validUntil,
    deliveryFrom: addDays(newest.deliveryFrom, shift),
    deliveryTo: addDays(newest.deliveryTo, shift),
  };
}

const two = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;

export function renderForwarded(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawQuoteFacts(prng, world, { currency: "USD" });
  const old = olderFacts(ctx, facts);
  const pq = phraseQuote(prng, facts);
  const pqOld = phraseQuote(prng, old);
  const labels = pickLabels(prng);
  const from = senderOf(prng, pq);
  const style = prngPick(prng, ["outlook", "gmail-forward", "reply-quoted"] as const);
  const oldFrom = `${pqOld.person.first} ${pqOld.person.last} <${pqOld.person.local}@${facts.supplier.emailDomain}>`;
  const oldSubject = subjectOf(prng, pqOld);
  const oldBody = [
    greetingOf(prng),
    "",
    "Please find our offer below.",
    "",
    ...labelledOfferLines(pqOld, labels),
    "",
    ...signatureOf(prng, pqOld, `${pqOld.person.local}@${facts.supplier.emailDomain}`),
  ];
  const top = [
    greetingOf(prng),
    "",
    prngPick(prng, [
      "Please see our revised offer below, which replaces our earlier quotation.",
      "Updated offer below - this supersedes the one sent yesterday.",
      "We are pleased to revise our offer as follows (earlier offer below for reference):",
    ]),
    "",
    ...labelledOfferLines(pq, labels),
    "",
    ...signatureOf(prng, pq, from.address),
    "",
  ];
  const oldDay = isoDay(old.receivedAt);
  let quoted: string[];
  if (style === "outlook") {
    quoted = [
      "-----Original Message-----",
      `From: ${oldFrom}`,
      `Sent: ${longDate(oldDay)} ${hhmm(old.receivedAt)}`,
      "To: Bunker Desk <bunker-desk@pharos-demo.example>",
      `Subject: ${oldSubject}`,
      "",
      ...oldBody,
    ];
  } else if (style === "gmail-forward") {
    quoted = [
      "---------- Forwarded message ---------",
      `From: ${oldFrom}`,
      `Date: ${longDate(oldDay)} at ${hhmm(old.receivedAt)}`,
      `Subject: ${oldSubject}`,
      "To: Bunker Desk <bunker-desk@pharos-demo.example>",
      "",
      ...oldBody,
    ];
  } else {
    quoted = [
      `On ${longDate(oldDay)} at ${hhmm(old.receivedAt)}, ${oldFrom} wrote:`,
      ...oldBody.map((l) => (l === "" ? ">" : `> ${l}`)),
    ];
  }
  const subject = `${style === "reply-quoted" ? "RE" : prngPick(prng, ["FW", "Fwd"])}: ${oldSubject}`;
  const tags = [
    "forwarded",
    `style:${style}`,
    `vessel:${pq.vessel.form}`,
    `window:${pq.window.form}`,
    `barge:${pq.barge.kind}`,
  ];
  return {
    truth: quoteTruth(id, tags, facts),
    mail: baseDraft(ctx, pq, { text: [...top, ...quoted].join("\n") }, from, subject),
    transcription: transcribe(pq, { labels, lineLabels: true }),
    note: `Revised offer on top (${style}); the older offer below has another price, validity and delivery window.`,
  };
}
