/**
 * Emails the bunker desk receives that are not quotes: invoices and delivery notes (which carry
 * prices or quantities), port notices, requests for quotation, out-of-office replies and
 * newsletters. Truth: kind not_a_quote, status not_a_quote.
 */
import { currentVoyage, type World } from "@pharos/db";
import type { ExtractionTruth, Port, Vessel } from "@pharos/shared";
import { DESK, type GoldenCase, type Mailbox, type MailDraft, OWN_DOMAIN } from "../case.js";
import { drawPrice, supplierKeyOf, upcomingServedPorts } from "../facts.js";
import { buildTextPdf, type PdfRow } from "../pdf.js";
import { type Prng, prngInt, prngPick } from "../prng.js";
import { EVAL_ANCHOR, openRequirementOf } from "../world.js";
import {
  addDays,
  bareName,
  formatDay,
  formatNumber,
  isoDay,
  longDate,
  phraseGrade,
  pickPerson,
  refCode,
  supplierCode,
} from "./phrasing.js";
import { messageIdOf, type TemplateContext } from "./quote-block.js";

export const NOT_A_QUOTE_KINDS = [
  "invoice",
  "delivery_note",
  "port_notice",
  "rfq",
  "out_of_office",
  "newsletter",
] as const;
export type NotAQuoteKind = (typeof NOT_A_QUOTE_KINDS)[number];

const money = (n: number) => formatNumber(n, { thousands: true, decimals: 2 });

interface Scene {
  vessel: Vessel;
  port: Port;
  supplier: World["suppliers"][number];
  receivedAt: Date;
}

function scene(prng: Prng, world: World): Scene {
  const vessel = prngPick(prng, world.vessels);
  const req = openRequirementOf(world, vessel.id);
  const ports = upcomingServedPorts(world, req.voyageId).map((id) => {
    const p = world.ports.find((x) => x.id === id);
    if (!p) throw new Error(`no port ${id}`);
    return p;
  });
  const port = prngPick(prng, ports);
  const supplier = prngPick(
    prng,
    world.suppliers.filter((s) => s.portIds.includes(port.id)),
  );
  const receivedAt = new Date(EVAL_ANCHOR.getTime() - prngInt(prng, 60, 44 * 60) * 60_000);
  return { vessel, port, supplier, receivedAt };
}

/**
 * Invoices and delivery notes are about a past delivery: at the current voyage's origin port
 * (where the vessel was), by a supplier there, on or before the day it sailed.
 */
function pastDelivery(prng: Prng, world: World, s: Scene): Scene & { sailedDay: string } {
  const voyage = currentVoyage(world, s.vessel.id);
  const origin = world.ports.find((p) => p.id === voyage?.originPortId);
  const suppliers = world.suppliers.filter((x) => origin && x.portIds.includes(origin.id));
  const receivedDay = isoDay(s.receivedAt);
  const departed = voyage?.departedAt ? isoDay(voyage.departedAt) : receivedDay;
  // ISO days sort as dates: the earlier of the two.
  const sailedDay = [departed, receivedDay].sort()[0] ?? receivedDay;
  if (!origin || suppliers.length === 0) return { ...s, sailedDay };
  return { ...s, port: origin, supplier: prngPick(prng, suppliers), sailedDay };
}

interface Rendered {
  from: Mailbox;
  to?: Mailbox;
  cc?: Mailbox[];
  subject: string;
  text: string;
  attachments?: MailDraft["attachments"];
  reason: string;
  /** Text on the evidence line. */
  evidence: string;
  note: string;
  extraTags?: string[];
}

async function invoice(prng: Prng, world: World, scene: Scene): Promise<Rendered> {
  const s = pastDelivery(prng, world, scene);
  const req = openRequirementOf(world, s.vessel.id);
  const qty = 25 * prngInt(prng, 4, 16) + prngPick(prng, [0, 0.4, 0.75]);
  const price = drawPrice(prng, world, s.port.id, req.grade, "USD");
  const barge = 50 * prngInt(prng, 24, 60);
  const total = Math.round((qty * price + barge) * 100) / 100;
  const delivered = addDays(s.sailedDay, -prngInt(prng, 0, 3));
  const due = addDays(delivered, 30);
  const code = supplierCode(s.supplier.erpCode);
  const no = `INV-${code}-${prngInt(prng, 10000, 99999)}`;
  const grade = phraseGrade(prng, req.grade);
  const rows = [
    `Invoice No.: ${no}`,
    `Vessel: ${s.vessel.name} (IMO ${s.vessel.imo})`,
    `Port of delivery: ${s.port.name}`,
    `Date of delivery: ${formatDay(delivered, "d-mon-yyyy")}`,
    `Product: ${grade}`,
    `Quantity delivered: ${formatNumber(qty, { thousands: true, decimals: 2 })} mt`,
    `Unit price: USD ${money(price)} per mt`,
    `Barging: USD ${money(barge)}`,
    `Total amount due: USD ${money(total)}`,
    `Payment due: ${formatDay(due, "d-mon-yyyy")}`,
  ];
  const from = {
    name: `${s.supplier.name} Accounts`,
    address: `accounts@${s.supplier.emailDomain}`,
  };
  const subject = `Invoice ${no} - ${bareName(s.vessel)} - ${s.port.name}`;
  const asPdf = prng() < 0.5;
  const intro = `Please find ${asPdf ? "attached" : "below"} our invoice for the bunker delivery to ${s.vessel.name} at ${s.port.name}.`;
  const sign = ["Kind regards,", "Accounts Receivable", s.supplier.name];
  if (asPdf) {
    const pdfRows: PdfRow[] = [
      { text: s.supplier.name.toUpperCase(), bold: true, size: 15 },
      { text: "COMMERCIAL INVOICE", bold: true, size: 12 },
      { gap: 8 },
      ...rows.map((text) => ({ text })),
      { gap: 10 },
      { text: "Please quote the invoice number with your payment.", size: 9 },
    ];
    return {
      from,
      subject,
      text: ["Dear Sirs,", "", intro, "", ...sign].join("\n"),
      attachments: [
        {
          filename: `${no}.pdf`,
          contentType: "application/pdf",
          content: await buildTextPdf(pdfRows),
        },
      ],
      reason: "An invoice for a completed delivery, not an offer to sell fuel.",
      evidence: "COMMERCIAL INVOICE",
      note: "Invoice in a PDF attachment: has a unit price and quantity, but bills a past delivery.",
      extraTags: ["attachment:pdf"],
    };
  }
  return {
    from,
    subject,
    text: [
      "Dear Sirs,",
      "",
      intro,
      "",
      ...rows,
      "",
      "Please quote the invoice number with your payment.",
      "",
      ...sign,
    ].join("\n"),
    reason: "An invoice for a completed delivery, not an offer to sell fuel.",
    evidence: `Invoice No.: ${no}`,
    note: "Invoice in the body: has a unit price and quantity, but bills a past delivery.",
  };
}

async function deliveryNote(prng: Prng, world: World, scene: Scene): Promise<Rendered> {
  const s = pastDelivery(prng, world, scene);
  const req = openRequirementOf(world, s.vessel.id);
  const qty = (25 * prngInt(prng, 4, 16) * 1000 - prngInt(prng, 0, 900)) / 1000;
  const delivered = s.sailedDay;
  const no = refCode(prng, `BDN-${supplierCode(s.supplier.erpCode)}`);
  const density = (prngInt(prng, 8300, 8600) / 10000).toFixed(4);
  const sulphur = req.grade === "LSMGO" ? "0.08" : req.grade === "VLSFO" ? "0.47" : "2.85";
  const rows = [
    `BDN No.: ${no}`,
    `Vessel: ${s.vessel.name} / IMO ${s.vessel.imo}`,
    `Port: ${s.port.name}`,
    `Delivery date: ${formatDay(delivered, "dd/mm/yyyy")}`,
    `Product: ${phraseGrade(prng, req.grade)}`,
    `Quantity delivered: ${qty.toFixed(3)} mt`,
    `Density at 15 C: ${density} kg/l`,
    `Sulphur content: ${sulphur} % m/m`,
    `Supplying barge: ${prngPick(prng, ["Sea Lark", "Pelican II", "Marlin", "Nereus", "Delfin 3"])}`,
  ];
  const from = {
    name: `${s.supplier.name} Operations`,
    address: `operations@${s.supplier.emailDomain}`,
  };
  const subject = `Bunker Delivery Note ${no} - ${bareName(s.vessel)}`;
  const asPdf = prng() < 0.5;
  const sign = ["Regards,", "Operations", s.supplier.name];
  const intro = `The delivery to ${s.vessel.name} at ${s.port.name} has been completed. The signed bunker delivery note is ${asPdf ? "attached" : "copied below"} for your records.`;
  if (asPdf) {
    const pdfRows: PdfRow[] = [
      { text: s.supplier.name.toUpperCase(), bold: true, size: 15 },
      { text: "BUNKER DELIVERY NOTE", bold: true, size: 12 },
      { text: "(MARPOL Annex VI, Regulation 18)", size: 9 },
      { gap: 8 },
      ...rows.map((text) => ({ text })),
      { gap: 12 },
      { text: "Signed: Chief Engineer / Barge Master", size: 9 },
    ];
    return {
      from,
      subject,
      text: ["Dear all,", "", intro, "", ...sign].join("\n"),
      attachments: [
        {
          filename: `${no}.pdf`,
          contentType: "application/pdf",
          content: await buildTextPdf(pdfRows),
        },
      ],
      reason: "A bunker delivery note for a completed delivery, not an offer.",
      evidence: "BUNKER DELIVERY NOTE",
      note: "Delivery note in a PDF attachment: quantity and grade, no offer.",
      extraTags: ["attachment:pdf"],
    };
  }
  return {
    from,
    subject,
    text: ["Dear all,", "", intro, "", "BUNKER DELIVERY NOTE", ...rows, "", ...sign].join("\n"),
    reason: "A bunker delivery note for a completed delivery, not an offer.",
    evidence: `BDN No.: ${no}`,
    note: "Delivery note in the body: quantity and grade, no offer.",
  };
}

function portNotice(prng: Prng, _world: World, s: Scene): Rendered {
  const day = addDays(isoDay(s.receivedAt), prngInt(prng, 1, 3));
  const topics: [string, string[]][] = [
    [
      "Bunkering suspended (weather)",
      [
        `Due to forecast winds of 35-40 knots, all bunkering operations at ${s.port.name} anchorage are suspended from ${formatDay(day, "d-mon")} 06:00 LT until further notice.`,
        "Vessels already alongside a barge must stop transfers and secure hoses.",
      ],
    ],
    [
      "Anchorage area closed",
      [
        `Anchorage area B at ${s.port.name} will be closed for dredging works from ${formatDay(day, "d-mon-yyyy")} for five days.`,
        "Vessels are requested to use anchorage area C. Bunker barges will operate from area C only.",
      ],
    ],
    [
      "Pilotage delays",
      [
        `Pilot boarding at ${s.port.name} is subject to delays of up to 12 hours because of crew shortages.`,
        "Please advise the agent of revised ETAs at least 24 hours in advance.",
      ],
    ],
    [
      "Holiday working hours",
      [
        `On ${longDate(day)} the port office at ${s.port.name} will work reduced hours (08:00-14:00 LT).`,
        "Bunker deliveries will continue as scheduled.",
      ],
    ],
  ];
  const [topic, lines] = prngPick(prng, topics);
  const agency = prngPick(prng, ["harbourmaster", "port-agency", "shipping-agents"]);
  const domain = `${s.port.unlocode.toLowerCase()}-${agency}.example`;
  const no = `${s.port.unlocode}-${prngInt(prng, 100, 999)}/2026`;
  return {
    from: { name: `${s.port.name} Port Information`, address: `notices@${domain}` },
    subject: `Port notice ${no}: ${s.port.name} - ${topic}`,
    text: [
      `NOTICE TO SHIPPING No. ${no}`,
      "",
      ...lines,
      "",
      "This notice is issued for information to all port users.",
      `${s.port.name} Port Information Service`,
    ].join("\n"),
    reason: "A port notice to shipping, not an offer of fuel.",
    evidence: `NOTICE TO SHIPPING No. ${no}`,
    note: `Port notice (${topic}).`,
  };
}

function rfq(prng: Prng, world: World, s: Scene): Rendered {
  const req = openRequirementOf(world, s.vessel.id);
  const from = addDays(isoDay(s.receivedAt), prngInt(prng, 3, 8));
  const to = addDays(from, prngInt(prng, 1, 2));
  const person = pickPerson(prng);
  const supplierKey = supplierKeyOf(world, s.supplier.id);
  const opener = prngPick(prng, [
    "Please quote your best price for the following stem:",
    "Kindly offer for the below requirement:",
    "Could you please send us your offer for:",
  ]);
  return {
    from: {
      name: `${person.first} ${person.last} - Pharos Operations`
        .normalize("NFD")
        .replace(/[^\x20-\x7e]/g, ""),
      address: `operations@${OWN_DOMAIN}`,
    },
    to: { name: `${s.supplier.name} Trading`, address: `trading@${s.supplier.emailDomain}` },
    cc: [DESK],
    subject: `Enquiry - ${bareName(s.vessel)} - ${s.port.name} - ${req.grade}`,
    text: [
      "Dear Sirs,",
      "",
      opener,
      "",
      `Vessel: ${s.vessel.name} (IMO ${s.vessel.imo})`,
      `Port: ${s.port.name}`,
      `Grade: ${phraseGrade(prng, req.grade)}`,
      `Quantity: ${req.qtyMt} mt`,
      `Delivery: ${formatDay(from, "d-mon")} - ${formatDay(to, "d-mon-yyyy")}`,
      "",
      "Please include barging costs, payment terms and the validity of your offer.",
      "",
      "Best regards,",
      `${person.first} ${person.last}`,
      "Operations, Pharos Shipping",
    ].join("\n"),
    reason: "A request for quotation sent to a supplier, not a supplier's offer.",
    evidence: opener,
    note: `Our own enquiry to ${supplierKey}, copied to the desk: vessel, grade and quantity but no price.`,
  };
}

function outOfOffice(prng: Prng, _world: World, s: Scene): Rendered {
  const person = pickPerson(prng);
  const back = addDays(isoDay(s.receivedAt), prngInt(prng, 2, 6));
  const line = prngPick(prng, [
    `I am out of the office until ${longDate(back)} with limited access to email.`,
    `Thank you for your message. I am currently out of the office and will return on ${formatDay(back, "d-month")}.`,
  ]);
  return {
    from: {
      name: `${person.first} ${person.last}`.normalize("NFD").replace(/[^\x20-\x7e]/g, ""),
      address: `${person.local}@${s.supplier.emailDomain}`,
    },
    subject: `Automatic reply: Enquiry - ${bareName(s.vessel)} - ${s.port.name}`,
    text: [
      line,
      "",
      `For urgent bunker enquiries please contact our trading desk at trading@${s.supplier.emailDomain}.`,
      "",
      `${person.first} ${person.last}`,
      s.supplier.name,
    ].join("\n"),
    reason: "An automatic out-of-office reply.",
    evidence: line,
    note: "Out-of-office auto-reply from a supplier trader.",
  };
}

function newsletter(prng: Prng, _world: World, s: Scene): Rendered {
  const sources = [
    { name: "Bunker Digest", address: "newsletter@bunker-digest.example" },
    { name: "Marine Fuels Weekly", address: "news@marinefuels-weekly.example" },
    { name: `${s.supplier.name} News`, address: `news@${s.supplier.emailDomain}` },
  ];
  const src = prngPick(prng, sources);
  const issue = prngInt(prng, 120, 480);
  const items = prngPick(prng, [
    [
      "FuelEU Maritime: what changes for charterers in 2027",
      "The first verification cycle closes in the spring. We summarise the reporting steps and the penalties for missing the GHG intensity target.",
    ],
    [
      "Mediterranean ECA: lessons from the first eighteen months",
      "Since the Mediterranean ECA took effect, demand for compliant distillates in the region has risen steadily.",
    ],
    [
      "Event: Mediterranean Bunker Forum, 3-4 December",
      "Join traders, suppliers and port authorities for two days of panels on supply security and alternative fuels.",
    ],
    [
      "Market comment",
      "Distillate prices eased slightly this week on softer crude, while VLSFO held steady in most hubs.",
    ],
  ]);
  const header = `${src.name} - Issue ${issue}`;
  return {
    from: src,
    subject: `${src.name} | Issue ${issue}: ${items[0]}`,
    text: [
      header,
      "",
      items[0],
      items[1],
      "",
      "Also in this issue: port news, regulatory calendar, people moves.",
      "",
      "You receive this newsletter because you subscribed at our website. Unsubscribe at any time.",
    ].join("\n"),
    reason: "A newsletter, not an offer.",
    evidence: header,
    note: `Newsletter from ${src.name}.`,
  };
}

const RENDERERS: Record<
  NotAQuoteKind,
  (p: Prng, w: World, s: Scene) => Rendered | Promise<Rendered>
> = {
  invoice,
  delivery_note: deliveryNote,
  port_notice: portNotice,
  rfq,
  out_of_office: outOfOffice,
  newsletter,
};

export async function renderNotAQuote(
  ctx: TemplateContext,
  kind: NotAQuoteKind,
): Promise<GoldenCase> {
  const { prng, world, id } = ctx;
  const s = scene(prng, world);
  const r = await RENDERERS[kind](prng, world, s);
  const truth: ExtractionTruth = {
    id,
    tags: ["not_a_quote", `kind:${kind}`, ...(r.extraTags ?? [])],
    source: "generated",
    expected: { kind: "not_a_quote", status: "not_a_quote", reviewChecks: [], quote: null },
  };
  const domain = r.from.address.split("@")[1] ?? OWN_DOMAIN;
  return {
    truth,
    mail: {
      from: r.from,
      to: r.to ?? DESK,
      ...(r.cc ? { cc: r.cc } : {}),
      subject: r.subject,
      date: s.receivedAt,
      messageId: messageIdOf(id, domain),
      text: r.text,
      ...(r.attachments ? { attachments: r.attachments } : {}),
    },
    transcription: { kind: "not_a_quote", reason: r.reason, evidence: { value: r.evidence } },
    note: r.note,
  };
}
