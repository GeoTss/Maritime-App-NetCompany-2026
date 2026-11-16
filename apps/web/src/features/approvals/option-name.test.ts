import type { Fact } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { hasOptionFact, optionName } from "./option-name";

const optionFact = (value: string, path = "bestOptionId"): Fact => ({
  id: "f_best",
  label: "Best option (lowest total cost, feasible)",
  value,
  unit: null,
  provenance: { source: "calculation", calculationId: 1, calculator: "planBunkers", path },
});
const names = {
  ports: [{ id: 3, unlocode: "MTMLA", name: "Marsaxlokk" }],
  suppliers: [
    { id: 1, name: "Kestrel Marine Fuels" },
    { id: 4, name: "Meridian Bunkering" },
    { id: 5, name: "Meridian Fuels" },
  ],
};

describe("optionName", () => {
  it("prefers the proposal's own facts: a labelled option fact", () => {
    const labelled: Fact = {
      ...optionFact("MTMLA-kestrel"),
      id: "f_cost",
      label: "MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): Total cost",
      value: 1,
    };
    const best = optionFact("MTMLA-kestrel");
    expect(optionName(best, [best, labelled], null)).toBe("Kestrel Marine Fuels, Marsaxlokk");
  });

  it("names a bunker option from the reference names only when the supplier is unambiguous", () => {
    const kestrel = optionFact("MTMLA-kestrel");
    expect(optionName(kestrel, [kestrel], names)).toBe("Kestrel Marine Fuels at Marsaxlokk");
    // Two suppliers start with "meridian": the port alone is named, never a guess.
    const meridian = optionFact("MTMLA-meridian");
    expect(optionName(meridian, [meridian], names)).toBe("at Marsaxlokk");
    const unknown = optionFact("XXABC-nobody");
    expect(optionName(unknown, [unknown], names)).toBeNull();
  });

  it("ignores facts that are not option ids, and values that are not strings", () => {
    const other = optionFact("MTMLA-kestrel", "options[0].supplier");
    expect(optionName(other, [other], names)).toBeNull();
    expect(hasOptionFact([other])).toBe(false);
    expect(hasOptionFact([optionFact("B", "bestCandidateId")])).toBe(true);
  });
});
