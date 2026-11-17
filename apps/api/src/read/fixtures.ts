/**
 * Fixture-backed ReadSource, for tests and console work without a database. Every number comes
 * from generateWorld + domain calculators or DEMO_SCENARIO; nothing is typed by hand.
 */

import {
  buildDemoBunkerPlanInput,
  DEFAULT_WORLD_SEED,
  DEMO_SCENARIO,
  generateWorld,
  pinnedNow,
  type World,
} from "@pharos/db";
import { planBunkers } from "@pharos/domain";
import type {
  ExtractionOutput,
  InboxItem,
  InboxItemDetail,
  QuoteView,
  RecommendationView,
} from "@pharos/shared";
import { convert } from "html-to-text";
import { BUNKER_SAVING_PATH, bunkerOptionViewFacts, bunkerScope } from "../facts/bunker.js";
import type { ReadSource } from "./source.js";
import { buildPorts, buildVessels, buildVoyages, must } from "./world-views.js";

export const FIXTURE_ANCHOR = new Date("2026-11-14T08:00:00Z");

const HOUR_MS = 3_600_000;

type Option = (typeof DEMO_SCENARIO.options)[number];

const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------- demo inbox ----------

interface Parts {
  supplierLine: string;
  vesselLine: string;
  portLine: string;
  grade: string;
  qtyAsWritten: string;
  /** The span containing the quantity (the whole cell/sentence). */
  qtyEvidence: string;
  priceAsWritten: string;
  priceEvidence: string;
  bargeAsWritten: string;
  bargeEvidence: string;
}

export interface DemoEmail {
  option: Option;
  supplierName: string;
  sender: string;
  subject: string;
  kind: "email" | "pdf";
  bodyText: string;
  parts: Parts;
  ambiguousQuantity: boolean;
  receivedAt: Date;
}

export function buildDemoEmails(world: World): DemoEmail[] {
  const grade = DEMO_SCENARIO.requirement.grade;
  const vesselName = must(
    world.vessels.find((v) => v.imo === DEMO_SCENARIO.vesselImo),
    "demo vessel",
  ).name;
  const portNameOf = (code: string) =>
    must(
      world.ports.find((p) => p.unlocode === code),
      `port ${code}`,
    ).name;
  // Supplier ids come from the planner input, which maps each demo option to its supplier row.
  const planOptions = buildDemoBunkerPlanInput(world).options;
  const supplierOf = (key: string) => {
    const optionId = must(
      DEMO_SCENARIO.options.find((o) => o.supplierKey === key),
      `option ${key}`,
    ).optionId;
    const supplierId = must(
      planOptions.find((o) => o.optionId === optionId),
      `plan option ${optionId}`,
    ).supplierId;
    return must(
      world.suppliers.find((s) => s.id === supplierId),
      `supplier ${key}`,
    );
  };
  const option = (key: string) =>
    must(
      DEMO_SCENARIO.options.find((o) => o.supplierKey === key),
      `option ${key}`,
    );
  const vesselLine = `Vessel: ${vesselName} (IMO ${DEMO_SCENARIO.vesselImo})`;
  const price = (o: Option) => `${o.currency} ${num(o.pricePerMt)} per mt`;
  const barge = (o: Option) => `${o.currency} ${num(o.bargeFee)} lump sum`;

  // 1. Plain text: Kestrel, Marsaxlokk, USD.
  const kes = option("kestrel");
  const kesSup = supplierOf("kestrel");
  const kesPort = portNameOf(kes.portLocode);
  const kesParts: Parts = {
    supplierLine: kesSup.name,
    vesselLine,
    portLine: `Port: ${kesPort}`,
    grade,
    qtyAsWritten: `${num(kes.qtyMt)} mt`,
    qtyEvidence: `Quantity: ${num(kes.qtyMt)} mt ${grade}`,
    priceAsWritten: price(kes),
    priceEvidence: `Price: ${price(kes)}`,
    bargeAsWritten: barge(kes),
    bargeEvidence: `Barge fee: ${barge(kes)}`,
  };
  const kesBody = [
    "Dear Bunker Desk,",
    "",
    `Please find our offer for ${vesselName}.`,
    kesParts.vesselLine,
    kesParts.portLine,
    kesParts.qtyEvidence,
    kesParts.priceEvidence,
    kesParts.bargeEvidence,
    "",
    "Best regards,",
    `${kesSup.name} trading desk`,
  ].join("\n");

  // 2. HTML table, EUR, quantity written as a range: Nordwind, Algeciras.
  const nor = option(DEMO_SCENARIO.needsReview.supplierKey);
  const norSup = supplierOf(DEMO_SCENARIO.needsReview.supplierKey);
  const norPort = portNameOf(nor.portLocode);
  // Written exactly as the scenario says; the quantity itself stays unresolved (null) until review.
  const ambiguousQty = DEMO_SCENARIO.needsReview.qtyAsWritten;
  const norParts: Parts = {
    supplierLine: norSup.name,
    vesselLine,
    portLine: `Port: ${norPort}`,
    grade,
    qtyAsWritten: ambiguousQty,
    qtyEvidence: ambiguousQty,
    priceAsWritten: `${nor.currency} ${num(nor.pricePerMt)} / mt`,
    priceEvidence: `${nor.currency} ${num(nor.pricePerMt)} / mt`,
    bargeAsWritten: barge(nor),
    bargeEvidence: `Barge fee: ${barge(nor)}`,
  };
  const norHtml = `<html><body>
<p>Dear Bunker Desk,</p>
<p>${norParts.vesselLine}</p>
<p>${norParts.portLine}</p>
<table>
<tr><th>Grade</th><th>Quantity</th><th>Price</th></tr>
<tr><td>${grade}</td><td>${norParts.qtyEvidence}</td><td>${norParts.priceEvidence}</td></tr>
</table>
<p>${norParts.bargeEvidence}</p>
<p>${norSup.name}</p>
</body></html>`;
  const norBody = convert(norHtml, {
    wordwrap: false,
    selectors: [{ selector: "table", format: "dataTable" }],
  });

  // 3. PDF attachment, text extracted: Strait Line, Gibraltar, USD.
  const str = option("straitline");
  const strSup = supplierOf("straitline");
  const strPort = portNameOf(str.portLocode);
  const strParts: Parts = {
    supplierLine: `Supplier: ${strSup.name}`,
    vesselLine,
    portLine: `Port: ${strPort}`,
    grade,
    qtyAsWritten: `${num(str.qtyMt)} MT`,
    qtyEvidence: `Quantity: ${num(str.qtyMt)} MT ${grade}`,
    priceAsWritten: `${str.currency} ${num(str.pricePerMt)} PMT`,
    priceEvidence: `Price: ${str.currency} ${num(str.pricePerMt)} PMT`,
    bargeAsWritten: barge(str),
    bargeEvidence: `Barge fee: ${barge(str)}`,
  };
  const strBody = [
    "BUNKER QUOTATION",
    strParts.supplierLine,
    strParts.vesselLine,
    strParts.portLine,
    strParts.qtyEvidence,
    strParts.priceEvidence,
    strParts.bargeEvidence,
  ].join("\n");

  const at = (hoursBefore: number) => new Date(world.meta.anchor.getTime() - hoursBefore * HOUR_MS);
  return [
    {
      option: kes,
      supplierName: kesSup.name,
      sender: `bunkers@${kesSup.emailDomain}`,
      subject: `${grade} offer - ${vesselName} - ${kesPort}`,
      kind: "email",
      bodyText: kesBody,
      parts: kesParts,
      ambiguousQuantity: false,
      receivedAt: at(5),
    },
    {
      option: nor,
      supplierName: norSup.name,
      sender: `quotes@${norSup.emailDomain}`,
      subject: `Offer ${norPort} - ${vesselName}`,
      kind: "email",
      bodyText: norBody,
      parts: norParts,
      ambiguousQuantity: true,
      receivedAt: at(3),
    },
    {
      option: str,
      supplierName: strSup.name,
      sender: `sales@${strSup.emailDomain}`,
      subject: `Quotation ${strPort} - ${vesselName} (PDF attached)`,
      kind: "pdf",
      bodyText: strBody,
      parts: strParts,
      ambiguousQuantity: false,
      receivedAt: at(1),
    },
  ];
}

/** What a correct extraction of a demo email looks like (values as written in it). */
export function demoExtraction(world: World, e: DemoEmail): ExtractionOutput {
  const p = e.parts;
  const o = e.option;
  const demoVessel = must(
    world.vessels.find((v) => v.imo === DEMO_SCENARIO.vesselImo),
    "demo vessel",
  );
  const portName = must(
    world.ports.find((x) => x.unlocode === o.portLocode),
    "demo port",
  ).name;
  const none = { asWritten: null, evidence: null };
  return {
    kind: "quote" as const,
    supplierName: { value: e.supplierName, evidence: p.supplierLine },
    vesselName: { value: demoVessel.name, evidence: p.vesselLine },
    vesselImo: { value: demoVessel.imo, evidence: p.vesselLine },
    port: { value: portName, evidence: p.portLine },
    deliveryFrom: none,
    deliveryTo: none,
    validUntil: none,
    bargeFee: {
      value: o.bargeFee,
      currency: o.currency,
      perUnit: "lump sum",
      asWritten: p.bargeAsWritten,
      evidence: p.bargeEvidence,
    },
    lines: [
      {
        grade: { value: p.grade, evidence: p.grade },
        quantity: {
          value: e.ambiguousQuantity ? null : o.qtyMt,
          unit: "mt",
          asWritten: p.qtyAsWritten,
          evidence: p.qtyEvidence,
        },
        price: {
          value: o.pricePerMt,
          currency: o.currency,
          perUnit: "mt",
          asWritten: p.priceAsWritten,
          evidence: p.priceEvidence,
        },
      },
    ],
    notes: null,
  };
}

function buildInbox(world: World) {
  return buildDemoEmails(world).map((e, i): { item: InboxItem; detail: InboxItemDetail } => {
    const item: InboxItem = {
      documentId: i + 1,
      sender: e.sender,
      subject: e.subject,
      receivedAt: e.receivedAt.toISOString(),
      kind: e.kind,
      extractionStatus: e.ambiguousQuantity ? "needs_review" : "extracted",
    };
    const detail: InboxItemDetail = {
      ...item,
      bodyText: e.bodyText,
      extraction: demoExtraction(world, e),
      checkResults: [
        { check: "sender_domain_matches_supplier", passed: true, detail: null },
        { check: "vessel_imo_check_digit", passed: true, detail: null },
        e.ambiguousQuantity
          ? {
              check: "quantity_unambiguous",
              passed: false,
              detail: `Quantity is written as "${e.parts.qtyAsWritten}"; confirm with the supplier before use.`,
            }
          : { check: "quantity_unambiguous", passed: true, detail: null },
      ],
      error: null,
      extractionId: i + 1,
    };
    return { item, detail };
  });
}

function buildQuotes(world: World): QuoteView[] {
  return buildDemoEmails(world).map((e, i) => ({
    id: i + 1,
    supplierName: e.supplierName,
    portName: must(
      world.ports.find((p) => p.unlocode === e.option.portLocode),
      "demo port",
    ).name,
    currency: e.option.currency,
    bargeFee: e.option.bargeFee,
    validUntil: null,
    status: e.ambiguousQuantity ? "needs_review" : "received",
    lines: [
      {
        grade: DEMO_SCENARIO.requirement.grade,
        // A needs-review quote shows no quantity: the supplier's text is ambiguous.
        qtyMt: e.ambiguousQuantity ? null : e.option.qtyMt,
        pricePerMt: e.option.pricePerMt,
      },
    ],
    documentId: i + 1,
  }));
}

// ---------- recommendation ----------

const CALCULATION_ID = 1;

/** The demo plan's best option as the approval view shows it, built by the view's own builder. */
function buildRecommendation(world: World): RecommendationView {
  const input = buildDemoBunkerPlanInput(world);
  const plan = planBunkers(input);
  const bestId = must(plan.bestOptionId, "best bunker option");
  const names = (optionId: string) => {
    const option = must(
      input.options.find((o) => o.optionId === optionId),
      "plan option",
    );
    return {
      supplier: must(
        world.suppliers.find((s) => s.id === option.supplierId),
        "option supplier",
      ).name,
      port: must(
        world.ports.find((p) => p.id === option.portId),
        "option port",
      ).name,
    };
  };
  const facts = bunkerOptionViewFacts(
    {
      calculationId: CALCULATION_ID,
      plan,
      scope: bunkerScope(input.grade, bestId),
      names,
      displacementMt: input.curve.load?.displacementMt ?? null,
    },
    bestId,
  );
  const { supplier, port } = names(bestId);
  // The plan's saving fact: there is one exactly when the plan has a saving.
  const saving =
    facts.find(
      (f) => f.provenance.source === "calculation" && f.provenance.path === BUNKER_SAVING_PATH,
    ) ?? null;

  return {
    id: 1,
    type: "purchase_order",
    status: "pending",
    calculationId: CALCULATION_ID,
    optionId: bestId,
    optionLabel: `${supplier} at ${port}`,
    summary: `Order ${DEMO_SCENARIO.requirement.grade} for the ${DEMO_SCENARIO.voyageNo} stem from ${supplier} at ${port}.`,
    expectedSavingUsd: plan.savingVsCheapestHeadlineUsd,
    expectedSaving: saving,
    factRefs: facts.map((f) => f.id),
    facts,
    // A fixture proposal: made by no ask, not approved.
    gatePassed: null,
    order: null,
    instruction: null,
  };
}

// ---------- source ----------

export function createFixtureSource(): ReadSource {
  const world = generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR });
  const vessels = buildVessels(world, pinnedNow(FIXTURE_ANCHOR));
  const voyages = buildVoyages(world);
  const inbox = buildInbox(world);
  const quotes = buildQuotes(world);
  const recommendation = buildRecommendation(world);
  const ports = buildPorts(world);

  return {
    dataTag: "fixture",
    listVessels: async () => vessels.map((v) => v.summary),
    getVessel: async (id) => vessels.find((v) => v.summary.id === id)?.detail ?? null,
    listVoyages: async () => voyages.map((v) => v.summary),
    getVoyage: async (id) => voyages.find((v) => v.summary.id === id)?.detail ?? null,
    listInbox: async () => inbox.map((i) => i.item),
    getInboxItem: async (id) => inbox.find((i) => i.item.documentId === id)?.detail ?? null,
    listQuotes: async () => quotes,
    getQuote: async (id) => quotes.find((q) => q.id === id) ?? null,
    listRecommendations: async () => [recommendation],
    getRecommendation: async (id) => (id === recommendation.id ? recommendation : null),
    worldAnchor: async () => new Date(world.meta.anchor.getTime()),
    listPorts: async () => ports,
    // The fixture recommendation is still pending: nothing has been decided, so nothing is audited.
    listAuditEvents: async () => [],
  };
}
