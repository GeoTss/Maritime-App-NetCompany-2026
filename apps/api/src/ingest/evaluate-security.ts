/**
 * Checks one security-quote extraction (Track 3) and normalises it: every present field's evidence
 * is verbatim in the email, the provider, both ports and the vessel resolve, the team size and the
 * day rate, fixed fees and minimum days read as single numbers in a known currency, and the
 * validity parses, and is stated when the email writes one (a validity word on a dated line). All pass → `extracted`
 * with the normalised quote; anything else → `needs_review` (a range like "4/6 guards" is never guessed).
 */
import type { World } from "@pharos/db";
import { evidenceSupports, normaliseCurrency, parseAmount, parseQuoteDate } from "@pharos/domain";
import type { CheckResult, Currency, Id, IsoDate, SecurityQuoteExtraction } from "@pharos/shared";
import { type ExtractInput, sourceText } from "../ai/extract.js";
import { resolvePort, resolveVessel } from "./resolve.js";

export interface NormalisedSecurityQuote {
  providerId: Id;
  vesselImo: string | null;
  embarkPortId: Id;
  disembarkPortId: Id;
  teamSize: number;
  dayRate: number;
  fixedFees: number;
  minDays: number;
  currency: Currency;
  validUntil: IsoDate | null;
}

const ok = (check: string, failures: string[], note: string | null = null): CheckResult => ({
  check,
  passed: failures.length === 0,
  detail: failures.length === 0 ? note : failures.join(" "),
});

/**
 * The number in a quantity or money field, only when the as-written span reads as one amount equal
 * to the transcribed value (as for fuel): a value with "4/6 guards" written, or a null value beside
 * a written span (a range, or one of several charges), is not one number.
 */
function amount(f: { value: number | null; asWritten: string | null }): number | null {
  if (f.value === null || f.asWritten === null) return null;
  return parseAmount(f.asWritten) === f.value ? f.value : null;
}

const NUMBER_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** The team size: one amount as for fees, or exactly one number word ("four guards") equal to it. */
function teamCount(f: { value: number | null; asWritten: string | null }): number | null {
  const n = amount(f);
  if (n !== null || f.value === null || f.asWritten === null || /\d/.test(f.asWritten)) return n;
  const words = (f.asWritten.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) =>
    NUMBER_WORDS.includes(w),
  );
  return words.length === 1 && NUMBER_WORDS.indexOf(words[0] ?? "") + 1 === f.value
    ? f.value
    : null;
}

/** The provider by the email's sender domain, else by a name that matches a known provider's. */
function resolveProvider(
  world: World,
  sender: string | null,
  written: string | null,
): { providerId: Id | null; detail: string | null } {
  const domain =
    sender
      ?.split("@")[1]
      ?.replace(/[>\s].*$/, "")
      .toLowerCase() ?? null;
  const byDomain = domain ? world.securityProviders.find((p) => p.emailDomain === domain) : null;
  if (byDomain) return { providerId: byDomain.id, detail: null };
  const name = written?.trim().toLowerCase() ?? "";
  const byName = name
    ? world.securityProviders.find(
        (p) => p.name.toLowerCase().includes(name) || name.includes(p.name.toLowerCase()),
      )
    : null;
  if (byName) return { providerId: byName.id, detail: null };
  return { providerId: null, detail: "The security provider is not one we know." };
}

export function evaluateSecurityQuote(
  world: World,
  doc: ExtractInput,
  q: SecurityQuoteExtraction,
  ctx: { receivedAt: Date; hasUnreadableAttachment: boolean; validityWritten: boolean },
): {
  status: "extracted" | "needs_review";
  fieldEvidence: Record<string, string | null>;
  checks: CheckResult[];
  securityQuote: NormalisedSecurityQuote | null;
} {
  const source = sourceText(doc);
  const text = (path: string, f: { value: string | null; evidence: string | null }) => ({
    path,
    evidence: f.evidence,
    mustContain: f.value,
    present: f.value !== null || f.evidence !== null,
  });
  const numbered = (path: string, f: { asWritten: string | null; evidence: string | null }) => ({
    path,
    evidence: f.evidence,
    mustContain: f.asWritten,
    present: f.asWritten !== null || f.evidence !== null,
  });
  const items = [
    text("providerName", q.providerName),
    text("vesselName", q.vesselName),
    text("vesselImo", q.vesselImo),
    text("embarkPort", q.embarkPort),
    text("disembarkPort", q.disembarkPort),
    numbered("teamSize", q.teamSize),
    numbered("dayRate", q.dayRate),
    numbered("fixedFees", q.fixedFees),
    numbered("minDays", q.minDays),
    numbered("validUntil", { asWritten: q.validUntil.asWritten, evidence: q.validUntil.evidence }),
  ];
  const fieldEvidence = Object.fromEntries(items.map((i) => [i.path, i.evidence]));
  const checks: CheckResult[] = items
    .filter((i) => i.present)
    .map((i) =>
      ok(
        `evidence_found:${i.path}`,
        evidenceSupports(source, i.evidence, i.mustContain)
          ? []
          : [`Evidence for ${i.path} is missing, not verbatim in the email, or lacks the value.`],
      ),
    );

  const provider = resolveProvider(world, doc.sender, q.providerName.value);
  checks.push(ok("security_provider_resolved", provider.detail ? [provider.detail] : []));
  const embark = resolvePort(world, q.embarkPort.value);
  checks.push(
    ok("embark_port_resolved", embark.port ? [] : [embark.detail ?? "No embarkation port."]),
  );
  const disembark = resolvePort(world, q.disembarkPort.value);
  checks.push(
    ok(
      "disembark_port_resolved",
      disembark.port ? [] : [disembark.detail ?? "No disembarkation port."],
    ),
  );
  const vessel =
    q.vesselName.value === null && q.vesselImo.value === null
      ? { vessel: null, detail: null }
      : resolveVessel(world, { name: q.vesselName.value, imo: q.vesselImo.value });
  checks.push(ok("vessel_resolved", vessel.detail ? [vessel.detail] : []));

  const team = teamCount(q.teamSize);
  const teamOk = team !== null && Number.isInteger(team) && team > 0;
  checks.push(
    ok(
      "team_size_unambiguous",
      teamOk
        ? []
        : [`The team size reads as "${q.teamSize.asWritten ?? "nothing"}", not one number.`],
    ),
  );
  // Fees and minimum days are never assumed: one left out may be one the email states.
  const dayRate = amount(q.dayRate);
  const fixedFees = amount(q.fixedFees);
  const minDays = amount(q.minDays);
  const stated = (f: { value: number | null; asWritten: string | null }) =>
    f.value !== null || f.asWritten !== null;
  const amountFailures: string[] = [];
  if (dayRate === null || dayRate <= 0) amountFailures.push("The day rate is not one amount.");
  if (!stated(q.fixedFees)) amountFailures.push("No fixed fees were transcribed.");
  else if (fixedFees === null) amountFailures.push("The fixed fees are not one amount.");
  if (!stated(q.minDays)) amountFailures.push("No minimum days were transcribed.");
  else if (minDays === null || !Number.isInteger(minDays))
    amountFailures.push("The minimum days are not a whole number.");
  checks.push(ok("amounts_parsed", amountFailures));

  const currency = normaliseCurrency(q.dayRate.currency);
  const feesCurrency =
    q.fixedFees.currency === null ? currency : normaliseCurrency(q.fixedFees.currency);
  checks.push(
    ok(
      "currency_known",
      currency === null
        ? ["The day rate's currency is not USD or EUR."]
        : feesCurrency !== currency
          ? ["The fixed fees are in another currency than the day rate."]
          : [],
    ),
  );

  const validUntil = parseQuoteDate(q.validUntil.asWritten, ctx.receivedAt);
  checks.push(
    ok(
      "dates_parsed",
      q.validUntil.asWritten === null
        ? ctx.validityWritten
          ? ["No validity was transcribed, but the email writes one."]
          : []
        : validUntil === null
          ? [`The validity "${q.validUntil.asWritten}" does not read as a date.`]
          : [],
    ),
  );
  checks.push(
    ok(
      "attachment_text_found",
      ctx.hasUnreadableAttachment
        ? ["An attachment could not be read, so the document was not fully checked."]
        : [],
    ),
  );

  const passed = checks.every((c) => c.passed);
  const securityQuote: NormalisedSecurityQuote | null =
    passed &&
    provider.providerId !== null &&
    embark.port &&
    disembark.port &&
    teamOk &&
    dayRate !== null &&
    fixedFees !== null &&
    minDays !== null &&
    currency !== null
      ? {
          providerId: provider.providerId,
          vesselImo: vessel.vessel?.imo ?? null,
          embarkPortId: embark.port.id,
          disembarkPortId: disembark.port.id,
          teamSize: team as number,
          dayRate,
          fixedFees,
          minDays,
          currency,
          validUntil,
        }
      : null;
  return {
    status: securityQuote ? "extracted" : "needs_review",
    fieldEvidence,
    checks,
    securityQuote,
  };
}
