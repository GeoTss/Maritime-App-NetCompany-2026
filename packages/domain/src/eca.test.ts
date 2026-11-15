import { describe, expect, it } from "vitest";
import { gradeAt, inSulphurEca } from "./eca.js";

// Source for the zones: MARPOL Annex VI Reg. 14 and Appendix VII designate the Mediterranean Sea
// (SOx ECA, in force 1 May 2025) and the Baltic Sea, North Sea and English Channel. The boxes are
// planning-grade rectangles around those areas, not legal boundaries.
describe("inSulphurEca", () => {
  it("is true for Marsaxlokk and Rotterdam", () => {
    expect(inSulphurEca({ lat: 35.83, lon: 14.54 })).toBe(true);
    expect(inSulphurEca({ lat: 51.95, lon: 4.14 })).toBe(true);
  });
  it("is false for Brest and the Bay of Biscay", () => {
    expect(inSulphurEca({ lat: 48.38, lon: -4.49 })).toBe(false);
    expect(inSulphurEca({ lat: 44.5, lon: -3.0 })).toBe(false);
  });
  it("is false in the open Atlantic and the Red Sea", () => {
    expect(inSulphurEca({ lat: 30, lon: -30 })).toBe(false);
    expect(inSulphurEca({ lat: 20, lon: 38 })).toBe(false);
  });
});

describe("gradeAt", () => {
  it("is LSMGO inside, VLSFO outside", () => {
    expect(gradeAt({ lat: 35.83, lon: 14.54 })).toBe("LSMGO");
    expect(gradeAt({ lat: 48.38, lon: -4.49 })).toBe("VLSFO");
  });
});
