/**
 * Drafted messages for a human to send after an approval: for a purchase order, a supplier
 * confirmation and a master instruction; for a voyage instruction, the master's route-and-speed
 * instruction, naming its bunker stop when the plan has one. Pure templates, no model call. Every
 * number is the stored calculation's option or the stored order; nothing here is ever sent
 * (Pharos has no outbound channel).
 *
 * Addresses are deterministic placeholders (the seed has no contact address): `bunkers@` the
 * supplier's email domain, and `master.<vessel-slug>@fleet.pharos.example`.
 */
import type {
  BunkerOptionResult,
  DraftedMessage,
  FuelGrade,
  RouteOptionResult,
  StopPlanResult,
} from "@pharos/shared";

export interface DraftInput {
  recommendation: { id: number };
  order: {
    reference: string;
    poNumber: string | null;
    grade: FuelGrade;
    qtyMt: number;
    pricePerMt: number;
    currency: "USD" | "EUR";
    bargeFee: number;
  };
  supplier: { name: string; emailDomain: string };
  vessel: { name: string; imo: string };
  port: { name: string; unlocode: string };
  /** The bunker plan option the order was written from; null for an order from a route plan. */
  option: Pick<BunkerOptionResult, "optionId" | "totalCostUsd" | "effectivePriceUsdPerMt"> | null;
  /** The route plan's stop the order was written from: its times and its costs. */
  stop?:
    | (Pick<StopPlanResult, "bunkerFuelCostUsd" | "bargeFeeUsd"> & {
        arriveAt: string;
        departAt: string;
      })
    | null;
}

export type DraftedMessageInput = Omit<DraftedMessage, "id" | "createdAt">;

export interface VoyageInstructionDraftInput {
  recommendation: { id: number };
  vessel: { name: string };
  /** The destination the route calculation planned to. */
  destination: string;
  /** The approved route: its id and description, from the stored calculation. */
  route: { candidateId: string; label: string };
  /** The approved option (a route, or a stop plan) of the stored route calculation. */
  option: Pick<RouteOptionResult, "speedKn" | "eta" | "distanceNm">;
  /** The bunker stop the approved plan calls at; null or absent for a route with no stop. */
  stop?: {
    portName: string;
    arriveAt: string;
    departAt: string;
    qtyMt: number;
    grade: FuelGrade;
    supplierName: string;
  } | null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** An ISO timestamp as "YYYY-MM-DD hh:mm UTC", its own digits (seconds dropped). */
const utcMinute = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

const NOT_SENT =
  "This is a draft prepared by Pharos for a person to review and send. Pharos has not sent it.";

export const supplierAddress = (emailDomain: string) => `bunkers@${emailDomain}`;
export const masterAddress = (vesselName: string) =>
  `master.${slug(vesselName)}@fleet.pharos.example`;

export function draftMessages(input: DraftInput): DraftedMessageInput[] {
  const { order, supplier, vessel, port, option, stop } = input;
  const po = order.poNumber ?? "(number pending)";
  const grade = order.grade;
  // The plan's cost lines: a bunker plan's delivered cost, or a route stop's times and costs.
  const planned = [
    ...(option
      ? [
          `- Planned total delivered cost: ${fmt(option.totalCostUsd)} USD (${fmt(option.effectivePriceUsdPerMt)} USD per MT effective)`,
        ]
      : []),
    ...(stop
      ? [
          `- Bunker stop: arrive ${utcMinute(stop.arriveAt)}, depart ${utcMinute(stop.departAt)}`,
          `- Planned fuel cost: ${fmt(stop.bunkerFuelCostUsd)} USD; barge fee: ${fmt(stop.bargeFeeUsd)} USD`,
        ]
      : []),
  ];

  const supplierBody = [
    `Dear ${supplier.name},`,
    "",
    `Please confirm this bunker order for ${vessel.name} (IMO ${vessel.imo}) at ${port.name} (${port.unlocode}):`,
    `- Grade: ${grade}`,
    `- Quantity: ${fmt(order.qtyMt)} MT`,
    `- Price: ${fmt(order.pricePerMt)} ${order.currency} per MT`,
    `- Barge fee: ${fmt(order.bargeFee)} ${order.currency}`,
    `- Our purchase order: ${po} (reference ${order.reference})`,
    "",
    "Please reply with your confirmation of quantity, price and delivery window.",
    "",
    NOT_SENT,
  ].join("\n");

  const masterBody = [
    `Master of ${vessel.name} (IMO ${vessel.imo}),`,
    "",
    `Bunkering has been approved at ${port.name} (${port.unlocode}) with ${supplier.name}:`,
    `- Grade: ${grade}`,
    `- Quantity: ${fmt(order.qtyMt)} MT`,
    `- Purchase order: ${po}`,
    ...planned,
    "",
    "Please prepare for the delivery and confirm the barge arrival time to the desk.",
    "",
    NOT_SENT,
  ].join("\n");

  return [
    {
      recommendationId: input.recommendation.id,
      kind: "supplier_confirmation",
      to: supplierAddress(supplier.emailDomain),
      subject: `Bunker order ${po}: ${vessel.name} at ${port.name}`,
      body: supplierBody,
      status: "draft",
    },
    {
      recommendationId: input.recommendation.id,
      kind: "master_instruction",
      to: masterAddress(vessel.name),
      subject: `Bunkering at ${port.name}: ${fmt(order.qtyMt)} MT ${grade} (${po})`,
      body: masterBody,
      status: "draft",
    },
  ];
}

/**
 * The master's route-and-speed instruction for an approved voyage instruction. Its only numbers are
 * the approved option's speed, ETA and distance, and its bunker stop's times and quantity; it
 * names no IMO or voyage number.
 */
export function draftVoyageInstruction(input: VoyageInstructionDraftInput): DraftedMessageInput {
  const { vessel, destination, route, option } = input;
  const stop = input.stop ?? null;
  const body = [
    `Master of ${vessel.name},`,
    "",
    `The desk has approved this route and speed to ${destination}:`,
    stop
      ? `- Route: ${route.label} (plan ${route.candidateId})`
      : `- Route: ${route.label} (route ${route.candidateId})`,
    ...(stop
      ? [
          `- Call at ${stop.portName} for bunkers: arrive ${utcMinute(stop.arriveAt)}, ` +
            `depart ${utcMinute(stop.departAt)}, ${fmt(stop.qtyMt)} t ${stop.grade} from ${stop.supplierName}.`,
        ]
      : []),
    `- Speed: ${fmt(option.speedKn)} kn`,
    `- ETA at ${destination}: ${utcMinute(option.eta)}`,
    `- Distance: ${fmt(option.distanceNm)} nm`,
    "",
    "This is planning-grade advice from the desk's route and speed calculation over the latest " +
      "weather forecast and reported hazards. It does not replace your passage plan or your " +
      "judgement on the bridge.",
    "",
    "Please confirm receipt to the desk, and tell the desk if you cannot keep to it.",
    "",
    NOT_SENT,
  ].join("\n");
  return {
    recommendationId: input.recommendation.id,
    kind: "master_instruction",
    to: masterAddress(vessel.name),
    subject: stop
      ? `Route and speed: ${vessel.name} to ${destination}, bunkering at ${stop.portName}`
      : `Route and speed: ${vessel.name} to ${destination}`,
    body,
    status: "draft",
  };
}
