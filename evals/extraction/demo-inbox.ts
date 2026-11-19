/**
 * The Track 3 security emails of the demo inbox, rendered from their truth by the security
 * templates (templates/security-block.ts): 04, 05 and 06 come after the fuel emails 01–03, which
 * this file never writes. The inbox's "Deliver next email" sends the files in name order, skipping
 * any already ingested, so these three arrive after 01–03, in order.
 *
 *   npx tsx evals/extraction/demo-inbox.ts            write the three .eml files
 *   npx tsx evals/extraction/demo-inbox.ts --check    exit 1 if any differs (byte-stable)
 *
 * Values are the user's spec (Track 3 security story, 2026-11-19); everything else (greeting,
 * terms, signature) is drawn from a PRNG seeded per file, so the same code writes the same bytes.
 * Demo world: seed 20261114, anchor 2026-11-14T08:00:00Z (the pinned demo clock).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_WORLD_SEED, generateWorld, type World } from "@pharos/db";
import type { ExtractionTruth, TruthSecurityQuote } from "@pharos/shared";
import type { MailDraft, SecurityTranscription } from "./case.js";
import { renderMime } from "./mime.js";
import { createPrng, sha256Hex } from "./prng.js";
import {
  portByCode,
  providerByName,
  type SecurityFacts,
  securityTruthFromFacts,
} from "./security-facts.js";
import { refCode } from "./templates/phrasing.js";
import {
  phraseMinDays,
  providerCode,
  type SecurityLabels,
  type SecurityPhrase,
  securityHtmlBody,
  securityPlainBody,
  type TeamPhrase,
  transcribeSecurity,
} from "./templates/security-block.js";

export const DEMO_INBOX_DIR = join(import.meta.dirname, "../../fixtures/demo-inbox");
export const DEMO_ANCHOR = new Date("2026-11-14T08:00:00Z");

/** The demo world the console runs on (no golden-set voyage overrides). */
export const demoWorld = (): World =>
  generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: DEMO_ANCHOR });

export interface DemoSecurityEmail {
  file: string;
  provider: string;
  /** Mailbox local part at the provider's domain. */
  local: string;
  person: { first: string; last: string };
  received: string;
  vessel: { text: string; name: string | null; imo: string | null };
  embark: string;
  disembark: string;
  team: TeamPhrase;
  /** The team size the truth stores; null when the email gives a choice. */
  teamSize: number | null;
  dayRate: { value: number; asWritten: string };
  fixedFees: { value: number; asWritten: string };
  minDays: number;
  validity: { iso: string; asWritten: string } | null;
  layout: "plain-labels" | "plain-prose" | "html-kv-table";
  subject: string;
  /** What a careful desk must do with it. */
  status: "extracted" | "needs_review";
  reviewChecks: string[];
}

const LABELS: SecurityLabels = {
  vessel: "Vessel",
  embark: "Embarkation",
  disembark: "Disembarkation",
  team: "Team",
  dayRate: "Day rate",
  minDays: "Minimum period",
  fees: "Fixed fees",
  validity: "Valid until",
};

const AM = "MT Atlantic Meridian";

/** The three security offers for MT Atlantic Meridian's Fujairah departure. */
export const DEMO_SECURITY_EMAILS: readonly DemoSecurityEmail[] = [
  {
    file: "04-tridentis-djibouti.eml",
    provider: "Tridentis Marine Protection",
    local: "operations",
    person: { first: "Daniel", last: "Okafor" },
    received: "2026-11-14T06:00:00Z",
    vessel: { text: `${AM} (IMO 9485069)`, name: AM, imo: "9485069" },
    embark: "AEFJR",
    disembark: "DJJIB",
    team: { asWritten: "4 guards", unit: "guards", value: 4, form: "guards" },
    teamSize: 4,
    dayRate: { value: 1250, asWritten: "USD 1,250 per day" },
    fixedFees: { value: 6000, asWritten: "USD 6,000 lump sum" },
    minDays: 4,
    validity: { iso: "2026-11-20", asWritten: "20 November 2026" },
    layout: "plain-labels",
    subject: "Armed security team - MT Atlantic Meridian - Fujairah to Djibouti",
    status: "extracted",
    reviewChecks: [],
  },
  {
    file: "05-harbourline-durban.eml",
    provider: "Harbourline Security Services",
    local: "quotes",
    person: { first: "Sarah", last: "Pillay" },
    received: "2026-11-14T06:20:00Z",
    vessel: { text: AM, name: AM, imo: null },
    embark: "AEFJR",
    disembark: "ZADUR",
    team: { asWritten: "3 guards", unit: "guards", value: 3, form: "guards" },
    teamSize: 3,
    dayRate: { value: 1100, asWritten: "USD 1,100 per day" },
    fixedFees: { value: 5000, asWritten: "USD 5,000" },
    minDays: 5,
    validity: { iso: "2026-11-21", asWritten: "21 November 2026" },
    layout: "plain-prose",
    subject: "Security team offer: MT Atlantic Meridian, Fujairah to Durban",
    status: "extracted",
    reviewChecks: [],
  },
  {
    file: "06-aegis-suez.eml",
    provider: "Aegis Watch Maritime",
    local: "ops",
    person: { first: "Marco", last: "Ventura" },
    received: "2026-11-14T06:40:00Z",
    vessel: { text: `${AM} / IMO 9485069`, name: AM, imo: "9485069" },
    embark: "AEFJR",
    disembark: "EGSUZ",
    team: { asWritten: "4/6 guards", unit: "guards", value: null, form: "choice" },
    teamSize: null,
    dayRate: { value: 1450, asWritten: "USD 1,450 per day" },
    fixedFees: { value: 7000, asWritten: "USD 7,000 lump sum" },
    minDays: 4,
    validity: null,
    layout: "html-kv-table",
    subject: "PCASP quote - MT Atlantic Meridian - Fujairah/Suez",
    status: "needs_review",
    reviewChecks: ["team_size_unambiguous"],
  },
];

export interface RenderedDemoEmail {
  spec: DemoSecurityEmail;
  truth: ExtractionTruth;
  eml: string;
  transcription: SecurityTranscription;
}

/** The facts behind one demo email, from the world (the truth comes from these). */
function factsOf(world: World, e: DemoSecurityEmail): SecurityFacts {
  const vessel = world.vessels.find((v) => v.name === AM);
  if (vessel?.imo !== "9485069") throw new Error(`${AM} (IMO 9485069) is not in the world`);
  return {
    provider: providerByName(world, e.provider),
    vessel,
    embark: portByCode(world, e.embark),
    disembark: portByCode(world, e.disembark),
    teamSize: e.teamSize ?? 0,
    currency: "USD",
    dayRate: e.dayRate.value,
    fixedFees: e.fixedFees.value,
    minDays: e.minDays,
    receivedAt: new Date(e.received),
    validUntil: e.validity?.iso ?? null,
  };
}

export function renderDemoEmail(world: World, e: DemoSecurityEmail): RenderedDemoEmail {
  const facts = factsOf(world, e);
  const prng = createPrng(Number.parseInt(sha256Hex(`demo-inbox:${e.file}`).slice(0, 8), 16));
  const sp: SecurityPhrase = {
    facts,
    vessel: { ...e.vessel, form: e.vessel.imo ? "name-imo" : "name" },
    embark: { text: facts.embark.name, value: facts.embark.name },
    disembark: { text: facts.disembark?.name ?? "", value: facts.disembark?.name ?? null },
    team: e.team,
    dayRate: {
      value: e.dayRate.value,
      currency: "USD",
      perUnit: "per day",
      asWritten: e.dayRate.asWritten,
    },
    fees: {
      text: e.fixedFees.asWritten,
      span: {
        value: e.fixedFees.value,
        currency: "USD",
        perUnit: e.fixedFees.asWritten.endsWith("lump sum") ? "lump sum" : null,
        asWritten: e.fixedFees.asWritten,
      },
      form: e.fixedFees.asWritten.endsWith("lump sum") ? "lump" : "plain",
    },
    minDays: phraseMinDays(e.minDays),
    validity: e.validity?.asWritten ?? null,
    person: {
      first: e.person.first,
      last: e.person.last,
      local: e.local,
    },
    ref: refCode(prng, providerCode(facts.provider.erpCode)),
  };
  const address = `${e.local}@${facts.provider.emailDomain}`;
  const from = { name: `${e.person.first} ${e.person.last} - ${e.provider}`, address };
  let body: Pick<MailDraft, "text" | "html">;
  let transcription: SecurityTranscription;
  if (e.layout === "html-kv-table") {
    const { html, hints } = securityHtmlBody(prng, sp, "kv-table", address, undefined, LABELS);
    body = { html };
    transcription = transcribeSecurity(sp, hints);
  } else {
    const layout = e.layout === "plain-labels" ? "labels" : "prose";
    const { text, hints } = securityPlainBody(prng, sp, layout, address, LABELS);
    body = { text };
    transcription = transcribeSecurity(sp, hints);
  }
  const draft: MailDraft = {
    from,
    to: { name: "Bunker Desk", address: "bunker-desk@pharos-demo.example" },
    subject: e.subject,
    date: facts.receivedAt,
    messageId: `${e.file.replace(/\.eml$/, "")}@${facts.provider.emailDomain}`,
    ...body,
  };
  const security: TruthSecurityQuote = {
    ...securityTruthFromFacts(facts),
    teamSize: e.teamSize,
  };
  const truth: ExtractionTruth = {
    id: `demo-${e.file.replace(/\.eml$/, "")}`,
    tags: ["demo-security", e.layout],
    source: "generated",
    expected: {
      kind: "security_quote",
      status: e.status,
      reviewChecks: e.reviewChecks,
      quote: null,
      security,
    },
  };
  return {
    spec: e,
    truth,
    eml: renderMime(draft, sha256Hex(`boundary:${e.file}`).slice(0, 24)),
    transcription,
  };
}

export function renderDemoInbox(world: World = demoWorld()): RenderedDemoEmail[] {
  return DEMO_SECURITY_EMAILS.map((e) => renderDemoEmail(world, e));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rendered = renderDemoInbox();
  if (process.argv.includes("--check")) {
    const stale = rendered.filter((r) => {
      const path = join(DEMO_INBOX_DIR, r.spec.file);
      return !existsSync(path) || readFileSync(path, "utf8") !== r.eml;
    });
    if (stale.length > 0) {
      console.error(
        `demo security emails out of date: ${stale.map((r) => r.spec.file).join(", ")}`,
      );
      process.exit(1);
    }
    console.log(`demo security emails up to date (${rendered.length})`);
  } else {
    for (const r of rendered) writeFileSync(join(DEMO_INBOX_DIR, r.spec.file), r.eml);
    console.log(`wrote ${rendered.map((r) => r.spec.file).join(", ")} to ${DEMO_INBOX_DIR}`);
  }
}
