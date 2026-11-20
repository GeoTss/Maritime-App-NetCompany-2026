import type {
  RouteCandidate,
  RouteSpeedInput,
  SecurityArea,
  SecurityQuoteCandidate,
} from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { areaSpansOfSteps } from "./areas.js";
import { optimiseRouteSpeed } from "./route-optimiser.js";
import { securityPlan } from "./security.js";
import { subSteps, walkSteps } from "./track.js";

const START = "2026-11-14T08:00:00.000Z";
const box = (minLon: number, maxLon: number, minLat = -1, maxLat = 1) => ({
  minLat,
  maxLat,
  minLon,
  maxLon,
});
const area = (
  id: string,
  policy: SecurityArea["policy"],
  b: ReturnType<typeof box>,
): SecurityArea => ({
  id,
  name: id,
  level: "SUBSTANTIAL",
  policy,
  boxes: [b],
  asOf: "2026-11-09",
  source: "test",
  note: "test",
});
const GUARDS = area("guards", "guards", box(44, 48));
const PREMIUM = area("premium", "premium", box(50, 52));
const quote = (
  id: number,
  embarkLon: number,
  disembarkLon: number,
  over: Partial<SecurityQuoteCandidate> = {},
): SecurityQuoteCandidate => ({
  quoteId: id,
  providerId: id,
  embark: { portId: 100 + id, position: { lat: 0.5, lon: embarkLon } },
  disembark: { portId: 200 + id, position: { lat: 0.5, lon: disembarkLon } },
  teamSize: 4,
  dayRateUsd: 1000,
  fixedFeesUsd: 5000,
  minDays: 3,
  validUntil: null,
  ...over,
});
const line = [
  { lat: 0, lon: 40 },
  { lat: 0, lon: 60 },
];
const walked = (pts = line, kn = 10) =>
  walkSteps(subSteps(pts, 20).steps, new Date(START), kn, null);
const plan = (quotes: SecurityQuoteCandidate[], areas = [GUARDS, PREMIUM], pts = line) =>
  securityPlan({
    steps: walked(pts),
    areas,
    quotes,
    hullValueUsd: 45_000_000,
    canal: null,
  });

describe("areaSpansOfSteps", () => {
  it("gives where a track enters and leaves each area, and the hours inside", () => {
    const spans = areaSpansOfSteps(walked(), [{ id: "guards", boxes: GUARDS.boxes }]);
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s?.enterNm).toBeGreaterThan(200);
    expect((s?.exitNm ?? 0) - (s?.enterNm ?? 0)).toBeGreaterThan(200);
    expect(s?.hoursInside).toBeCloseTo(((s?.exitNm ?? 0) - (s?.enterNm ?? 0)) / 10, 6);
  });
});

describe("securityPlan", () => {
  it("edge crossing still needs a team, paid from embark to disembark, not by the miles", () => {
    const edge = area("edge", "guards", box(44, 48, 0, 2));
    const r = plan([quote(1, 41, 49)], [edge]);
    expect(r.result.needsTeam).toBe(true);
    expect(r.result.quoteId).toBe(1);
    expect(r.reasons).toEqual([]);
  });

  it("team days from embark to disembark, at least the quote's minimum", () => {
    const short = plan([quote(1, 41, 49)]);
    // 41°E → 49°E on the equator is about 480 nm: 48 h at 10 kn → 2 days, the minimum is 3.
    expect(short.result.teamDays).toBe(3);
    const team = short.result.costLines.find((l) => l.kind === "security_team");
    expect(team?.usd).toBe(3 * 1000 + 5000);
    const long = plan([quote(1, 41, 59, { minDays: 0 })]);
    expect(long.result.teamDays).toBe(Math.ceil((18 * 60) / 10 / 24));
  });

  it("quote must bracket the areas: one that disembarks inside a guarded area does not cover", () => {
    const r = plan([quote(1, 41, 46)]);
    expect(r.result.quoteId).toBeNull();
    expect(r.reasons).toContain("security_unavailable");
  });

  it("charges the premium share of the hull value for a premium area, and an avoid area blocks", () => {
    const r = plan([quote(1, 41, 49)]);
    expect(r.result.costLines.find((l) => l.kind === "war_risk_premium")?.usd).toBe(
      0.005 * 45_000_000,
    );
    const blocked = plan([quote(1, 41, 49)], [area("no", "avoid", box(54, 56))]);
    expect(blocked.reasons).toContain("avoid_area");
  });
});

describe("security in the optimiser", () => {
  const via = (id: string, lat: number): RouteCandidate => ({
    id,
    label: id,
    points: [
      { lat: 0, lon: 40 },
      { lat, lon: 46 },
      { lat: 0, lon: 53 },
    ],
  });
  const input = (quotes: SecurityQuoteCandidate[]): RouteSpeedInput => ({
    startAt: START,
    candidates: [via("A", 0), via("B", 6)],
    baseline: { candidateId: "A", speedKn: 12 },
    curve: { refSpeedKn: 13, refMtPerDay: 30, auxMtPerDay: 2.5, minSpeedKn: 9, maxSpeedKn: 14.5 },
    speedStepKn: 0.5,
    stepNm: 20,
    arriveBy: null,
    notBefore: null,
    dailyCostUsd: 16_000,
    fuelPriceUsdPerMt: { LSMGO: 820, VLSFO: 610, HSFO: 480 },
    etsCoverage: 0,
    market: { euaPriceEur: 75, eurUsd: 1.08, year: 2026 },
    weather: null,
    hazards: [],
    fuel: null,
    stops: [],
    security: { areas: [GUARDS], quotes, hullValueUsd: 45_000_000, canal: null },
  });

  it("no quote, the route round the guarded area wins", () => {
    const r = optimiseRouteSpeed(input([]));
    expect(r.options.find((o) => o.candidateId === "A")?.reasons).toContain("security_unavailable");
    expect(r.bestCandidateId).toBe("B");
  });

  it("with a covering quote, the team's cost is in the option's total", () => {
    const r = optimiseRouteSpeed(input([quote(1, 41, 50)]));
    const a = r.options.find((o) => o.candidateId === "A");
    expect(a?.security?.quoteId).toBe(1);
    expect(a?.totalCostUsd).toBeGreaterThan((a?.fuelCostUsd ?? 0) + (a?.timeCostUsd ?? 0));
  });
});
