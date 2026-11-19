import { readFileSync } from "node:fs";
import {
  etaAfter,
  etsCoverage,
  fuelBetween,
  isValidImo,
  planBunkers,
  polylineNm,
  voyageLoad,
} from "@pharos/domain";
import { describe, expect, it } from "vitest";
import { currentPlanFuel } from "../current-plan.js";
import { buildRoutes, ROUTES_FILE, serializeRoutes } from "./build-routes.js";
import { buildDemoBunkerPlanInput, demoVoyageState, voyageState } from "./demo-plan.js";
import { DEMO_SCENARIO } from "./scenario.js";
import { World } from "./types.js";
import { generateWorld, ROUTES, requiredGradeFor } from "./world.js";

const SEED = 20261114;
const ANCHOR = new Date("2026-11-14T08:00:00Z");
const world = generateWorld({ seed: SEED, anchor: ANCHOR });
const FUEL = ["LSMGO", "VLSFO", "HSFO"] as const;

function collectDates(v: unknown, out: number[] = []): number[] {
  if (v instanceof Date) out.push(v.getTime());
  else if (Array.isArray(v)) for (const x of v) collectDates(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectDates(x, out);
  return out;
}
function stripDates(v: unknown): unknown {
  if (v instanceof Date) return "<date>";
  if (Array.isArray(v)) return v.map(stripDates);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripDates(x)]));
  return v;
}

describe("synthetic world", () => {
  it("world is deterministic", () => {
    const again = generateWorld({ seed: SEED, anchor: new Date(ANCHOR.getTime()) });
    expect(JSON.stringify(again)).toBe(JSON.stringify(world));
  });

  it("world is time-shift invariant", () => {
    const shifted = new Date("2026-03-29T01:30:00.123Z");
    const delta = shifted.getTime() - ANCHOR.getTime();
    const other = generateWorld({ seed: SEED, anchor: shifted });
    const a = collectDates(world);
    const b = collectDates(other);
    expect(b.length).toBe(a.length);
    expect(b.map((t, i) => t - (a[i] ?? 0))).toEqual(b.map(() => delta));
    expect(stripDates(other)).toEqual(stripDates(world));
  });

  it("every row parses with its shared schema", () => {
    expect(() => World.parse(world)).not.toThrow();
  });

  it("foreign keys resolve", () => {
    const ids = (rows: { id: number }[]) => new Set(rows.map((r) => r.id));
    const tables: Record<string, Set<number>> = {
      port: ids(world.ports),
      supplier: ids(world.suppliers),
      vessel: ids(world.vessels),
      voyage: ids(world.voyages),
      requirement: ids(world.bunkerRequirements),
      quote: ids(world.quotes),
      order: ids(world.purchaseOrders),
    };
    const refs: Record<string, string> = {
      portId: "port",
      fromPortId: "port",
      toPortId: "port",
      originPortId: "port",
      destinationPortId: "port",
      supplierId: "supplier",
      vesselId: "vessel",
      voyageId: "voyage",
      requirementId: "requirement",
      quoteId: "quote",
      orderId: "order",
    };
    const nullable = new Set(["extractionId", "recommendationId"]);
    let checked = 0;
    for (const [name, rows] of Object.entries(world)) {
      // nauticalItems.itemId is the catalogue's own key (a sales number), not a foreign key.
      if (name === "meta" || name === "nauticalItems") continue;
      for (const row of rows as Record<string, unknown>[]) {
        for (const [key, val] of Object.entries(row)) {
          if (key === "portIds" || key === "plannedRoute") {
            for (const id of val as number[])
              expect(tables.port?.has(id), `${name}.${key}`).toBe(true);
            checked++;
          } else if (key.endsWith("Id")) {
            if (val === null) continue;
            if (nullable.has(key)) throw new Error(`${name}.${key} should be null in the seed`);
            const table = refs[key];
            expect(table, `unmapped FK ${name}.${key}`).toBeDefined();
            expect(tables[table ?? ""]?.has(val as number), `${name}.${key}=${val}`).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("counts", () => {
    expect(world.ports).toHaveLength(18);
    expect(world.vessels).toHaveLength(8);
    expect(world.routeLegs.length).toBeGreaterThanOrEqual(14);
    expect(world.suppliers).toHaveLength(6);
    const types = world.vessels.map((v) => v.shipType);
    expect(types.filter((t) => t === "bulk_carrier")).toHaveLength(4);
    expect(types.filter((t) => t === "tanker")).toHaveLength(2);
    expect(types.filter((t) => t === "container")).toHaveLength(2);
    expect(world.noonReports).toHaveLength(8 * 5);
  });

  it("identity", () => {
    const mmsis = world.vessels.map((v) => v.mmsi).sort();
    expect(mmsis).toEqual(Array.from({ length: 8 }, (_, i) => String(999000001 + i)));
    for (const v of world.vessels) {
      expect(v.trackingSource).toBe("simulator");
      const d = v.imo.split("").map(Number);
      // e.g. 948001: 9×7 + 4×6 + 8×5 + 0×4 + 0×3 + 1×2 = 63+24+40+0+0+2 = 129 → check digit 9
      const sum = d.slice(0, 6).reduce((s, x, i) => s + x * (7 - i), 0);
      expect(sum % 10).toBe(d[6]);
      expect(isValidImo(v.imo)).toBe(true);
    }
    expect(world.vessels[0]?.imo).toBe("9480019");
  });

  it("fuel continuity", () => {
    for (const v of world.vessels) {
      const reps = world.noonReports
        .filter((r) => r.vesselId === v.id)
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());
      expect(reps).toHaveLength(5);
      for (let i = 1; i < reps.length; i++) {
        const older = reps[i - 1];
        const newer = reps[i];
        if (!older || !newer) throw new Error("missing report");
        expect(newer.ts.getTime() - older.ts.getTime()).toBe(24 * 3_600_000);
        for (const g of FUEL) {
          expect(
            Math.abs(older.robMt[g] - newer.consumedMt[g] - newer.robMt[g]),
          ).toBeLessThanOrEqual(0.1);
        }
      }
      for (const r of reps) for (const g of FUEL) expect(r.robMt[g]).toBeGreaterThanOrEqual(0);
    }
  });

  it("ETA consistency", () => {
    let future = 0;
    for (const voyage of world.voyages) {
      const calls = world.portCalls
        .filter((c) => c.voyageId === voyage.id)
        .sort((a, b) => a.sequence - b.sequence);
      // cumulative route nm per call, and nm already sailed at the anchor
      let cum = 0;
      const cumAt: number[] = [0];
      for (let i = 1; i < voyage.plannedRoute.length; i++) {
        const leg = world.routeLegs.find(
          (l) =>
            l.fromPortId === voyage.plannedRoute[i - 1] && l.toPortId === voyage.plannedRoute[i],
        );
        if (!leg) throw new Error("missing leg");
        cum += leg.distanceNm;
        cumAt.push(cum);
      }
      const departed = voyage.departedAt ?? ANCHOR;
      const sailed = ((ANCHOR.getTime() - departed.getTime()) / 3_600_000) * voyage.plannedSpeedKn;
      for (const c of calls) {
        if (c.eta.getTime() <= ANCHOR.getTime()) continue;
        future++;
        const expected = etaAfter(ANCHOR, (cumAt[c.sequence] ?? 0) - sailed, voyage.plannedSpeedKn);
        expect(Math.abs(c.eta.getTime() - expected.getTime())).toBeLessThanOrEqual(60_000);
      }
      const last = calls.at(-1);
      expect(last?.purpose).toBe("discharge");
      expect(last?.berthWindowStart).not.toBeNull();
    }
    expect(future).toBeGreaterThanOrEqual(world.voyages.length);
  });

  it("routes are real", () => {
    const code = (id: number) => world.ports.find((p) => p.id === id)?.unlocode;
    for (const leg of world.routeLegs) {
      const src = ROUTES.legs.find(
        (l) => l.from === code(leg.fromPortId) && l.to === code(leg.toPortId),
      );
      expect(src, `leg ${code(leg.fromPortId)}-${code(leg.toPortId)}`).toBeDefined();
      if (!src) continue;
      if (src.source === "direct") {
        // Ports closer than the network resolution: straight line across the bay.
        expect(leg.waypoints).toHaveLength(2);
        expect(leg.distanceNm).toBeLessThan(20);
        continue;
      }
      expect(leg.distanceNm).toBeGreaterThanOrEqual(src.libraryLengthNm - 1);
      expect(leg.distanceNm).toBeLessThanOrEqual(
        src.libraryLengthNm + src.originSnapNm + src.destinationSnapNm + 1,
      );
    }
    const psdMla = world.routeLegs.find(
      (l) => code(l.fromPortId) === "EGPSD" && code(l.toPortId) === "MTMLA",
    );
    expect(psdMla?.distanceNm).toBeGreaterThanOrEqual(900);
    expect(psdMla?.distanceNm).toBeLessThanOrEqual(1050);
    // Demo path and the Gibraltar <-> Algeciras spur all exist.
    const pairs = [
      "EGPSD-MTMLA",
      "MTMLA-GIGIB",
      "GIGIB-PTSIE",
      "PTSIE-FRBES",
      "FRBES-NLRTM",
      "GIGIB-ESALG",
      "ESALG-GIGIB",
    ];
    const have = new Set(world.routeLegs.map((l) => `${code(l.fromPortId)}-${code(l.toPortId)}`));
    for (const p of pairs) expect(have.has(p), p).toBe(true);
  });

  it("routes.generated.json is reproducible from the offline library", () => {
    expect(serializeRoutes(buildRoutes())).toBe(readFileSync(ROUTES_FILE, "utf8"));
  }, 30_000);

  it("grade-by-zone", () => {
    const port = (id: number) => world.ports.find((p) => p.id === id);
    for (const leg of world.routeLegs) {
      const from = port(leg.fromPortId);
      const to = port(leg.toPortId);
      if (!from || !to) throw new Error("missing port");
      const src = ROUTES.legs.find((l) => l.from === from.unlocode && l.to === to.unlocode);
      expect(leg.requiredGrade).toBe(requiredGradeFor(src?.ecaFraction ?? 1, from, to));
      if ((src?.ecaFraction ?? 0) > 0 || from.inEca || to.inEca)
        expect(leg.requiredGrade).toBe("LSMGO");
      expect(leg.etsCoverage).toBe(etsCoverage(from.isEu, to.isEu));
      expect(Math.abs(leg.distanceNm - polylineNm(leg.waypoints))).toBeLessThanOrEqual(0.1);
    }
    // Sines -> Brest is open Atlantic between two non-ECA ports.
    const sinesBrest = world.routeLegs.find(
      (l) => port(l.fromPortId)?.unlocode === "PTSIE" && port(l.toPortId)?.unlocode === "FRBES",
    );
    expect(sinesBrest?.requiredGrade).toBe("VLSFO");
  });

  it("load: every vessel has a lightship, every voyage's cargo + ballast fits its deadweight", () => {
    for (const voyage of world.voyages) {
      const vessel = world.vessels.find((v) => v.id === voyage.vesselId);
      if (!vessel) throw new Error(`no vessel ${voyage.vesselId}`);
      expect(vessel.lightshipMt, vessel.name).toBeGreaterThan(0);
      expect(voyage.cargoMt + voyage.ballastMt, voyage.voyageNo).toBeLessThanOrEqual(vessel.dwt);
      // The vessel row keeps the curve without a load; the voyage applies it.
      expect(vessel.consumptionCurve.load).toBeUndefined();
      expect(voyageState(world, voyage.id).path.curve.load).toEqual(voyageLoad(vessel, voyage));
    }
  });

  it("load: at least one voyage is in ballast (no cargo, ballast water aboard)", () => {
    expect(world.voyages.some((v) => v.cargoMt === 0 && v.ballastMt > 0)).toBe(true);
  });

  it("noon reports burn the voyage's loaded curve", () => {
    const { vessel, voyage, path, report } = demoVoyageState(world);
    expect(path.curve.load).toBeDefined();
    const prev = new Date(report.ts.getTime() - 24 * 3_600_000);
    const raw = fuelBetween(path, prev, report.ts);
    const consumed = report.consumedMt;
    for (const g of FUEL) expect(consumed[g]).toBeCloseTo(raw[g], 2);
    // and not the unloaded one (Aegean Pioneer sails laden below full load)
    const unloaded = fuelBetween({ ...path, curve: vessel.consumptionCurve }, prev, report.ts);
    expect(unloaded.LSMGO + unloaded.VLSFO).toBeGreaterThan(raw.LSMGO + raw.VLSFO);
    expect(voyage.cargoMt).toBeGreaterThan(0);
  });

  it("Aegean Pioneer runs out of LSMGO before Rotterdam on the current plan", () => {
    const { report, voyage } = demoVoyageState(world);
    expect(report.ts.getTime()).toBe(ANCHOR.getTime());
    // 24 h at 12.5 kn = 300 nm sailed on leg 1 at the anchor.
    expect(voyage.departedAt?.getTime()).toBe(ANCHOR.getTime() - 24 * 3_600_000);
    // The one fuel calculation (calm water): below the margin, then dry, before arrival.
    const fuel = currentPlanFuel(world, voyage.id, null);
    expect(fuel.grades.LSMGO.belowMarginAt).not.toBeNull();
    expect(fuel.grades.LSMGO.runsDryAt).not.toBeNull();
    expect(fuel.grades.LSMGO.shortfallMt).toBeGreaterThan(0);
    expect(fuel.grades.VLSFO.shortfallMt).toBe(0);
  });

  it("demo trap", () => {
    const plan = planBunkers(buildDemoBunkerPlanInput(world));
    expect(plan.bestOptionId).not.toBeNull();
    expect(plan.bestOptionId).not.toBe(plan.cheapestHeadlineOptionId);
    expect(plan.options.find((o) => o.optionId === plan.bestOptionId)?.feasible).toBe(true);
    expect(plan.cheapestHeadlineOptionId).toBe("GIGIB-straitline");
    expect(plan.savingVsCheapestHeadlineUsd).toBeGreaterThan(0);
  });

  it("berth window", () => {
    const input = buildDemoBunkerPlanInput(world);
    const plan = planBunkers(input);
    const { voyage } = demoVoyageState(world);
    const discharge = world.portCalls.find(
      (c) => c.voyageId === voyage.id && c.purpose === "discharge",
    );
    if (!discharge?.berthWindowStart || !discharge.berthWindowEnd)
      throw new Error("no berth window");
    expect(discharge.eta.getTime()).toBeGreaterThanOrEqual(discharge.berthWindowStart.getTime());
    expect(discharge.eta.getTime()).toBeLessThanOrEqual(discharge.berthWindowEnd.getTime());
    const best = plan.options.find((o) => o.optionId === plan.bestOptionId);
    expect(best?.delayHours).toBeLessThan(input.berthWindowSlackHours);
  });

  it("demo plan input is deterministic and uses the scenario offers", () => {
    const a = buildDemoBunkerPlanInput(world);
    expect(
      JSON.stringify(buildDemoBunkerPlanInput(generateWorld({ seed: SEED, anchor: ANCHOR }))),
    ).toBe(JSON.stringify(a));
    expect(a.options.map((o) => o.optionId)).toEqual(DEMO_SCENARIO.options.map((o) => o.optionId));
    expect(a.requiredQtyMt).toBe(300);
    expect(a.voyageEtsCoverage).toBe(0.5);
    expect(a.berthWindowSlackHours).toBe(48);
    expect(a.market).toEqual({ fxToUsd: { USD: 1, EUR: 1.08 }, euaPriceEur: 75, year: 2026 });
  });
});

describe("port-call seed (port-call-v1)", () => {
  const world = generateWorld({ seed: 42, anchor: ANCHOR });

  it("Aegean Pioneer carries four items older than the catalogue's current editions", () => {
    const ap = world.vessels.find((v) => v.name === "MV Aegean Pioneer");
    expect(ap?.stores?.crew).toBe(22);
    const current = new Map(world.nauticalItems.map((i) => [i.itemId, i.editionDate]));
    const stale = (ap?.stores?.onBoard ?? [])
      .filter((o) => o.editionDate < (current.get(o.itemId) ?? ""))
      .map((o) => o.itemId)
      .sort();
    expect(stale).toEqual(["142", "773", "NP022", "NP078"]);
    expect(world.nauticalItems).toHaveLength(20);
  });

  it("every port has call terms, Marsaxlokk's as seeded and Sines without stores", () => {
    expect(world.ports.every((p) => p.callTerms)).toBe(true);
    const port = (u: string) => world.ports.find((p) => p.unlocode === u)?.callTerms;
    expect(port("MTMLA")).toMatchObject({
      portDuesUsd: 3200,
      clearanceHours: 2,
      euWasteFeeUsd: 950,
    });
    expect(port("PTSIE")?.stores).toBe(false);
    expect(port("GIGIB")?.euWasteFeeUsd).toBe(0);
    expect(() => World.parse(world)).not.toThrow();
  });
});

describe("security seed (security-v1)", () => {
  const world = generateWorld({ seed: 20261114, anchor: ANCHOR });

  it("every danger area is cited, dated and ranked; three providers; a hull value for the tanker", () => {
    expect(world.securityAreas).toHaveLength(6);
    for (const a of world.securityAreas) {
      expect(a.source.length, a.id).toBeGreaterThan(20);
      expect(a.asOf, a.id).toMatch(/^2026-\d{2}-\d{2}$/);
    }
    expect(world.securityProviders.map((p) => p.name)).toContain("Tridentis Marine Protection");
    expect(world.vessels.find((v) => v.name === "MT Atlantic Meridian")?.hullValueUsd).toBe(
      45_000_000,
    );
  });

  it("Atlantic Meridian sails from Fujairah via Suez, through the Gulf of Aden", () => {
    const am = world.voyages.find((v) => v.voyageNo === "AM-2612");
    const legs = world.routeLegs.filter((l) =>
      am?.plannedRoute.some((p, i) => p === l.fromPortId && am.plannedRoute[i + 1] === l.toPortId),
    );
    const aden = world.securityAreas.find((a) => a.id === "gulf-of-aden");
    const inAden = legs.some((l) =>
      l.waypoints.some((p) =>
        aden?.boxes.some(
          (b) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon,
        ),
      ),
    );
    expect(inAden).toBe(true);
  });
});
