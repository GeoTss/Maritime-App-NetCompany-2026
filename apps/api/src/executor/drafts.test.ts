import { describe, expect, it } from "vitest";
import { type DraftInput, draftMessages } from "./drafts.js";

const input: DraftInput = {
  recommendation: { id: 7 },
  order: {
    reference: "rec-7-1794643200",
    poNumber: "PO-000001",
    grade: "LSMGO",
    qtyMt: 612.5,
    pricePerMt: 801,
    currency: "USD",
    bargeFee: 1200,
  },
  supplier: { name: "Kestrel Marine Fuels", emailDomain: "kestrel.example" },
  vessel: { name: "Aegean Pioneer", imo: "9000001" },
  port: { name: "Marsaxlokk", unlocode: "MTMLA" },
  option: { optionId: "MTMLA-kestrel", totalCostUsd: 491_362.5, effectivePriceUsdPerMt: 802.23 },
};

describe("draftMessages", () => {
  const [supplier, master] = draftMessages(input);

  it("makes a supplier confirmation and a master instruction, as drafts", () => {
    expect(supplier).toMatchObject({
      recommendationId: 7,
      kind: "supplier_confirmation",
      to: "bunkers@kestrel.example",
      status: "draft",
    });
    expect(master).toMatchObject({
      kind: "master_instruction",
      to: "master.aegean-pioneer@fleet.pharos.example",
      status: "draft",
    });
  });

  it("takes every number from the order and the plan option", () => {
    expect(supplier?.body).toContain("612.5 MT");
    expect(supplier?.body).toContain("801 USD per MT");
    expect(supplier?.body).toContain("1,200 USD");
    expect(supplier?.body).toContain("PO-000001");
    expect(master?.body).toContain("491,362.5 USD");
    expect(master?.body).toContain("802.23 USD per MT");
  });

  it("says it is a draft that was not sent, and is deterministic", () => {
    for (const d of [supplier, master]) expect(d?.body).toContain("Pharos has not sent it");
    expect(draftMessages(input)).toEqual([supplier, master]);
  });
});
