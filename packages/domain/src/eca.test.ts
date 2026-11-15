import { describe, expect, it } from "vitest";
import { gradeAt, inSulphurEca } from "./eca.js";

// Sources: MARPOL Annex VI Reg. 14 and Appendix VII. Mediterranean Sea SOx ECA: MEPC.361(79),
// adopted 16 Dec 2022, in force 1 May 2025 (bounded west by the meridian 5 deg 36' W, and from the
// Black Sea by the parallel 41 deg N). Baltic Sea, North Sea and English Channel areas: Reg. 14.3
// and Appendix VII (North Sea south of 62 deg N and east of 4 deg W; Channel east of 5 deg W and
// north of 48 deg 30' N). The rectangles here are planning-grade approximations of those lines.
describe("inSulphurEca", () => {
  it("is true for Marsaxlokk and Rotterdam", () => {
    expect(inSulphurEca({ lat: 35.83, lon: 14.54 })).toBe(true);
    expect(inSulphurEca({ lat: 51.95, lon: 4.14 })).toBe(true);
  });
  it("is true for the Alboran Sea and the strait east of 5 deg 36' W", () => {
    expect(inSulphurEca({ lat: 36.0, lon: -4.0 })).toBe(true);
    expect(inSulphurEca({ lat: 36.0, lon: -5.4 })).toBe(true);
  });
  it("is true for the Sea of Marmara (south of 41 deg N) and Gdansk in the Baltic", () => {
    expect(inSulphurEca({ lat: 40.7, lon: 28.0 })).toBe(true);
    expect(inSulphurEca({ lat: 54.5, lon: 18.7 })).toBe(true);
  });
  it("is false for the Gulf of Cadiz (west of 5 deg 36' W) and the Black Sea", () => {
    expect(inSulphurEca({ lat: 36.5, lon: -7.0 })).toBe(false);
    expect(inSulphurEca({ lat: 43.0, lon: 34.0 })).toBe(false);
  });
  it("is false for the Irish Sea (west of 4 deg W) and the Norwegian Sea (north of 62 deg N)", () => {
    expect(inSulphurEca({ lat: 53.5, lon: -5.0 })).toBe(false);
    expect(inSulphurEca({ lat: 64.0, lon: 5.0 })).toBe(false);
  });
  it("covers the North Sea (south of 62 deg N) and the Channel (east of 5 deg W)", () => {
    expect(inSulphurEca({ lat: 58.0, lon: 2.0 })).toBe(true);
    expect(inSulphurEca({ lat: 49.5, lon: -3.0 })).toBe(true);
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
