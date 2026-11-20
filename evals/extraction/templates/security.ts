/**
 * Generated security-quote emails (Track 3): plain text (labelled, prose or compact), HTML only
 * (a two-column table or a price grid) and a PDF attachment under a cover note (a letter or a
 * grid). Truth first (security-facts.ts), then the email rendered from it: never the reverse.
 */
import type { GoldenCase } from "../case.js";
import { prngPick } from "../prng.js";
import { drawSecurityFacts } from "../security-facts.js";
import type { TemplateContext } from "./quote-block.js";
import {
  phraseSecurity,
  type SecurityPhrase,
  securityCoverNote,
  securityDraft,
  securityHtmlBody,
  securityPdfOffer,
  securityPlainBody,
  securitySender,
  securitySubject,
  securityTruth,
  transcribeSecurity,
} from "./security-block.js";

const tagsOf = (category: string, layout: string, sp: SecurityPhrase): string[] => [
  category,
  `layout:${layout}`,
  `vessel:${sp.vessel.form}`,
  `team:${sp.team.form}`,
  `fees:${sp.fees.form}`,
  `route:${sp.facts.embark.unlocode}-${sp.facts.disembark?.unlocode ?? "none"}`,
];

export function renderSecurityPlain(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawSecurityFacts(prng, world, { currency: "USD" });
  const sp = phraseSecurity(prng, facts);
  const layout = prngPick(prng, ["labels", "labels", "prose", "compact"] as const);
  const from = securitySender(prng, sp);
  const { text, hints } = securityPlainBody(prng, sp, layout, from.address);
  return {
    truth: securityTruth(id, tagsOf("security-plain", layout, sp), facts),
    mail: securityDraft(id, sp, { text }, from, securitySubject(prng, sp)),
    transcription: transcribeSecurity(sp, hints),
    note: `Plain-text security quote, ${layout} layout.`,
  };
}

export function renderSecurityHtml(ctx: TemplateContext): GoldenCase {
  const { prng, world, id } = ctx;
  const facts = drawSecurityFacts(prng, world, { currency: "USD" });
  const sp = phraseSecurity(prng, facts);
  const layout = prngPick(prng, ["kv-table", "kv-table", "grid"] as const);
  const from = securitySender(prng, sp);
  const { html, hints } = securityHtmlBody(prng, sp, layout, from.address);
  return {
    truth: securityTruth(id, tagsOf("security-html", layout, sp), facts),
    mail: securityDraft(id, sp, { html }, from, securitySubject(prng, sp)),
    transcription: transcribeSecurity(sp, hints),
    note: `HTML-only security quote, ${layout === "grid" ? "price grid" : "two-column table"}.`,
  };
}

export async function renderSecurityPdf(ctx: TemplateContext): Promise<GoldenCase> {
  const { prng, world, id } = ctx;
  const facts = drawSecurityFacts(prng, world, { currency: "USD" });
  const sp = phraseSecurity(prng, facts);
  const layout = prngPick(prng, ["letter", "grid"] as const);
  const from = securitySender(prng, sp);
  const { pdf, hints } = await securityPdfOffer(prng, sp, layout);
  return {
    truth: securityTruth(id, tagsOf("security-pdf", layout, sp), facts),
    mail: securityDraft(
      id,
      sp,
      {
        text: securityCoverNote(prng, sp, from.address),
        attachments: [{ filename: `${sp.ref}.pdf`, contentType: "application/pdf", content: pdf }],
      },
      from,
      securitySubject(prng, sp),
    ),
    transcription: transcribeSecurity(sp, hints),
    note: `Security quote only in a PDF attachment (${layout} layout) under a cover note.`,
  };
}
