import { describe, expect, it } from "vitest";
import { etaAfter, greatCircleNm, pointAlongPolyline, polylineNm } from "./geo.js";

describe("greatCircleNm", () => {
  it("1 degree of latitude along a meridian = 2*pi*3440.065/360 = 60.0405 nm", () => {
    expect(greatCircleNm({ lat: 10, lon: 20 }, { lat: 11, lon: 20 })).toBeCloseTo(60.04, 1);
  });
  it("same point is zero", () => {
    expect(greatCircleNm({ lat: 37.9, lon: 23.6 }, { lat: 37.9, lon: 23.6 })).toBe(0);
  });
  it("is symmetric", () => {
    const a = { lat: 37.9, lon: 23.6 };
    const b = { lat: 51.9, lon: 4.1 };
    expect(greatCircleNm(a, b)).toBeCloseTo(greatCircleNm(b, a), 9);
  });
});

describe("polylineNm / pointAlongPolyline", () => {
  const pts = [
    { lat: 0, lon: 0 },
    { lat: 1, lon: 0 },
    { lat: 2, lon: 0 },
  ];
  it("polylineNm is the sum of segment distances", () => {
    expect(polylineNm(pts)).toBeCloseTo(
      greatCircleNm(pts[0]!, pts[1]!) + greatCircleNm(pts[1]!, pts[2]!),
      9,
    );
    expect(polylineNm([])).toBe(0);
    expect(polylineNm([pts[0]!])).toBe(0);
  });
  it("clamps to the ends", () => {
    expect(pointAlongPolyline(pts, 0)).toEqual(pts[0]);
    expect(pointAlongPolyline(pts, -5)).toEqual(pts[0]);
    expect(pointAlongPolyline(pts, 1e6)).toEqual(pts[2]);
  });
  it("halfway along a meridian segment is the mid latitude", () => {
    const p = pointAlongPolyline([pts[0]!, pts[1]!], greatCircleNm(pts[0]!, pts[1]!) / 2);
    expect(p.lat).toBeCloseTo(0.5, 9);
    expect(p.lon).toBeCloseTo(0, 9);
  });
  it("crosses into the second segment", () => {
    const p = pointAlongPolyline(pts, polylineNm(pts) * 0.75);
    expect(p.lat).toBeCloseTo(1.5, 9);
  });
  it("single point and empty input", () => {
    expect(pointAlongPolyline([pts[1]!], 10)).toEqual(pts[1]);
    expect(() => pointAlongPolyline([], 1)).toThrow(RangeError);
  });
});

describe("etaAfter", () => {
  it("300 nm at 12.5 kn = 24 h", () => {
    expect(etaAfter(new Date("2026-11-14T00:00:00Z"), 300, 12.5).toISOString()).toBe(
      "2026-11-15T00:00:00.000Z",
    );
  });
  it("zero distance returns the start time (new instance)", () => {
    const s = new Date("2026-11-14T00:00:00Z");
    const e = etaAfter(s, 0, 10);
    expect(e.getTime()).toBe(s.getTime());
    expect(e).not.toBe(s);
  });
  it("rejects bad speed or distance", () => {
    const s = new Date("2026-11-14T00:00:00Z");
    expect(() => etaAfter(s, 300, 0)).toThrow(RangeError);
    expect(() => etaAfter(s, 300, -1)).toThrow(RangeError);
    expect(() => etaAfter(s, -1, 10)).toThrow(RangeError);
  });
});
