import { describe, expect, it } from "vitest";
import { position, staticData } from "./__helpers.js";
import { AIS_BOXES } from "./boxes.js";
import { normaliseAisMessage } from "./normalise.js";

describe("normaliseAisMessage", () => {
  it("maps a PositionReport and a ShipStaticData to the two observation kinds", () => {
    expect(normaliseAisMessage(position(211000001, 36.1, -5.4))).toEqual({
      kind: "position",
      mmsi: "211000001",
      name: "TEST ONE",
      lat: 36.1,
      lon: -5.4,
      sogKn: 0.1,
      cogDeg: 90,
      navStatus: "at anchor",
      ts: "2026-11-15T10:00:00.123Z",
    });
    expect(normaliseAisMessage(staticData(211000001))).toMatchObject({
      kind: "static",
      mmsi: "211000001",
      name: "STATIC NAME",
      shipType: "tanker",
      destination: "PIRAEUS",
    });
  });

  it("returns null for unusable messages and nulls out sentinel values", () => {
    expect(normaliseAisMessage({ MessageType: "Other", MetaData: {}, Message: {} })).toBeNull();
    expect(normaliseAisMessage(position(211000001, 91, 0))).toBeNull();
    expect(normaliseAisMessage(position(211000001, 0, 181))).toBeNull();
    expect(normaliseAisMessage({})).toBeNull();
    expect(normaliseAisMessage('{"Message')).toBeNull();
    const sentinel = normaliseAisMessage(position(211000001, 1, 1, { Sog: 102.3, Cog: 360 }));
    expect(sentinel).toMatchObject({ sogKn: null, cogDeg: null });
  });

  it("maps ship type ranges, status codes and empty names", () => {
    const type = (t: number) => normaliseAisMessage(staticData(211000001, { Type: t, Name: "  " }));
    expect(type(72)).toMatchObject({ shipType: "cargo" });
    expect(type(60)).toMatchObject({ shipType: "passenger" });
    expect(type(30)).toMatchObject({ shipType: "other" });
    const p = normaliseAisMessage(position(211000001, 1, 1, { NavigationalStatus: 5 }));
    expect(p).toMatchObject({ navStatus: "moored" });
    expect(type(72)).toMatchObject({ name: "STATIC NAME" }); // falls back to the metadata name
  });

  it("has the five demo boxes with latitude first", () => {
    expect(AIS_BOXES.demo).toHaveLength(5);
    expect(AIS_BOXES.demo?.[0]).toEqual([
      [35.7, -6.0],
      [36.4, -5.0],
    ]);
  });
});
