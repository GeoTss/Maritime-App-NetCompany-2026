/**
 * Shared pieces for security-quote emails (Track 3): the as-written phrasing of a security
 * offer's facts, its perfect transcription, the labelled offer lines, the body layouts (plain,
 * HTML, PDF) and the sender, subject and signature. Every phrasing here is one Pharos's
 * deterministic readers accept (generated cases are truth `extracted`); hard cases and the demo
 * inbox override single phrases (a choice of team sizes, itemised fees, a missing point).
 */
import type { ExtractionTruth } from "@pharos/shared";
import {
  type AmountSpan,
  DESK,
  type Mailbox,
  type MailDraft,
  type MoneySpan,
  type SecurityTranscription,
} from "../case.js";
import { buildTextPdf, type PdfRow } from "../pdf.js";
import { type Prng, prngInt, prngPick, sha256Hex } from "../prng.js";
import type { SecurityFacts } from "../security-facts.js";
import { securityTruthFromFacts } from "../security-facts.js";
import { esc } from "./html.js";
import {
  asciiName,
  bareName,
  formatNumber,
  longDate,
  phraseValidity,
  phraseVessel,
  pickPerson,
  refCode,
  type VesselPhrase,
} from "./phrasing.js";

// ---------- phrasing ----------

export interface TeamPhrase {
  asWritten: string;
  unit: string | null;
  /** The number a transcriber reads; null when the email gives a choice ("4/6 guards"). */
  value: number | null;
  form: "guards" | "armed" | "man-team" | "pcasp" | "choice" | "words";
}

export interface FeesPhrase {
  /** What is printed after the fees label (or in the sentence). */
  text: string;
  /** The transcription: one amount, or the whole itemised span with value null. */
  span: MoneySpan;
  form: "lump" | "plain" | "one-off" | "itemised";
}

export interface PortPhrase {
  text: string;
  /** The port's own name, which a transcriber copies; null when the text names no port. */
  value: string | null;
}

export interface SecurityPhrase {
  facts: SecurityFacts;
  vessel: VesselPhrase;
  embark: PortPhrase;
  /** Null: the email says nothing about where the team leaves. */
  disembark: PortPhrase | null;
  team: TeamPhrase;
  dayRate: MoneySpan;
  fees: FeesPhrase;
  minDays: AmountSpan & { value: number; unit: string };
  validity: string | null;
  person: { first: string; last: string; local: string };
  ref: string;
}

const COUNTRY: Record<string, string> = {
  AE: "UAE",
  DJ: "Djibouti",
  EG: "Egypt",
  ZA: "South Africa",
};

export function phraseSecurityPort(
  prng: Prng,
  p: { name: string; unlocode: string; country: string },
): PortPhrase {
  const country = COUNTRY[p.country] ?? p.country;
  const text = prngPick(prng, [
    p.name,
    p.name,
    `${p.name} anchorage`,
    p.name === country ? `${p.name} (${p.unlocode})` : `${p.name}, ${country}`,
    `${p.name} (${p.unlocode})`,
    `off ${p.name}`,
  ]);
  return { text, value: p.name };
}

export function phraseTeam(prng: Prng, n: number): TeamPhrase {
  const forms: TeamPhrase[] = [
    { asWritten: `${n} guards`, unit: "guards", value: n, form: "guards" },
    { asWritten: `${n} guards`, unit: "guards", value: n, form: "guards" },
    { asWritten: `${n} armed guards`, unit: "armed guards", value: n, form: "armed" },
    { asWritten: `${n}-man team`, unit: "man team", value: n, form: "man-team" },
    { asWritten: `${n} PCASP`, unit: "PCASP", value: n, form: "pcasp" },
  ];
  return prngPick(prng, forms);
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
export const numberWord = (n: number): string => {
  const w = NUMBER_WORDS[n];
  if (w === undefined) throw new RangeError(`no word for ${n}`);
  return w;
};

/** An amount as a provider prints it: grouped thousands most of the time, ".00" sometimes. */
function money(prng: Prng, value: number): string {
  const decimals = prng() < 0.2 ? 2 : 0;
  return formatNumber(value, { thousands: prng() < 0.75, decimals });
}

export function phraseDayRate(prng: Prng, value: number, currency: "USD" | "EUR"): MoneySpan {
  const n = money(prng, value);
  const forms: [string, string, string][] =
    currency === "USD"
      ? [
          [`USD ${n} per day`, "USD", "per day"],
          [`USD ${n} per day`, "USD", "per day"],
          [`US$ ${n}/day`, "US$", "/day"],
          [`$${n} per day`, "$", "per day"],
          [`USD ${n} per team per day`, "USD", "per team per day"],
          [`${n} USD/day`, "USD", "/day"],
          [`USD ${n} daily`, "USD", "daily"],
        ]
      : [
          [`EUR ${n} per day`, "EUR", "per day"],
          [`€${n}/day`, "€", "/day"],
          [`EUR ${n} per team per day`, "EUR", "per team per day"],
          [`${n} EUR/day`, "EUR", "/day"],
        ];
  const [asWritten, cur, perUnit] = prngPick(prng, forms);
  return { value, currency: cur, perUnit, asWritten };
}

export function phraseFees(prng: Prng, value: number, currency: "USD" | "EUR"): FeesPhrase {
  const n = money(prng, value);
  const forms: [string, string, string | null, FeesPhrase["form"]][] =
    currency === "USD"
      ? [
          [`USD ${n} lump sum`, "USD", "lump sum", "lump"],
          [`USD ${n}`, "USD", null, "plain"],
          [`US$ ${n} one-off`, "US$", "one-off", "one-off"],
          [`$${n} lump sum`, "$", "lump sum", "lump"],
        ]
      : [
          [`EUR ${n} lump sum`, "EUR", "lump sum", "lump"],
          [`€${n} one-off`, "€", "one-off", "one-off"],
          [`EUR ${n}`, "EUR", null, "plain"],
        ];
  const [asWritten, cur, perUnit, form] = prngPick(prng, forms);
  return { text: asWritten, span: { value, currency: cur, perUnit, asWritten }, form };
}

export function phraseMinDays(n: number): SecurityPhrase["minDays"] {
  return { value: n, unit: "days", asWritten: `${n} days` };
}

/** The three-letter code from a provider's ERP code ("SEC-TRI" -> "TRI"). */
export const providerCode = (erpCode: string): string => erpCode.replace(/^SEC-/, "");

export function phraseSecurity(prng: Prng, facts: SecurityFacts): SecurityPhrase {
  if (facts.disembark === null) throw new Error("phraseSecurity needs a disembark port");
  if (facts.currency !== "USD" && facts.currency !== "EUR") throw new Error("USD or EUR only");
  return {
    facts,
    vessel: phraseVessel(prng, facts.vessel),
    embark: phraseSecurityPort(prng, facts.embark),
    disembark: phraseSecurityPort(prng, facts.disembark),
    team: phraseTeam(prng, facts.teamSize),
    dayRate: phraseDayRate(prng, facts.dayRate, facts.currency),
    fees: phraseFees(prng, facts.fixedFees, facts.currency),
    minDays: phraseMinDays(facts.minDays),
    validity: facts.validUntil === null ? null : phraseValidity(prng, facts.validUntil).text,
    person: pickPerson(prng),
    ref: refCode(prng, providerCode(facts.provider.erpCode)),
  };
}

// ---------- labels and transcription ----------

export interface SecurityLabels {
  vessel: string;
  embark: string;
  disembark: string;
  team: string;
  dayRate: string;
  minDays: string;
  fees: string;
  validity: string;
}

export function pickSecurityLabels(prng: Prng): SecurityLabels {
  return {
    vessel: prngPick(prng, ["Vessel", "Vessel", "Ship"]),
    embark: prngPick(prng, ["Embarkation", "Embarkation point", "Embark", "Team boards at"]),
    disembark: prngPick(prng, [
      "Disembarkation",
      "Disembarkation point",
      "Disembark",
      "Team leaves at",
    ]),
    team: prngPick(prng, ["Team", "Team size", "Security team", "Guards"]),
    dayRate: prngPick(prng, ["Day rate", "Daily rate", "Rate"]),
    minDays: prngPick(prng, ["Minimum", "Minimum period", "Minimum charge"]),
    fees: prngPick(prng, ["Fixed fees", "One-off charges", "Fixed charges"]),
    validity: prngPick(prng, ["Validity", "Offer valid until", "Valid till", "Rates valid until"]),
  };
}

export const disembarkText = (sp: SecurityPhrase): string | null => sp.disembark?.text ?? null;

/** "Label: value" lines of the offer, in a fixed order (a missing point or validity is left out). */
export function labelledSecurityLines(sp: SecurityPhrase, l: SecurityLabels): string[] {
  const out = [`${l.vessel}: ${sp.vessel.text}`, `${l.embark}: ${sp.embark.text}`];
  const dis = disembarkText(sp);
  if (dis !== null) out.push(`${l.disembark}: ${dis}`);
  out.push(
    `${l.team}: ${sp.team.asWritten}`,
    `${l.dayRate}: ${sp.dayRate.asWritten}`,
    `${l.minDays}: ${sp.minDays.asWritten}`,
    `${l.fees}: ${sp.fees.text}`,
  );
  if (sp.validity !== null) out.push(`${l.validity}: ${sp.validity}`);
  return out;
}

export interface SecurityHints {
  /** Labels on the same line as their value. */
  labels?: SecurityLabels;
  /** Team, rate, minimum and fees sit in a grid row away from their labels. */
  grid?: boolean;
}

/** The perfect transcription of a phrased security offer; evidence lines come later (oracle.ts). */
export function transcribeSecurity(
  sp: SecurityPhrase,
  hints: SecurityHints = {},
): SecurityTranscription {
  const l = hints.labels;
  const near = (label: string | undefined) => (label === undefined ? {} : { near: label });
  const amountNear = (label: string | undefined) => near(hints.grid ? undefined : label);
  const port = (p: PortPhrase | null, label: string | undefined) =>
    p === null || p.value === null ? null : { value: p.value, ...near(label) };
  return {
    kind: "security_quote",
    providerName: { value: sp.facts.provider.name },
    vesselName: sp.vessel.name === null ? null : { value: sp.vessel.name, ...near(l?.vessel) },
    vesselImo: sp.vessel.imo === null ? null : { value: sp.vessel.imo, ...near(l?.vessel) },
    embarkPort: port(sp.embark, l?.embark),
    disembarkPort: port(sp.disembark, l?.disembark),
    teamSize: { ...sp.team, ...amountNear(l?.team) },
    dayRate: { ...sp.dayRate, ...amountNear(l?.dayRate) },
    fixedFees: { ...sp.fees.span, ...amountNear(l?.fees) },
    minDays: { ...sp.minDays, ...amountNear(l?.minDays) },
    validUntil: sp.validity === null ? null : { asWritten: sp.validity, ...near(l?.validity) },
  };
}

/** The truth of a generated security quote: status extracted, values from the facts. */
export function securityTruth(id: string, tags: string[], facts: SecurityFacts): ExtractionTruth {
  return {
    id,
    tags,
    source: "generated",
    expected: {
      kind: "security_quote",
      status: "extracted",
      reviewChecks: [],
      quote: null,
      security: securityTruthFromFacts(facts),
    },
  };
}

// ---------- sender, subject, greeting, terms, signature ----------

export function securitySender(prng: Prng, sp: SecurityPhrase): Mailbox {
  const { provider } = sp.facts;
  const personal = prng() < 0.6;
  const local = personal
    ? sp.person.local
    : prngPick(prng, ["operations", "ops", "quotes", "security"]);
  const name = personal
    ? `${asciiName(`${sp.person.first} ${sp.person.last}`)} - ${provider.name}`
    : `${provider.name} ${prngPick(prng, ["Operations", "Ops Room", "Quotes"])}`;
  return { name, address: `${local}@${provider.emailDomain}` };
}

export function securitySubject(prng: Prng, sp: SecurityPhrase): string {
  const vessel = bareName(sp.facts.vessel);
  const from = sp.facts.embark.name;
  const to = sp.facts.disembark?.name ?? "TBA";
  return asciiName(
    prngPick(prng, [
      `Armed security team - ${vessel} - ${from} to ${to}`,
      `Quote ${sp.ref}: PCASP for ${sp.facts.vessel.name}`,
      `RE: Security enquiry ${vessel} - HRA transit`,
      `${vessel} - armed guards ${from}/${to}`,
      `Offer: security team for ${sp.facts.vessel.name}`,
    ]),
  );
}

export function securityGreeting(prng: Prng): string {
  return prngPick(prng, ["Dear Sirs,", "Dear Ops Desk,", "Good morning,", "Dear colleagues,"]);
}

export function securityIntro(prng: Prng): string {
  return prngPick(prng, [
    "Further to your enquiry, we are pleased to offer an armed security team for the transit as follows:",
    "Thank you for your request. Please find our offer for the High Risk Area transit below.",
    "As discussed, we can provide armed guards for the voyage as follows:",
    "Please see our offer for a security team below.",
  ]);
}

/** Terms carry no number, so no term can be mistaken for a team size, rate or minimum. */
export function securityTerms(prng: Prng): string[] {
  const all = [
    "Rates include weapons, ammunition and protective equipment.",
    "All team members are ex-military and fully vetted.",
    "Subject to flag state authorisation and final voyage details.",
    "Days are counted from embarkation to disembarkation.",
    "Our standard terms and conditions apply.",
    "Team insurance is included.",
  ];
  const n = prngInt(prng, 1, 3);
  const start = prngInt(prng, 0, all.length - 1);
  return Array.from({ length: n }, (_, i) => all[(start + i) % all.length] as string);
}

export function securitySignature(prng: Prng, sp: SecurityPhrase, address: string): string[] {
  const { provider } = sp.facts;
  const sign = prngPick(prng, ["Best regards,", "Kind regards,", "Regards,"]);
  const title = prngPick(prng, [
    "Operations Manager",
    "Maritime Security Coordinator",
    "Head of Operations",
    "Client Services",
  ]);
  const company = prngPick(prng, [provider.name, `For and on behalf of ${provider.name}`]);
  const phone = `+${prngInt(prng, 30, 99)} ${prngInt(prng, 20, 99)} ${prngInt(prng, 1000, 9999)} ${prngInt(prng, 1000, 9999)}`;
  return [sign, `${sp.person.first} ${sp.person.last}`, title, company, `T ${phone} | ${address}`];
}

export function securityMessageId(id: string, domain: string): string {
  return `${sha256Hex(`message-id:${id}`).slice(0, 20)}@${domain}`;
}

export function securityDraft(
  id: string,
  sp: SecurityPhrase,
  body: Pick<MailDraft, "text" | "html" | "attachments">,
  from: Mailbox,
  subject: string,
): MailDraft {
  return {
    from,
    to: DESK,
    subject,
    date: sp.facts.receivedAt,
    messageId: securityMessageId(id, sp.facts.provider.emailDomain),
    ...body,
  };
}

// ---------- bodies ----------

export type SecurityPlainLayout = "labels" | "prose" | "compact";
export type SecurityHtmlLayout = "kv-table" | "grid";
export type SecurityPdfLayout = "letter" | "grid";

/** "a team of 4 guards", "a 4-man team". */
export function teamInProse(t: TeamPhrase): string {
  return t.form === "man-team" ? `a ${t.asWritten}` : `a team of ${t.asWritten}`;
}

/** The offer as prose sentences (no labels). */
export function proseSecurityLines(sp: SecurityPhrase): string[] {
  const dis = sp.disembark;
  const where =
    dis === null
      ? `, embarking at ${sp.embark.text}`
      : `, embarking at ${sp.embark.text} and disembarking at ${dis.text}`;
  return [
    `We can provide ${teamInProse(sp.team)} for ${sp.vessel.text}${where}.`,
    `The day rate is ${sp.dayRate.asWritten}, with a minimum of ${sp.minDays.asWritten}.`,
    `Fixed fees for embarkation, disembarkation and arms storage: ${sp.fees.text}.`,
    ...(sp.validity === null ? [] : [`This offer is valid until ${sp.validity}.`]),
  ];
}

/** `fixedLabels`: labels chosen by the caller (the demo inbox) instead of drawn. */
export function securityPlainBody(
  prng: Prng,
  sp: SecurityPhrase,
  layout: SecurityPlainLayout,
  address: string,
  fixedLabels?: SecurityLabels,
): { text: string; hints: SecurityHints } {
  const sig = securitySignature(prng, sp, address);
  if (layout === "labels") {
    const labels = fixedLabels ?? pickSecurityLabels(prng);
    const body = [
      securityGreeting(prng),
      "",
      securityIntro(prng),
      "",
      ...labelledSecurityLines(sp, labels),
      "",
      ...securityTerms(prng),
      "",
      ...sig,
    ];
    return { text: body.join("\n"), hints: { labels } };
  }
  if (layout === "prose") {
    const body = [
      securityGreeting(prng),
      "",
      ...proseSecurityLines(sp),
      "",
      ...securityTerms(prng),
      "",
      ...sig,
    ];
    return { text: body.join("\n"), hints: {} };
  }
  // compact: one summary line, then the minimum, fees and validity.
  const dis = disembarkText(sp);
  const body = [
    prngPick(prng, ["Hi,", "Morning,", "Dear all,"]),
    "",
    `${sp.vessel.text} / ${sp.embark.text}${dis === null ? "" : ` - ${dis}`} / ${sp.team.asWritten} @ ${sp.dayRate.asWritten}`,
    `Minimum: ${sp.minDays.asWritten}`,
    `Fees: ${sp.fees.text}`,
    ...(sp.validity === null ? [] : [`Valid until: ${sp.validity}`]),
    "",
    ...sig,
  ];
  return { text: body.join("\n"), hints: {} };
}

const STYLE = "font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a";

function headerPairs(sp: SecurityPhrase, l: SecurityLabels): [string, string][] {
  const dis = disembarkText(sp);
  return [
    [l.vessel, sp.vessel.text],
    [l.embark, sp.embark.text],
    ...(dis === null ? [] : [[l.disembark, dis] as [string, string]]),
  ];
}

function pricePairs(sp: SecurityPhrase, l: SecurityLabels): [string, string][] {
  return [
    [l.team, sp.team.asWritten],
    [l.dayRate, sp.dayRate.asWritten],
    [l.minDays, sp.minDays.asWritten],
    [l.fees, sp.fees.text],
  ];
}

export function securityHtmlBody(
  prng: Prng,
  sp: SecurityPhrase,
  layout: SecurityHtmlLayout,
  address: string,
  opening?: string[],
  fixedLabels?: SecurityLabels,
): { html: string; hints: SecurityHints } {
  const l = fixedLabels ?? pickSecurityLabels(prng);
  const sig = securitySignature(prng, sp, address);
  const kvRows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join("\n");
  const validity: [string, string][] = sp.validity === null ? [] : [[l.validity, sp.validity]];
  const parts: string[] = [
    "<!DOCTYPE html>",
    `<html><head><meta charset="utf-8"><title>Offer ${esc(sp.ref)}</title></head>`,
    `<body style="${STYLE}">`,
    `<p>${esc(securityGreeting(prng))}</p>`,
    ...(opening ?? [securityIntro(prng)]).map((p) => `<p>${esc(p)}</p>`),
  ];
  let hints: SecurityHints;
  if (layout === "kv-table") {
    parts.push(
      '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">',
      kvRows([...headerPairs(sp, l), ...pricePairs(sp, l), ...validity]),
      "</table>",
    );
    hints = { labels: l };
  } else {
    const prices = pricePairs(sp, l);
    parts.push(
      '<table cellpadding="3">',
      kvRows(headerPairs(sp, l)),
      "</table>",
      "<br>",
      '<table border="1" cellpadding="4" cellspacing="0">',
      `<tr>${prices.map(([k]) => `<th>${esc(k)}</th>`).join("")}</tr>`,
      `<tr>${prices.map(([, v]) => `<td>${esc(v)}</td>`).join("")}</tr>`,
      "</table>",
      ...validity.map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`),
    );
    hints = { labels: l, grid: true };
  }
  parts.push(
    `<p style="font-size:11px;color:#555">${securityTerms(prng).map(esc).join("<br>\n")}</p>`,
    `<p>${sig.map(esc).join("<br>\n")}</p>`,
    "</body></html>",
  );
  return { html: parts.join("\n"), hints };
}

export async function securityPdfOffer(
  prng: Prng,
  sp: SecurityPhrase,
  layout: SecurityPdfLayout,
): Promise<{ pdf: Uint8Array; hints: SecurityHints }> {
  const l = pickSecurityLabels(prng);
  const { provider } = sp.facts;
  const rows: PdfRow[] = [
    { text: provider.name.toUpperCase(), bold: true, size: 15 },
    { text: `Operations: operations@${provider.emailDomain}` },
    { gap: 10 },
    { text: "ARMED SECURITY TEAM OFFER", bold: true, size: 12 },
    { text: `Ref: ${sp.ref}` },
    { text: `Issued: ${longDate(sp.facts.receivedAt.toISOString().slice(0, 10))}` },
    { gap: 8 },
  ];
  let hints: SecurityHints;
  if (layout === "letter") {
    rows.push(...labelledSecurityLines(sp, l).map((text) => ({ text })));
    hints = { labels: l };
  } else {
    const prices = pricePairs(sp, l);
    const xs = [0, 95, 250, 330];
    rows.push(
      ...headerPairs(sp, l).map(([k, v]) => ({ text: `${k}: ${v}` })),
      { gap: 6 },
      { cells: prices.map(([k], i) => ({ text: k, x: xs[i] ?? 0, bold: true })) },
      { cells: prices.map(([, v], i) => ({ text: v, x: xs[i] ?? 0 })) },
      { gap: 6 },
    );
    if (sp.validity !== null) rows.push({ text: `${l.validity}: ${sp.validity}` });
    hints = { labels: l, grid: true };
  }
  rows.push(
    { gap: 10 },
    ...securityTerms(prng).map((text) => ({ text, size: 9 })),
    { gap: 10 },
    { text: `For and on behalf of ${provider.name}`, bold: true },
  );
  return { pdf: await buildTextPdf(rows), hints };
}

export function securityCoverNote(prng: Prng, sp: SecurityPhrase, address: string): string {
  const sig = securitySignature(prng, sp, address);
  return [
    prngPick(prng, ["Dear Sirs,", "Dear Ops Desk,", "Good afternoon,", "Hello,"]),
    "",
    prngPick(prng, [
      "Please find our offer for the security team attached.",
      "Attached please find our quotation for armed guards as requested.",
      "Our offer is in the attached PDF.",
    ]),
    "",
    ...sig,
  ].join("\n");
}

/** Days between two ISO dates, for tests and the review sheet. */
export const isoDaysBetween = (a: string, b: string): number =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
