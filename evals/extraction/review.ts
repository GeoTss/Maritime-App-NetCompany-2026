/**
 * REVIEW.md: the sample sheet a human domain reviewer reads before any paid run. All hard cases
 * plus a stratified random sample of generated cases, each with the email exactly as the
 * extractor sees it next to the truth in readable form. Deterministic (no clock).
 */
import type { World } from "@pharos/db";
import { SUPPLIERS } from "@pharos/db";
import type { ExtractionTruth, FuelGrade, TruthQuote } from "@pharos/shared";
import { sha256Hex } from "./prng.js";
import { computeSplit, type Split } from "./split.js";
import { EVAL_SEED, eurUsd, marketPriceUsd, openRequirementOf } from "./world.js";

export const REVIEW_GENERATED_SAMPLE = 15;

export interface ReviewCase {
  truth: ExtractionTruth;
  /** sourceText of the parsed email: what the extractor reads. */
  seen: string;
  receivedAt: Date | null;
  attachments: { filename: string | null; contentType: string; text: string | null }[];
  note: string;
}

/** Largest-remainder allocation of `total` over strata proportional to their sizes. */
function allocate(sizes: [string, number][], total: number): Map<string, number> {
  const all = sizes.reduce((a, [, n]) => a + n, 0);
  const exact = sizes.map(([k, n]) => ({ k, q: (n * total) / all }));
  const out = new Map(exact.map(({ k, q }) => [k, Math.floor(q)]));
  let left = total - [...out.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.q - Math.floor(b.q) - (a.q - Math.floor(a.q)) || (a.k < b.k ? -1 : 1),
  );
  for (const { k } of byRemainder) {
    if (left-- <= 0) break;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** The generated cases shown in REVIEW.md: stratified by tags[0], chosen by sha256 order. */
export function reviewSample(truths: ExtractionTruth[], seed: number = EVAL_SEED): string[] {
  const generated = truths.filter((t) => t.source === "generated");
  const strata = new Map<string, string[]>();
  for (const t of generated) {
    const k = t.tags[0] as string;
    strata.set(k, [...(strata.get(k) ?? []), t.id]);
  }
  const sizes = [...strata.entries()].map(([k, ids]) => [k, ids.length] as [string, number]);
  const quota = allocate(sizes, REVIEW_GENERATED_SAMPLE);
  return [...strata.entries()].flatMap(([k, ids]) =>
    ids
      .map((id) => ({ id, key: sha256Hex(`review:${seed}:${id}`) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, quota.get(k) ?? 0)
      .map((x) => x.id)
      .sort(),
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const NA = "— (not determinable)";
const show = (v: string | number | null) => (v === null ? NA : String(v));
const pad = (label: string) => `${label}:`.padEnd(15);
const fmtUtc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;

function quoteLines(world: World, q: TruthQuote): string[] {
  const vessel = world.vessels.find((v) => v.imo === q.vesselImo);
  const port = world.ports.find((p) => p.unlocode === q.portUnlocode);
  const supplier = SUPPLIERS.find((s) => s.key === q.supplierKey);
  const out = [
    `${pad("Vessel")}${q.vesselImo === null ? NA : `${q.vesselImo}  ${vessel?.name ?? "?"}`}`,
    `${pad("Port")}${q.portUnlocode === null ? NA : `${q.portUnlocode}  ${port?.name ?? "?"}`}`,
    `${pad("Supplier")}${q.supplierKey === null ? `${NA}  (sender domain is not a supplier)` : `${q.supplierKey}  ${supplier?.name ?? "?"}  (from the sender domain)`}`,
    `${pad("Currency")}${show(q.currency)}`,
    `${pad("Valid until")}${show(q.validUntil)}`,
    `${pad("Delivery")}${show(q.deliveryFrom)} to ${show(q.deliveryTo)}`,
    `${pad("Barge fee")}${show(q.bargeFee)}${q.bargeFee === 0 ? "  (not charged separately)" : "  (total, quote currency)"}`,
    "Lines:",
    ...q.lines.map(
      (l, i) =>
        `  ${i + 1}. ${show(l.grade)}  qty ${l.qtyMt === null ? NA : `${l.qtyMt} mt`}  price ${l.pricePerMt === null ? NA : `${l.pricePerMt} per mt`}`,
    ),
  ];
  // Context the reviewer needs to judge the checks (world facts, not truth).
  const context: string[] = [];
  if (vessel) {
    const req = openRequirementOf(world, vessel.id);
    context.push(`open requirement: ${req.grade} ${req.qtyMt} mt`);
    for (const l of q.lines) {
      if (!l.grade) continue;
      context.push(`${l.grade} tank capacity ${vessel.tankCapacityMt[l.grade as FuelGrade]} mt`);
    }
  }
  if (port) {
    for (const l of q.lines) {
      if (!l.grade) continue;
      const market = marketPriceUsd(world, port.id, l.grade);
      let band = "";
      if (l.pricePerMt !== null && q.currency !== null) {
        const usd = l.pricePerMt * (q.currency === "EUR" ? eurUsd(world) : 1);
        band = `; quote = USD ${usd.toFixed(2)} (${pct(usd / market - 1)}, band ±15 %)`;
      }
      context.push(`${l.grade} market at ${port.unlocode} USD ${market.toFixed(2)}${band}`);
    }
  }
  return context.length > 0 ? [...out, "", "World context:", ...context.map((c) => `  ${c}`)] : out;
}

function truthBlock(world: World, c: ReviewCase): string {
  const e = c.truth.expected;
  const lines = [
    `${pad("Status")}${e.status}`,
    `${pad("Review checks")}${e.reviewChecks.length === 0 ? "(none)" : e.reviewChecks.join(", ")}`,
    `${pad("Kind")}${e.kind}`,
    `${pad("Received")}${c.receivedAt ? fmtUtc(c.receivedAt) : "(no Date header)"}`,
    "",
    ...(e.quote === null
      ? [e.kind === "quote" ? "Quote values: none (content unreadable)" : "No quote values."]
      : quoteLines(world, e.quote)),
  ];
  return lines.join("\n");
}

function caseSection(world: World, c: ReviewCase, heading: string): string {
  const att = c.attachments.map(
    (a) =>
      `${a.filename ?? "(unnamed)"} (${a.contentType}${a.text === null ? ", no readable text" : ""})`,
  );
  return [
    `### ${heading}`,
    "",
    `Tags: \`${c.truth.tags.join("`, `")}\`${att.length > 0 ? `  ·  Attachments: ${att.join("; ")}` : ""}`,
    "",
    c.truth.source === "hard" ? `**What is tricky:** ${c.note}` : `_${c.note}_`,
    "",
    // Each <pre> opens its own HTML block (blank lines around it), so blank lines inside the
    // email do not end the table early in CommonMark renderers.
    "<table>",
    "<tr><th>Email as the extractor sees it</th><th>Truth</th></tr>",
    "<tr>",
    '<td valign="top">',
    "",
    `<pre>\n${esc(c.seen)}\n</pre>`,
    "",
    "</td>",
    '<td valign="top">',
    "",
    `<pre>\n${esc(truthBlock(world, c))}\n</pre>`,
    "",
    "</td>",
    "</tr>",
    "</table>",
    "",
    "",
  ].join("\n");
}

function worldReference(world: World): string {
  const rows = world.vessels.map((v) => {
    const r = openRequirementOf(world, v.id);
    const cap = v.tankCapacityMt;
    return `| ${v.imo} | ${v.name} | ${r.grade} ${r.qtyMt} mt | ${cap.LSMGO} / ${cap.VLSFO} / ${cap.HSFO} |`;
  });
  const prices = world.ports.map((p) => {
    const m = (g: FuelGrade) => marketPriceUsd(world, p.id, g).toFixed(2);
    const sup = world.suppliers
      .filter((s) => s.portIds.includes(p.id))
      .map((s) => SUPPLIERS.find((x) => x.name === s.name)?.key ?? "?")
      .join(", ");
    return `| ${p.unlocode} | ${p.name} | ${m("LSMGO")} | ${m("VLSFO")} | ${m("HSFO")} | ${sup} |`;
  });
  const sup = SUPPLIERS.map((s) => `| ${s.key} | ${s.name} | ${s.emailDomain} |`);
  return [
    "## Eval world reference",
    "",
    `Seed ${world.meta.seed}, anchor ${world.meta.anchor.toISOString()}. Every vessel has exactly one open bunker requirement (the seed's one plus one per other vessel, \`evals/extraction/world.ts\`). EURUSD ${eurUsd(world)}.`,
    "",
    "| IMO | Vessel | Open requirement | Tank capacity LSMGO / VLSFO / HSFO (mt) |",
    "|---|---|---|---|",
    ...rows,
    "",
    "Latest market prices (USD/mt) and the suppliers serving each port:",
    "",
    "| Port | Name | LSMGO | VLSFO | HSFO | Suppliers |",
    "|---|---|---|---|---|---|",
    ...prices,
    "",
    "| Supplier key | Name | Email domain |",
    "|---|---|---|",
    ...sup,
    "",
  ].join("\n");
}

export function renderReview(world: World, cases: ReviewCase[]): string {
  const truths = cases.map((c) => c.truth);
  const split: Split = computeSplit(truths);
  const sample = new Set(reviewSample(truths));
  const hard = cases.filter((c) => c.truth.source === "hard");
  const generated = cases.filter((c) => sample.has(c.truth.id));
  const counts = Object.entries(split.strata)
    .map(([k, v]) => `${k} ${v.total}`)
    .join(", ");
  const inDev = (id: string) => (split.dev.includes(id) ? "dev" : "held-out");
  return [
    "# Extraction golden set: review sheet",
    "",
    "Every extraction accuracy number in Phase 3 is graded against these truths, so please check them before any paid run. This sheet shows all 20 hard cases and a random sample of 15 generated cases (stratified by category, picked by sha256 order, never by hand).",
    "",
    `Set: ${cases.length} cases (${counts}). Split: dev ${split.dev.length}, held-out ${split.heldout.length}.`,
    "",
    "## What to check for each case",
    "",
    "1. **Status.** Would a careful bunker desk store this email's offer as is (`extracted`), send it to a person (`needs_review`), or is it not an offer (`not_a_quote`)?",
    "2. **Review checks.** For `needs_review`, is the listed check the reason this email must not be stored automatically? Any one of the listed checks failing is enough.",
    "3. **Values.** Does each field match what the email says? A value is `— (not determinable)` (null) when the email does not settle it.",
    "4. **Ambiguity.** Is anything treated as certain that a desk would want to confirm?",
    "",
    "## Rules the truth follows",
    "",
    "- Values are what a perfect transcription of the email, followed by Pharos's deterministic normalisers, gives: vessel by IMO, port by UN/LOCODE, supplier by key, ISO dates, numbers in mt and per mt.",
    "- The supplier comes from the sender's email domain only, never from a name in the text.",
    "- Dates are read relative to the received date (the Date header): a date without a year takes the year that puts it between 60 days before and 305 days after it. Validity and the delivery window are compared with the received day, not today.",
    "- A barge fee that is not quoted (or said to be included) is 0. A per-mt barge fee is stored as the total (fee x the first line's quantity).",
    "- Null where the email does not determine a value: a choice of quantities (`300/350 mt`), a volume (`m3`), a decimal comma (`738,50`), dot-grouped thousands (`9.000`), a missing currency, a vessel not in the fleet, a sender domain that is not a supplier.",
    "- Status comes only from the code checks, never from anything the email says about itself.",
    "",
    "## Judgement calls worth a second opinion",
    "",
    "- `hard-forwarded-twice`: an offer forwarded to us by our own chartering desk is `needs_review` (`supplier_resolved`), because the supplier is taken from the sender domain only, even though the signature inside is Harbourlight's.",
    "- `hard-thread-stale-revision` and the generated `forwarded` cases: the newest offer on top is complete, and the truth never takes a value from an older offer quoted below it.",
    "- `hard-pdf-image-only`: a quote (the cover note says so) with no readable values, so `needs_review` with no field values.",
    "- `hard-not-a-quote-with-prices`: a supplier's market report with port prices but no vessel, quantity or validity is not a quote.",
    "- `hard-dot-thousands-qty` uses `9.000 mt` as specified: whichever reading is meant, it must not be stored.",
    "- A barge fee written as included (no amount) is 0, the same as one not mentioned.",
    "",
    "## How corrections are applied",
    "",
    "Tell the lead the case id, the field and the value you expect (or the status). The generator is changed (`evals/extraction/templates/` or `evals/extraction/hard-cases.ts`) and `npm run eval:golden` regenerates every file. Truth files are never edited by hand, and a changed truth comes back to you for review.",
    "",
    worldReference(world),
    "## Hard cases",
    "",
    ...hard.map((c) => caseSection(world, c, `${c.truth.id} (${inDev(c.truth.id)})`)),
    "## Generated sample",
    "",
    ...generated.map((c) => caseSection(world, c, `${c.truth.id} (${inDev(c.truth.id)})`)),
  ].join("\n");
}
