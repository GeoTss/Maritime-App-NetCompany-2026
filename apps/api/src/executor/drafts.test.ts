import { describe, expect, it } from "vitest";
import {
  type DraftInput,
  draftMessages,
  draftVoyageInstruction,
  type VoyageInstructionDraftInput,
} from "./drafts.js";

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

describe("draftVoyageInstruction", () => {
  const instruction: VoyageInstructionDraftInput = {
    recommendation: { id: 9 },
    vessel: { name: "MV Aegean Pioneer" },
    destination: "Rotterdam",
    route: { candidateId: "B", label: "Shortest sea route" },
    option: { speedKn: 10.5, eta: "2026-11-27T13:42:17.123Z", distanceNm: 3128.8287 },
  };
  const draft = draftVoyageInstruction(instruction);

  it("is one master instruction draft, addressed to the master", () => {
    expect(draft).toMatchObject({
      recommendationId: 9,
      kind: "master_instruction",
      to: "master.mv-aegean-pioneer@fleet.pharos.example",
      subject: "Route and speed: MV Aegean Pioneer to Rotterdam",
      status: "draft",
    });
  });

  it("carries the route, speed, ETA and distance of the approved option, and only those numbers", () => {
    expect(draft.body).toContain("Shortest sea route (route B)");
    expect(draft.body).toContain("10.5 kn");
    expect(draft.body).toContain("2026-11-27 13:42 UTC");
    expect(draft.body).toContain("3,128.83 nm");
    const rest = draft.body
      .replace("10.5", "")
      .replace("2026-11-27 13:42", "")
      .replace("3,128.83", "");
    expect(rest).not.toMatch(/\d/);
  });

  it("says it is planning-grade advice and a draft that was not sent, and is deterministic", () => {
    expect(draft.body).toMatch(/planning-grade advice/);
    expect(draft.body).toContain("Pharos has not sent it");
    expect(draftVoyageInstruction(instruction)).toEqual(draft);
  });
});
