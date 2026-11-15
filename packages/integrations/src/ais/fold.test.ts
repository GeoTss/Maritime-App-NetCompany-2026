import { describe, expect, it } from "vitest";
import { position, staticData } from "./__helpers.js";
import { foldObservation, newFoldState, type TrafficObservation } from "./fold.js";
import { normaliseAisMessage } from "./normalise.js";

const obs = (raw: unknown) => normaliseAisMessage(raw) as TrafficObservation;
const AT = new Date("2026-11-15T10:00:00Z");

describe("foldObservation draught and course", () => {
  it("a static message after a position keeps the draught", () => {
    const s = newFoldState();
    foldObservation(s, obs(position(211000001, 1, 1, { Cog: 45 })), AT);
    foldObservation(s, obs(staticData(211000001, { MaximumStaticDraught: 12.3 })), AT);
    expect(s.rows.get("211000001")).toMatchObject({ draughtM: 12.3, cogDeg: 45 });
    // a later position and a later static without draught keep it
    foldObservation(s, obs(position(211000001, 1, 2, { Cog: 360 })), AT);
    foldObservation(s, obs(staticData(211000001)), AT);
    expect(s.rows.get("211000001")).toMatchObject({ draughtM: 12.3, cogDeg: null });
  });

  it("a static message before a position is held with its draught", () => {
    const s = newFoldState();
    foldObservation(s, obs(staticData(211000002, { MaximumStaticDraught: 8 })), AT);
    foldObservation(s, obs(position(211000002, 1, 1, { Cog: 10 })), AT);
    expect(s.rows.get("211000002")).toMatchObject({ draughtM: 8, cogDeg: 10 });
  });
});
