/**
 * REVIEW.md: the sample sheet a human domain reviewer reads before any paid run. All hard cases
 * plus a stratified random sample of generated cases, each with the email exactly as the
 * extractor sees it next to the truth in readable form. Deterministic (no clock).
 */
import type { World } from "@pharos/db";
import { SUPPLIERS } from "@pharos/db";
import type { ExtractionTruth, FuelGrade, TruthQuote, TruthSecurityQuote } from "@pharos/shared";
import { sha256Hex } from "./prng.js";
import { computeSplit, type Split, VARIANT_TAG } from "./split.js";
import { EVAL_SEED, eurUsd, marketPriceUsd, openRequirementOf } from "./world.js";

export const REVIEW_GENERATED_SAMPLE = 15;
/** Generated security cases shown per template stratum (Track 3). */
export const REVIEW_SECURITY_PER_TEMPLATE = 2;

/** A Track 3 security case (its tags[0] starts with `security-`). */
export const isSecurityCase = (t: ExtractionTruth): boolean =>
  (t.tags[0] ?? "").startsWith("security-");

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
  // The fuel sample, as approved in Phase 3: Track 3 security cases have their own sample.
  const generated = truths.filter((t) => t.source === "generated" && !isSecurityCase(t));
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

/** The generated security cases shown: REVIEW_SECURITY_PER_TEMPLATE per template, by sha256. */
export function securityReviewSample(
  truths: ExtractionTruth[],
  seed: number = EVAL_SEED,
): string[] {
  const byTemplate = new Map<string, string[]>();
  for (const t of truths.filter((x) => x.source === "generated" && isSecurityCase(x))) {
    const k = t.tags[0] as string;
    byTemplate.set(k, [...(byTemplate.get(k) ?? []), t.id]);
  }
  return [...byTemplate.keys()].sort().flatMap((k) =>
    (byTemplate.get(k) ?? [])
      .map((id) => ({ id, key: sha256Hex(`review:${seed}:${id}`) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, REVIEW_SECURITY_PER_TEMPLATE)
      .map((x) => x.id)
      .sort(),
  );
}

function securityLines(world: World, q: TruthSecurityQuote): string[] {
  const vessel = world.vessels.find((v) => v.imo === q.vesselImo);
  const port = (code: string | null) =>
    code === null ? NA : `${code}  ${world.ports.find((p) => p.unlocode === code)?.name ?? "?"}`;
  const provider = world.securityProviders.find((p) => p.name === q.provider);
  const cur = q.currency ?? "";
  return [
    `${pad("Provider")}${q.provider === null ? `${NA}  (sender domain is not a provider)` : `${q.provider}  (${provider?.emailDomain ?? "?"}, from the sender domain)`}`,
    `${pad("Vessel")}${q.vesselImo === null ? NA : `${q.vesselImo}  ${vessel?.name ?? "?"}`}`,
    `${pad("Embark")}${port(q.embarkUnlocode)}`,
    `${pad("Disembark")}${port(q.disembarkUnlocode)}`,
    `${pad("Team")}${q.teamSize === null ? NA : `${q.teamSize} guards`}`,
    `${pad("Day rate")}${q.dayRate === null ? NA : `${q.dayRate} ${cur} per team per day`}`,
    `${pad("Currency")}${show(q.currency)}`,
    `${pad("Fixed fees")}${q.fixedFees === null ? NA : `${q.fixedFees} ${cur} (total of the one-off charges)`}`,
    `${pad("Minimum days")}${show(q.minDays)}`,
    `${pad("Valid until")}${show(q.validUntil)}`,
  ];
}

function truthBlock(world: World, c: ReviewCase): string {
  const e = c.truth.expected;
  const lines = [
    `${pad("Status")}${e.status}`,
    `${pad("Review checks")}${e.reviewChecks.length === 0 ? "(none)" : e.reviewChecks.join(", ")}`,
    `${pad("Kind")}${e.kind}`,
    `${pad("Received")}${c.receivedAt ? fmtUtc(c.receivedAt) : "(no Date header)"}`,
    "",
    ...(e.kind === "security_quote"
      ? e.security
        ? securityLines(world, e.security)
        : ["Security values: none (content unreadable)"]
      : e.quote === null
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

function securitySection(
  world: World,
  cases: ReviewCase[],
  inDev: (id: string) => string,
): string[] {
  const security = cases.filter((c) => isSecurityCase(c.truth));
  if (security.length === 0) return [];
  const hard = security.filter((c) => c.truth.source === "hard");
  const sample = new Set(securityReviewSample(security.map((c) => c.truth)));
  const generated = security.filter((c) => sample.has(c.truth.id));
  const total = (prefix: string) => security.filter((c) => c.truth.tags[0] === prefix).length;
  const providers = world.securityProviders.map(
    (p) => `| ${p.name} | ${p.emailDomain} | ${p.erpCode} |`,
  );
  return [
    "## New: Track 3 security quotes — please review",
    "",
    `Track 3 adds ${security.length} security-quote cases: emails from maritime security companies offering an armed team for a transit. ${total("security-plain") + total("security-html") + total("security-pdf")} are generated (${total("security-plain")} plain text, ${total("security-html")} HTML only, ${total("security-pdf")} PDF attachment) and ${hard.length} are hard cases (6 traps, each rendered twice, \`-a\` and \`-b\`). Every value is drawn by code from the eval world and the email is rendered from it (\`evals/extraction/security-facts.ts\`, \`templates/security*.ts\`, \`security-hard-cases.ts\`); nothing is typed by hand or written by a model. They split half dev, half held-out, in their own strata (generated by template, hard by trap: one render of each trap in dev, the other held out), so no earlier case moves. This sheet shows all ${hard.length} hard cases and ${generated.length} generated ones (${REVIEW_SECURITY_PER_TEMPLATE} per template, picked by sha256 order).`,
    "",
    "### Rules the security truth follows",
    "",
    "- Values are what a perfect transcription of the email, followed by Pharos's deterministic readers, gives: the provider from the sender's domain, the vessel by IMO, the embarkation and disembarkation points by UN/LOCODE, the team size and minimum days as whole numbers, the day rate and fixed fees in the quote's own currency (never converted), the validity as an ISO date read against the received date.",
    "- Generated quotes state every field, in USD: a team of 3–6 guards, USD 900–1,600 per team per day, fixed fees USD 3,000–8,000, a minimum of 3–7 days, valid 2–6 days after receipt (illustrative ranges from the plan). The team boards at Fujairah or Djibouti and leaves at Djibouti, Suez, Durban or Cape Town.",
    "- Null where the email does not settle a value: a choice of team sizes (`4/6 guards`), a disembarkation point left out or 'to be advised'. A null critical value must never be stored automatically, so these are `needs_review`.",
    "- Security critical fields (`SECURITY_CRITICAL_FIELDS`): vessel, embarkation and disembarkation points, team size, day rate, currency, fixed fees, minimum days and validity. The provider is not critical but an auto-accept with the wrong provider is unsafe (like the fuel supplier).",
    "",
    "### Judgement calls worth a second opinion",
    "",
    "- `security-hard-fees-separate-charges-*`: three itemised charges and no total is `needs_review` (`amounts_parsed`), with the truth total their sum. Storing one charge would understate the cost; adding them up is arithmetic the model must not do, and Pharos has no fee-summing step.",
    "- `security-hard-team-in-words-*`: a team written in words (`a team of four`) is one unambiguous number, so `extracted` with team size 4.",
    "- `security-hard-forwarded-older-offer-*`: the revised offer on top is complete, and the truth never takes a value from the older offer quoted below.",
    "- `security-hard-eur-day-rate-*`: day rate and fees in EUR are stored in EUR; the generation ranges are the USD ones converted at EURUSD.",
    "",
    "| Security provider | Email domain | ERP code |",
    "|---|---|---|",
    ...providers,
    "",
    "### Security hard cases",
    "",
    ...hard.map((c) => caseSection(world, c, `${c.truth.id} (${inDev(c.truth.id)})`)),
    "### Generated security sample",
    "",
    ...generated.map((c) => caseSection(world, c, `${c.truth.id} (${inDev(c.truth.id)})`)),
  ];
}

export function renderReview(world: World, cases: ReviewCase[]): string {
  const truths = cases.map((c) => c.truth);
  const split: Split = computeSplit(truths);
  const sample = new Set(reviewSample(truths));
  const isVariant = (c: ReviewCase) => c.truth.tags.includes(VARIANT_TAG);
  const variants = cases.filter(isVariant);
  const hard = cases.filter(
    (c) => c.truth.source === "hard" && !isVariant(c) && !isSecurityCase(c.truth),
  );
  const generated = cases.filter((c) => sample.has(c.truth.id));
  const counts = Object.entries(split.strata)
    .map(([k, v]) => `${k} ${v.total}`)
    .join(", ");
  const inDev = (id: string) => (split.dev.includes(id) ? "dev" : "held-out");
  return [
    "# Extraction golden set: review sheet",
    "",
    `Every extraction accuracy number in Phase 3 is graded against these truths, so please check them before any paid run. This sheet shows the ${variants.length} new dev trap variants first, then all ${hard.length} hard cases and a random sample of ${generated.length} generated cases (stratified by category, picked by sha256 order, never by hand).`,
    "",
    `Set: ${cases.length} cases (${counts}). Split: dev ${split.dev.length}, held-out ${split.heldout.length}.`,
    "",
    ...securitySection(world, cases, inDev),
    "## New dev trap variants — please review",
    "",
    `These ${variants.length} cases are new: a second version of each hard trap (id \`hard-<name>-v2\`, tag \`variant:v2\`) with the same trap, status and review check as the original, but other values, mostly another vessel, port and supplier, another layout and fresh phrasing. They are **dev-only trap variants**: by rule they form their own split stratum (\`hard-variant\`) that is all dev, so the dev gate exercises every trap while the 220 approved cases keep their split. Their truth is written by hand in \`evals/extraction/hard-variants.ts\`. The checks and rules in the sections below apply to them as well.`,
    "",
    ...variants.map((c) =>
      caseSection(world, c, `${c.truth.id} (dev, new; variant of hard-${c.truth.tags[1]})`),
    ),
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
    "- Validity more than 60 days after the received date, or a delivery window ending more than 120 days after it, goes to review.",
    "- A single delivery date fills only its own end of the window, so every generated quote writes its delivery window as a span of two dates.",
    "- A barge fee that is not mentioned, or said to be included with no amount, is 0. A barge charge written with an amount must be transcribed: one that is written but not transcribed goes to review.",
    "- A per-mt barge fee is stored as the total (fee x the quantity) on a single-line quote. On a quote with more than one line it goes to review (ruling T6-3), because it is unclear which quantity it applies to.",
    "- Null where the email does not determine a value: a choice of quantities (`280/320 mt`), a volume (`m3`), a decimal comma (`738,50`), dot-grouped thousands (`9.000`), a missing currency, a vessel not in the fleet, a sender domain that is not a supplier.",
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
