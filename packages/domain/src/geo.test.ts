import type { LatLon } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { bearingDeg, etaAfter, greatCircleNm, pointAlongPolyline, polylineNm } from "./geo.js";

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
  const p0: LatLon = { lat: 0, lon: 0 };
  const p1: LatLon = { lat: 1, lon: 0 };
  const p2: LatLon = { lat: 2, lon: 0 };
  const pts = [p0, p1, p2];
  it("polylineNm is the sum of segment distances", () => {
    expect(polylineNm(pts)).toBeCloseTo(greatCircleNm(p0, p1) + greatCircleNm(p1, p2), 9);
    expect(polylineNm([])).toBe(0);
    expect(polylineNm([p0])).toBe(0);
  });
  it("clamps to the ends", () => {
    expect(pointAlongPolyline(pts, 0)).toEqual(p0);
    expect(pointAlongPolyline(pts, -5)).toEqual(p0);
    expect(pointAlongPolyline(pts, 1e6)).toEqual(p2);
  });
  it("halfway along a meridian segment is the mid latitude", () => {
    const p = pointAlongPolyline([p0, p1], greatCircleNm(p0, p1) / 2);
    expect(p.lat).toBeCloseTo(0.5, 9);
    expect(p.lon).toBeCloseTo(0, 9);
  });
  it("crosses into the second segment", () => {
    const p = pointAlongPolyline(pts, polylineNm(pts) * 0.75);
    expect(p.lat).toBeCloseTo(1.5, 9);
  });
  it("single point and empty input", () => {
    expect(pointAlongPolyline([p1], 10)).toEqual(p1);
    expect(() => pointAlongPolyline([], 1)).toThrow(RangeError);
  });
  it("NaN distance along the polyline throws RangeError", () => {
    expect(() => pointAlongPolyline(pts, Number.NaN)).toThrow(RangeError);
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
  it("rounds to the nearest millisecond (1 nm at 7 kn = 514 285.714 ms -> 514 286)", () => {
    const s = new Date("2026-11-14T00:00:00Z");
    expect(etaAfter(s, 1, 7).getTime() - s.getTime()).toBe(514_286);
  });
  it("rejects an invalid start date or non-finite distance", () => {
    const s = new Date("2026-11-14T00:00:00Z");
    expect(() => etaAfter(new Date(Number.NaN), 300, 10)).toThrow(RangeError);
    expect(() => etaAfter(s, Number.POSITIVE_INFINITY, 10)).toThrow(RangeError);
    expect(() => etaAfter(s, Number.NaN, 10)).toThrow(RangeError);
  });
});

describe("bearingDeg", () => {
  const o = { lat: 0, lon: 0 };
  it("north, east, south and west from the origin are 0, 90, 180 and 270", () => {
    expect(bearingDeg(o, { lat: 1, lon: 0 })).toBeCloseTo(0, 9);
    expect(bearingDeg(o, { lat: 0, lon: 1 })).toBeCloseTo(90, 9);
    expect(bearingDeg(o, { lat: -1, lon: 0 })).toBeCloseTo(180, 9);
    expect(bearingDeg(o, { lat: 0, lon: -1 })).toBeCloseTo(270, 9);
  });
  it("is always in [0, 360)", () => {
    const b = bearingDeg({ lat: 10, lon: 10 }, { lat: 9, lon: 9 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
    expect(b).toBeGreaterThan(180);
  });
});
