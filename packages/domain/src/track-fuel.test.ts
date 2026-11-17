import type {
  ConsumptionCurve,
  LatLon,
  RouteSpeedInput,
  TrackFuelInput,
  WeatherGrid,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { stopTimeline } from "./bunker-stop.js";
import { BUNKERING_MAX_WAVE_M } from "./constants.js";
import { dailyConsumptionMt, portStayFuelMt } from "./consumption.js";
import { greatCircleNm, polylineNm } from "./geo.js";
import { evaluateRoute } from "./route-optimiser.js";
import { projectFuelAlongTrack } from "./track-fuel.js";

const curve: ConsumptionCurve = {
  refSpeedKn: 13,
  refMtPerDay: 30,
  auxMtPerDay: 2.5,
  minSpeedKn: 9,
  maxSpeedKn: 14.5,
};
const START = "2026-11-14T08:00:00.000Z";
const HOUR_MS = 3_600_000;
const daily = (kn: number) => dailyConsumptionMt(curve, kn);
const ll = (lat: number, lon: number): LatLon => ({ lat, lon });

const input = (over: Partial<TrackFuelInput> = {}): TrackFuelInput => ({
  startAt: START,
  points: [ll(20, -30), ll(20, -28)],
  speedKn: 12,
  stepNm: 20,
  curve,
  weather: null,
  robMt: { LSMGO: 50, VLSFO: 300, HSFO: 0 },
  safetyMarginDays: 2,
  stop: null,
  probesNm: [],
  ...over,
});

// An LSMGO-only track inside the Mediterranean ECA.
const MED = [ll(35, 15), ll(35, 25)];
const MED3 = [ll(35, 15), ll(35, 20), ll(35, 25)];

describe("projectFuelAlongTrack", () => {
  it("burns the daily rate for the track's hours in the grade of each sub-step", () => {
    const r = projectFuelAlongTrack(input());
    const d = greatCircleNm(ll(20, -30), ll(20, -28));
    expect(r.grades.VLSFO.neededMt).toBeCloseTo((daily(12) * (d / 12)) / 24, 9);
    expect(r.grades.LSMGO.neededMt).toBe(0);
    expect(r.grades.LSMGO.marginMt).toBe(0);
    expect(r.grades.VLSFO.marginMt).toBeCloseTo(2 * daily(12), 9);
    expect(r.breakpoints.map((b) => b.kind)).toEqual(["start", "end"]);
  });

  it("switches to LSMGO inside the emission-control area", () => {
    const r = projectFuelAlongTrack(input({ points: [ll(36, -8), ll(36, -3)] }));
    const changes = r.breakpoints.filter((b) => b.kind === "grade_change");
    expect(changes).toHaveLength(1);
    const boundary = greatCircleNm(ll(36, -8), ll(36, -5.6));
    expect(Math.abs((changes[0]?.nm ?? 0) - boundary)).toBeLessThanOrEqual(20);
    expect(r.grades.LSMGO.neededMt).toBeGreaterThan(0);
  });

  it("reports where a grade first drops below its margin", () => {
    const probe = projectFuelAlongTrack(input({ points: MED }));
    const { neededMt, marginMt } = probe.grades.LSMGO;
    const r = projectFuelAlongTrack(
      input({ points: MED, robMt: { LSMGO: neededMt * 0.5 + marginMt, VLSFO: 0, HSFO: 0 } }),
    );
    const d = polylineNm(MED);
    expect(Math.abs((r.grades.LSMGO.belowMarginAt?.nm ?? -1) - d / 2)).toBeLessThanOrEqual(20);
    expect(r.keepsMargins).toBe(false);
    expect(r.grades.LSMGO.runsDryAt).toBeNull();
    expect(r.grades.LSMGO.shortfallMt).toBeCloseTo(neededMt * 0.5, 6);
  });

  it("reports where a grade runs dry", () => {
    const probe = projectFuelAlongTrack(input({ points: MED }));
    const r = projectFuelAlongTrack(
      input({
        points: MED,
        robMt: { LSMGO: probe.grades.LSMGO.neededMt * 0.25, VLSFO: 0, HSFO: 0 },
      }),
    );
    const d = polylineNm(MED);
    expect(Math.abs((r.grades.LSMGO.runsDryAt?.nm ?? -1) - d / 4)).toBeLessThanOrEqual(20);
    expect(r.grades.LSMGO.minRobMt).toBeLessThan(0);
  });

  it("adds the bunkered quantity at the stop and burns the stay in the port grade", () => {
    const stop = {
      pointIndex: 1,
      position: ll(35, 20),
      waitingHours: 4,
      bunkeringHours: 6,
      stayGrade: "LSMGO" as const,
      grade: "LSMGO" as const,
      qtyMt: 300,
    };
    const rob = { LSMGO: 200, VLSFO: 0, HSFO: 0 };
    const plain = projectFuelAlongTrack(input({ points: MED3, robMt: rob }));
    const r = projectFuelAlongTrack(input({ points: MED3, robMt: rob, stop }));
    const arrival = r.breakpoints.find((b) => b.kind === "stop_arrival");
    const departure = r.breakpoints.find((b) => b.kind === "stop_departure");
    expect(arrival?.nm).toBeCloseTo(greatCircleNm(ll(35, 15), ll(35, 20)), 6);
    expect(departure?.robMt.LSMGO).toBeCloseTo(
      (arrival?.robMt.LSMGO ?? 0) - portStayFuelMt(curve, 10) + 300,
      9,
    );
    const endOf = (x: typeof r) => Date.parse(x.breakpoints.at(-1)?.at ?? "");
    expect(endOf(r) - endOf(plain)).toBe(10 * HOUR_MS);
    // After the stop the projection carries the bunkered fuel to the end.
    expect(r.breakpoints.at(-1)?.robMt.LSMGO).toBeCloseTo(
      (plain.breakpoints.at(-1)?.robMt.LSMGO ?? 0) - portStayFuelMt(curve, 10) + 300,
      9,
    );
    expect(r.grades.LSMGO.neededMt).toBeCloseTo(
      plain.grades.LSMGO.neededMt + portStayFuelMt(curve, 10),
      9,
    );
  });

  it("checks the margin at stop arrival", () => {
    const first = projectFuelAlongTrack(input({ points: [ll(35, 15), ll(35, 20)] }));
    const { neededMt, marginMt } = first.grades.LSMGO;
    const stop = {
      pointIndex: 1,
      position: ll(35, 20),
      waitingHours: 0,
      bunkeringHours: 6,
      stayGrade: "LSMGO" as const,
      grade: "LSMGO" as const,
      qtyMt: 1000,
    };
    // Just under the margin on arrival at the stop, and far above it after bunkering.
    const r = projectFuelAlongTrack(
      input({ points: MED3, stop, robMt: { LSMGO: neededMt + marginMt - 0.5, VLSFO: 0, HSFO: 0 } }),
    );
    expect(r.keepsMargins).toBe(false);
    expect(r.grades.LSMGO.belowMarginAt?.nm).toBeCloseTo(greatCircleNm(ll(35, 15), ll(35, 20)), 6);
  });

  it("returns fuel on board at requested distances", () => {
    const d = polylineNm(MED);
    const r = projectFuelAlongTrack(
      input({ points: MED, robMt: { LSMGO: 500, VLSFO: 0, HSFO: 0 }, probesNm: [0, d / 2] }),
    );
    expect(r.probes[0]?.robMt.LSMGO).toBe(500);
    const mid = r.probes[1]?.robMt.LSMGO ?? 0;
    expect(mid).toBeLessThan(500);
    expect(mid).toBeGreaterThan(r.breakpoints.at(-1)?.robMt.LSMGO ?? 0);
    expect(r.probes[1]?.nm).toBeCloseTo(d / 2, 6);
  });

  it("agrees with the route optimiser", () => {
    const points = [ll(36, -9), ll(36, -4), ll(38, 2)];
    const weather: WeatherGrid = {
      startAt: START,
      stepHours: 3,
      points: [-8, -6, -4, -2, 0, 2].map((lon) => ({
        lat: 36.5,
        lon,
        waveHeightM: [2.5, 3, 1.5, 2, 2.5, 3, 1, 2, 2.5, 3, 1.5, 2],
        waveDirDeg: Array(12).fill(270),
        windSpeedKn: Array(12).fill(20),
        windDirDeg: Array(12).fill(260),
        currentSpeedKn: Array(12).fill(0.5),
        currentDirDeg: Array(12).fill(90),
      })),
    };
    const fuel = projectFuelAlongTrack(input({ points, speedKn: 11, weather }));
    const routeInput: RouteSpeedInput = {
      startAt: START,
      candidates: [{ id: "A", label: "A", points }],
      baseline: { candidateId: "A", speedKn: 11 },
      curve,
      speedStepKn: 0.5,
      stepNm: 20,
      arriveBy: null,
      notBefore: null,
      dailyCostUsd: 0,
      fuelPriceUsdPerMt: { LSMGO: 0, VLSFO: 0, HSFO: 0 },
      etsCoverage: 0,
      market: { euaPriceEur: 0, eurUsd: 1, year: 2026 },
      weather,
      hazards: [],
      fuel: null,
      stops: [],
    };
    const route = evaluateRoute(routeInput, { id: "A", label: "A", points }, 11);
    expect(fuel.grades.LSMGO.neededMt).toBeCloseTo(route.fuelMt.LSMGO, 9);
    expect(fuel.grades.VLSFO.neededMt).toBeCloseTo(route.fuelMt.VLSFO, 9);
    expect(route.fuelMt.LSMGO).toBeGreaterThan(0);
    expect(route.fuelMt.VLSFO).toBeGreaterThan(0);
    expect(Date.parse(fuel.breakpoints.at(-1)?.at ?? "")).toBe(Date.parse(route.eta));
  });

  it("stop stay includes the weather delay", () => {
    const stop = {
      pointIndex: 1,
      position: ll(35, 20),
      waitingHours: 4,
      bunkeringHours: 6,
      stayGrade: "LSMGO" as const,
      grade: "LSMGO" as const,
      qtyMt: 300,
    };
    const rob = { LSMGO: 200, VLSFO: 0, HSFO: 0 };
    const plain = projectFuelAlongTrack(input({ points: MED3, robMt: rob }));
    const arriveMs = Date.parse(START) + (greatCircleNm(ll(35, 15), ll(35, 20)) / 12) * HOUR_MS;
    // Waves above the limit until 6 h after the vessel is ready to bunker, then workable.
    const steps = 40;
    const readyStep = Math.round((arriveMs + 4 * HOUR_MS - Date.parse(START)) / (3 * HOUR_MS));
    const waveHeightM = Array.from({ length: steps }, (_, k) =>
      k < readyStep + 2 ? BUNKERING_MAX_WAVE_M + 1 : 1,
    );
    const weather: WeatherGrid = {
      startAt: START,
      stepHours: 3,
      points: [
        {
          lat: 35,
          lon: 20,
          waveHeightM,
          waveDirDeg: Array(steps).fill(0),
          windSpeedKn: Array(steps).fill(0),
          windDirDeg: Array(steps).fill(0),
          currentSpeedKn: Array(steps).fill(0),
          currentDirDeg: Array(steps).fill(0),
        },
      ],
    };
    const r = projectFuelAlongTrack(input({ points: MED3, robMt: rob, stop, weather }));
    const arrival = r.breakpoints.find((b) => b.kind === "stop_arrival");
    const departure = r.breakpoints.find((b) => b.kind === "stop_departure");
    const expected = stopTimeline({
      arriveAt: new Date(arrival?.at ?? ""),
      position: stop.position,
      waitingHours: 4,
      bunkeringHours: 6,
      weather,
    });
    expect(expected.weatherDelayHours).toBeGreaterThan(0);
    expect(
      Math.abs(Date.parse(departure?.at ?? "") - Date.parse(expected.departAt)),
    ).toBeLessThanOrEqual(1);
    const stayHours = 4 + 6 + expected.weatherDelayHours;
    expect(departure?.robMt.LSMGO).toBeCloseTo(
      (arrival?.robMt.LSMGO ?? 0) - portStayFuelMt(curve, stayHours) + 300,
      6,
    );
    expect(plain.breakpoints.some((b) => b.kind === "stop_arrival")).toBe(false);
  });
});
