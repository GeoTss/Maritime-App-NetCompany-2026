/**
 * Security hard cases (Track 3): six traps, each rendered twice (`-a`, `-b`) from facts drawn by
 * the case's own PRNG, so no value is typed by hand and nothing comes from a model. Each trap
 * changes one phrase of an otherwise ordinary security offer and states, in code, what a careful
 * desk must do with it (the truth status, the review check that must catch it, the values):
 *
 *   four-six-guards          the team is a choice ("4/6 guards")            needs_review, team null
 *   eur-day-rate             day rate and fees in EUR                       extracted, EUR
 *   forwarded-older-offer    revised offer on top, older one quoted below   extracted, newest values
 *   missing-disembark        no disembarkation point                        needs_review, point null
 *   fees-separate-charges    fixed fees itemised as three charges           needs_review, total = sum
 *   team-in-words            "a team of four"                               extracted, team 4
 *
 * The split puts one render of each trap in dev and the other in held-out (stratum
 * `security-hard:<trap>`, split.ts), so dev exercises every trap and held-out measures every one.
 */
import type { World } from "@pharos/db";
import type { ExtractionTruth, TruthSecurityQuote } from "@pharos/shared";
import type { GoldenCase } from "./case.js";
import { casePrng, type Prng, prngInt, prngPick } from "./prng.js";
import {
  drawSecurityFacts,
  SECURITY_RANGES,
  type SecurityFacts,
  securityTruthFromFacts,
} from "./security-facts.js";
import {
  addDays,
  asciiName,
  formatNumber,
  isoDay,
  longDate,
  phraseValidity,
} from "./templates/phrasing.js";
import {
  labelledSecurityLines,
  numberWord,
  phraseDayRate,
  phraseFees,
  phraseMinDays,
  phraseSecurity,
  pickSecurityLabels,
  type SecurityPhrase,
  securityDraft,
  securityGreeting,
  securityHtmlBody,
  securityPdfOffer,
  securityPlainBody,
  securitySender,
  securitySignature,
  securitySubject,
  transcribeSecurity,
} from "./templates/security-block.js";
import { EVAL_SEED } from "./world.js";

export const SECURITY_HARD_NAMES = [
  "four-six-guards",
  "eur-day-rate",
  "forwarded-older-offer",
  "missing-disembark",
  "fees-separate-charges",
  "team-in-words",
] as const;
export type SecurityHardName = (typeof SECURITY_HARD_NAMES)[number];
export const SECURITY_HARD_RENDERS = ["a", "b"] as const;
export type SecurityHardRender = (typeof SECURITY_HARD_RENDERS)[number];

/** tags[0] of every security hard case; the split stratifies them by tags[1] (the trap). */
export const SECURITY_HARD_TAG = "security-hard";

export const securityHardId = (name: SecurityHardName, render: SecurityHardRender): string =>
  `${SECURITY_HARD_TAG}-${name}-${render}`;

/** What makes each trap hard, for REVIEW.md. */
export const SECURITY_HARD_TRICKY: Record<SecurityHardName, string> = {
  "four-six-guards":
    'The team size is a choice ("4/6 guards", "3 or 4 guards"): no single team size may be stored, so it goes to review.',
  "eur-day-rate":
    "Day rate and fixed fees are in EUR: they are stored in EUR as written, never converted by the model.",
  "forwarded-older-offer":
    "A revised offer on top and the provider's older offer quoted below with another day rate, fees, minimum and validity: the truth is the newest offer only.",
  "missing-disembark":
    "The offer never says where the team leaves the ship (left out, or 'to be advised'): the route cover cannot be checked, so it goes to review.",
  "fees-separate-charges":
    "The fixed fees are itemised as three charges with no total. Storing one charge would understate the cost, and adding them up is arithmetic the model must not do, so it goes to review; the truth total (what a reviewer enters) is their sum.",
  "team-in-words":
    'The team size is written in words ("a team of four", "three armed guards"): one unambiguous number, stored as is.',
};

interface Rendered {
  facts: SecurityFacts;
  sp: SecurityPhrase;
  mail: GoldenCase["mail"];
  transcription: GoldenCase["transcription"];
  layout: string;
  status: "extracted" | "needs_review";
  reviewChecks: string[];
  /** Truth values that differ from the facts (a null where the email does not settle it). */
  override?: Partial<TruthSecurityQuote>;
}

function plainCase(
  id: string,
  prng: Prng,
  sp: SecurityPhrase,
  layout: "labels" | "prose" | "compact",
): Pick<Rendered, "mail" | "transcription" | "layout"> {
  const from = securitySender(prng, sp);
  const { text, hints } = securityPlainBody(prng, sp, layout, from.address);
  return {
    mail: securityDraft(id, sp, { text }, from, securitySubject(prng, sp)),
    transcription: transcribeSecurity(sp, hints),
    layout: `plain-${layout}`,
  };
}

function htmlCase(
  id: string,
  prng: Prng,
  sp: SecurityPhrase,
): Pick<Rendered, "mail" | "transcription" | "layout"> {
  const from = securitySender(prng, sp);
  const { html, hints } = securityHtmlBody(prng, sp, "kv-table", from.address);
  return {
    mail: securityDraft(id, sp, { html }, from, securitySubject(prng, sp)),
    transcription: transcribeSecurity(sp, hints),
    layout: "html-kv-table",
  };
}

/** One amount moved away from `value` by 1–4 steps, kept inside the generation range. */
function another(prng: Prng, value: number, step: number, [lo, hi]: readonly [number, number]) {
  const k = prngInt(prng, 1, 4) * step;
  const down = value - k;
  const up = value + k;
  return down >= lo && (up > hi || prng() < 0.5) ? down : up;
}

/** The provider's earlier offer for the same team and route: another price, minimum and validity. */
function olderPhrase(prng: Prng, sp: SecurityPhrase): SecurityPhrase {
  const f = sp.facts;
  const r = SECURITY_RANGES;
  const receivedAt = new Date(f.receivedAt.getTime() - prngInt(prng, 18, 40) * 3_600_000);
  const dayRate = another(prng, f.dayRate, r.dayRateStep, r.dayRateUsd);
  const fixedFees = another(prng, f.fixedFees, r.fixedFeesStep, r.fixedFeesUsd);
  const minDays = f.minDays === r.minDays[1] ? f.minDays - 1 : f.minDays + 1;
  let validUntil = addDays(isoDay(receivedAt), prngInt(prng, 1, 2));
  if (validUntil === f.validUntil) validUntil = addDays(validUntil, -1);
  const facts = { ...f, receivedAt, dayRate, fixedFees, minDays, validUntil };
  if (f.currency !== "USD") throw new Error("the forwarded trap is drawn in USD");
  return {
    ...sp,
    facts,
    dayRate: phraseDayRate(prng, dayRate, "USD"),
    fees: phraseFees(prng, fixedFees, "USD"),
    minDays: phraseMinDays(minDays),
    validity: phraseValidity(prng, validUntil).text,
  };
}

const two = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;

function forwardedCase(
  id: string,
  prng: Prng,
  sp: SecurityPhrase,
  style: "outlook" | "reply-quoted",
): Pick<Rendered, "mail" | "transcription" | "layout"> {
  const old = olderPhrase(prng, sp);
  const labels = pickSecurityLabels(prng);
  const from = securitySender(prng, sp);
  const domain = sp.facts.provider.emailDomain;
  const oldAddress = `${old.person.local}@${domain}`;
  const oldFrom = `${asciiName(`${old.person.first} ${old.person.last}`)} <${oldAddress}>`;
  const oldSubject = securitySubject(prng, old);
  const oldBody = [
    securityGreeting(prng),
    "",
    "Please find our offer below.",
    "",
    ...labelledSecurityLines(old, labels),
    "",
    ...securitySignature(prng, old, oldAddress),
  ];
  const top = [
    securityGreeting(prng),
    "",
    prngPick(prng, [
      "Please see our revised offer below, which replaces our earlier quotation.",
      "Updated offer below - this supersedes the one sent earlier.",
      "We are pleased to revise our offer as follows (earlier offer below for reference):",
    ]),
    "",
    ...labelledSecurityLines(sp, labels),
    "",
    ...securitySignature(prng, sp, from.address),
    "",
  ];
  const oldDay = isoDay(old.facts.receivedAt);
  const quoted =
    style === "outlook"
      ? [
          "-----Original Message-----",
          `From: ${oldFrom}`,
          `Sent: ${longDate(oldDay)} ${hhmm(old.facts.receivedAt)}`,
          "To: Bunker Desk <bunker-desk@pharos-demo.example>",
          `Subject: ${oldSubject}`,
          "",
          ...oldBody,
        ]
      : [
          `On ${longDate(oldDay)} at ${hhmm(old.facts.receivedAt)}, ${oldFrom} wrote:`,
          ...oldBody.map((l) => (l === "" ? ">" : `> ${l}`)),
        ];
  const subject = `${style === "reply-quoted" ? "RE" : "FW"}: ${oldSubject}`;
  return {
    mail: securityDraft(id, sp, { text: [...top, ...quoted].join("\n") }, from, subject),
    transcription: transcribeSecurity(sp, { labels }),
    layout: `forwarded-${style}`,
  };
}

/** Three charges that add up to `total`: embarkation and disembarkation alike, storage the rest. */
function feeParts(prng: Prng, total: number): [number, number, number] {
  const step = SECURITY_RANGES.fixedFeesStep;
  const maxK = Math.min(6, Math.floor((total - 1000) / (2 * step)));
  const each = step * prngInt(prng, 2, Math.max(2, maxK));
  const storage = total - 2 * each;
  if (storage < 500) throw new Error(`fee split leaves ${storage} for storage`);
  return [each, each, storage];
}

const grouped = (n: number) => formatNumber(n, { thousands: true, decimals: 0 });

async function renderTrap(
  world: World,
  name: SecurityHardName,
  render: SecurityHardRender,
): Promise<Rendered> {
  const id = securityHardId(name, render);
  const prng = casePrng(EVAL_SEED, id);
  const currency = name === "eur-day-rate" ? "EUR" : "USD";
  let facts = drawSecurityFacts(prng, world, { currency });
  if (name === "team-in-words" && render === "a") facts = { ...facts, teamSize: 4 };
  const sp = phraseSecurity(prng, facts);

  switch (name) {
    case "four-six-guards": {
      const asWritten = render === "a" ? "4/6 guards" : "3 or 4 guards";
      const team = { asWritten, unit: "guards", value: null, form: "choice" as const };
      const tsp = { ...sp, team };
      return {
        facts,
        sp: tsp,
        ...(render === "a" ? plainCase(id, prng, tsp, "labels") : htmlCase(id, prng, tsp)),
        status: "needs_review",
        reviewChecks: ["team_size_unambiguous"],
        override: { teamSize: null },
      };
    }
    case "eur-day-rate": {
      if (render === "a") {
        return {
          facts,
          sp,
          ...plainCase(id, prng, sp, "prose"),
          status: "extracted",
          reviewChecks: [],
        };
      }
      const from = securitySender(prng, sp);
      const { pdf, hints } = await securityPdfOffer(prng, sp, "letter");
      return {
        facts,
        sp,
        mail: securityDraft(
          id,
          sp,
          {
            text: [
              securityGreeting(prng),
              "",
              "Please find our offer for the security team attached.",
              "",
              ...securitySignature(prng, sp, from.address),
            ].join("\n"),
            attachments: [
              { filename: `${sp.ref}.pdf`, contentType: "application/pdf", content: pdf },
            ],
          },
          from,
          securitySubject(prng, sp),
        ),
        transcription: transcribeSecurity(sp, hints),
        layout: "pdf-letter",
        status: "extracted",
        reviewChecks: [],
      };
    }
    case "forwarded-older-offer":
      return {
        facts,
        sp,
        ...forwardedCase(id, prng, sp, render === "a" ? "outlook" : "reply-quoted"),
        status: "extracted",
        reviewChecks: [],
      };
    case "missing-disembark": {
      const msp: SecurityPhrase =
        render === "a"
          ? { ...sp, disembark: null }
          : { ...sp, disembark: { text: "to be advised", value: null } };
      const mfacts = { ...facts, disembark: null };
      const tsp = { ...msp, facts: mfacts };
      return {
        facts: mfacts,
        sp: tsp,
        ...(render === "a" ? plainCase(id, prng, tsp, "labels") : htmlCase(id, prng, tsp)),
        status: "needs_review",
        reviewChecks: ["disembark_port_resolved"],
      };
    }
    case "fees-separate-charges": {
      const [e, d, s] = feeParts(prng, facts.fixedFees);
      const text =
        render === "a"
          ? `embarkation USD ${grouped(e)} + disembarkation USD ${grouped(d)} + arms storage USD ${grouped(s)}`
          : `USD ${grouped(e)} for embarkation, USD ${grouped(d)} for disembarkation and USD ${grouped(s)} for arms storage`;
      const fees = {
        text,
        span: { value: null, currency: "USD", perUnit: null, asWritten: text },
        form: "itemised" as const,
      };
      const tsp = { ...sp, fees };
      return {
        facts,
        sp: tsp,
        // Plain text: an HTML table cell this long would wrap over two lines.
        ...plainCase(id, prng, tsp, render === "a" ? "labels" : "compact"),
        status: "needs_review",
        reviewChecks: ["amounts_parsed"],
      };
    }
    case "team-in-words": {
      const n = facts.teamSize;
      const team =
        render === "a"
          ? {
              asWritten: `${numberWord(n)} guards`,
              unit: "guards",
              value: n,
              form: "words" as const,
            }
          : {
              asWritten: `${numberWord(n)} armed guards`,
              unit: "armed guards",
              value: n,
              form: "words" as const,
            };
      const tsp = { ...sp, team };
      return {
        facts,
        sp: tsp,
        ...(render === "a" ? plainCase(id, prng, tsp, "prose") : htmlCase(id, prng, tsp)),
        status: "extracted",
        reviewChecks: [],
      };
    }
  }
}

export async function renderSecurityHardCase(
  world: World,
  name: SecurityHardName,
  render: SecurityHardRender,
): Promise<GoldenCase> {
  const r = await renderTrap(world, name, render);
  const truth: ExtractionTruth = {
    id: securityHardId(name, render),
    tags: [SECURITY_HARD_TAG, name, `render:${render}`, `layout:${r.layout}`],
    source: "hard",
    expected: {
      kind: "security_quote",
      status: r.status,
      reviewChecks: r.reviewChecks,
      quote: null,
      security: { ...securityTruthFromFacts(r.facts), ...r.override },
    },
  };
  return { truth, mail: r.mail, transcription: r.transcription, note: SECURITY_HARD_TRICKY[name] };
}

/** Every security hard case, trap by trap, `-a` then `-b`. */
export async function buildSecurityHardCases(world: World): Promise<GoldenCase[]> {
  const out: GoldenCase[] = [];
  for (const name of SECURITY_HARD_NAMES) {
    for (const render of SECURITY_HARD_RENDERS)
      out.push(await renderSecurityHardCase(world, name, render));
  }
  return out;
}
