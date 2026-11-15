/**
 * Drafted messages for a human to send after an approval: a supplier confirmation and a master
 * instruction. Pure templates, no model call. Every number is the stored calculation's option or
 * the stored order; nothing here is ever sent (Pharos has no outbound channel).
 *
 * Addresses are deterministic placeholders (the seed has no contact address): `bunkers@` the
 * supplier's email domain, and `master.<vessel-slug>@fleet.pharos.example`.
 */
import type { BunkerOptionResult, DraftedMessage, FuelGrade } from "@pharos/shared";

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
  /** The plan option the order was written from. */
  option: Pick<BunkerOptionResult, "optionId" | "totalCostUsd" | "effectivePriceUsdPerMt">;
}

export type DraftedMessageInput = Omit<DraftedMessage, "id" | "createdAt">;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const supplierAddress = (emailDomain: string) => `bunkers@${emailDomain}`;
export const masterAddress = (vesselName: string) =>
  `master.${slug(vesselName)}@fleet.pharos.example`;

export function draftMessages(input: DraftInput): DraftedMessageInput[] {
  const { order, supplier, vessel, port, option } = input;
  const po = order.poNumber ?? "(number pending)";
  const grade = order.grade;
  const notSent =
    "This is a draft prepared by Pharos for a person to review and send. Pharos has not sent it.";

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
    notSent,
  ].join("\n");

  const masterBody = [
    `Master of ${vessel.name} (IMO ${vessel.imo}),`,
    "",
    `Bunkering has been approved at ${port.name} (${port.unlocode}) with ${supplier.name}:`,
    `- Grade: ${grade}`,
    `- Quantity: ${fmt(order.qtyMt)} MT`,
    `- Purchase order: ${po}`,
    `- Planned total delivered cost: ${fmt(option.totalCostUsd)} USD (${fmt(option.effectivePriceUsdPerMt)} USD per MT effective)`,
    "",
    "Please prepare for the delivery and confirm the barge arrival time to the desk.",
    "",
    notSent,
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
