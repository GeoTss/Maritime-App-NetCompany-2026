import { describe, expect, it } from "vitest";
import { TIMELINE_GROUP, VoyageEvent, VoyageTimeline } from "./timeline.js";

const at = "2026-11-14T08:00:00.000Z";
const where = { at, position: { lat: 36, lon: 14 }, alongNm: 120 };

describe("VoyageEvent", () => {
  it("parses a port arrival with its actions", () => {
    const e = VoyageEvent.parse({
      kind: "port_arrival",
      ...where,
      stopIndex: 0,
      unlocode: "MTMAR",
      actions: ["bunkering", "provisions", "sewage", "port_dues"],
    });
    expect(e.kind).toBe("port_arrival");
  });

  it("rejects an unknown field and an unknown action", () => {
    expect(() => VoyageEvent.parse({ kind: "departure", ...where, extra: 1 })).toThrow();
    expect(() =>
      VoyageEvent.parse({
        kind: "port_arrival",
        ...where,
        stopIndex: 0,
        unlocode: "MTMAR",
        actions: ["refuel"],
      }),
    ).toThrow();
  });

  it("every kind has a group", () => {
    const kinds = VoyageEvent.options.map((o) => o.shape.kind.value);
    expect(kinds.sort()).toEqual(Object.keys(TIMELINE_GROUP).sort());
  });

  it("a timeline carries events and facts", () => {
    const t = VoyageTimeline.parse({
      events: [
        { kind: "eca_entry", ...where, atDeparture: true, changeoverStartAt: null, grade: "LSMGO" },
        { kind: "sewage_window_open", ...where, windowHours: 3.5 },
        {
          kind: "storm_passed",
          ...where,
          stormId: "storm:34,20",
          clearanceNm: -5,
          maxWaveHeightM: 8.5,
          synthetic: true,
        },
      ],
      facts: [],
    });
    expect(t.events).toHaveLength(3);
  });
});
