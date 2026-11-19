import { describe, expect, it } from "vitest";
import { recordedLiveData } from "./recorded.js";

const anchor = new Date("2026-11-14T08:00:00Z");

describe("the synthetic demo storm", () => {
  it("is off by default: the recorded grid is the real forecast", () => {
    const { weather } = recordedLiveData({ anchor, ports: [] });
    expect(weather.points.some((p) => p.synthetic)).toBe(false);
  });

  it("when on, holds 8.5 m at its two points at every step, labelled synthetic", () => {
    const { weather } = recordedLiveData({ anchor, ports: [], syntheticStorm: true });
    const storm = weather.points.filter((p) => p.synthetic);
    expect(storm.map((p) => [p.lat, p.lon])).toEqual([
      [34, 20],
      [34, 22],
    ]);
    expect(storm.every((p) => p.waveHeightM.every((h) => h === 8.5))).toBe(true);
  });
});
