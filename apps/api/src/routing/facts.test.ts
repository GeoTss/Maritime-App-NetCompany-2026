/**
 * The route-plan fact rows on the pinned demo world, built without a database (as
 * demo-world.test.ts builds the result): the fleet vessel's fuel check, stop plans and
 * recommended plan, and an AIS ship's rows, whose labels must not change.
 */
import { demoOffers, fleetRoutePlan, generateWorld, pinnedNow, shipRoutePlan } from "@pharos/db";
import { activeHazardZones, buildRouteGraph, optimiseRouteSpeed } from "@pharos/domain";
import { loadSeaNetwork, recordedLiveData } from "@pharos/integrations";
import { describe, expect, it } from "vitest";
import { type RouteFactRow, routeSpeedFactRows } from "./facts.js";

const ANCHOR = new Date("2026-11-14T08:00:00Z");
const world = generateWorld({ seed: 20261114, anchor: ANCHOR });
const live = recordedLiveData({ anchor: ANCHOR, ports: world.ports });
const zones = activeHazardZones(live.hazards, pinnedNow(ANCHOR));
const graph = buildRouteGraph(loadSeaNetwork().segments);
const snapshot = { id: 1, modelRun: new Date(live.weather.startAt) };

/** How the rows read, without their values: path, label and unit. */
const shape = (rows: RouteFactRow[]) => rows.map((r) => `${r.path} | ${r.label} | ${r.unit}`);

/** A path into the result, as a calculation fact resolves it (`[n]` is `.n`). */
const pick = (root: unknown, path: string): unknown =>
  path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);

// Aegean Pioneer on the retuned world: the fuel-blind best runs short of LSMGO, and the
// recommended plan stops at Marsaxlokk for Kestrel's quote, with Algeciras next.
const voyage = world.voyages.find((v) => v.voyageNo === "AP-2611");
if (!voyage) throw new Error("no AP-2611");
const fleet = fleetRoutePlan(world, voyage.id, graph, live.weather, zones, {
  congestion: "seed",
  offers: demoOffers(world),
  fixedOrder: null,
});
const result = optimiseRouteSpeed(fleet.input);
const rows = routeSpeedFactRows(fleet, result, snapshot, { calculationId: 1 });
const S = fleet.subject;
const D = fleet.destination.name;
const row = (path: string) => {
  const hit = rows.find((r) => r.path === path);
  expect(hit, path).toBeDefined();
  return hit as RouteFactRow;
};

describe("route-plan fact rows: fleet vessel", () => {
  it("labels the fuel-blind best for a fleet vessel", () => {
    expect(row("bestCandidateId")).toEqual({
      path: "bestCandidateId",
      label: `${S}: best route ignoring fuel on board`,
      value: result.bestCandidateId,
      unit: null,
    });
    expect(row("savingVsBaselineUsd").label).toBe(
      `${S}: saving of the best route and speed ignoring fuel, against the current plan`,
    );
    expect(rows.some((r) => r.label.includes("recommended route"))).toBe(false);
  });

  it("cites the recommended plan, its stop and what it adds", () => {
    const plan = result.plan;
    if (!plan?.next) throw new Error("the demo world has a recommended plan and a next one");
    expect(plan.optionId).toBe("MTMLA-kestrel");
    expect(row("plan.optionId")).toEqual({
      path: "plan.optionId",
      label: `${S}: recommended plan`,
      value: "MTMLA-kestrel",
      unit: null,
    });
    expect(row("plan.addedHours")).toEqual({
      path: "plan.addedHours",
      label: `${S}: recommended plan adds (hours)`,
      value: plan.addedHours,
      unit: "h",
    });
    expect(row("plan.addedUsd")).toEqual({
      path: "plan.addedUsd",
      label: `${S}: recommended plan adds (USD, excluding the fuel bought)`,
      value: plan.addedUsd,
      unit: "USD",
    });
    expect(row("plan.next.optionId").value).toBe("ESALG-nordwind");
    expect(row("plan.next.marginUsd")).toMatchObject({ value: plan.next.marginUsd, unit: "USD" });

    const i = result.stopPlans.findIndex((p) => p.optionId === plan.optionId);
    const sp = result.stopPlans[i];
    if (!sp?.stop || !sp.fuel) throw new Error("the recommended stop plan has a stop and fuel");
    const P = `${S}, ${sp.optionId}`;
    for (const [field, unit] of [
      ["eta", null],
      ["hours", "h"],
      ["totalCostUsd", "USD"],
      ["voyageCostUsd", "USD"],
      ["bunkerFuelCostUsd", "USD"],
      ["bargeFeeUsd", "USD"],
      ["speedKn", "kn"],
      ["qtyMt", "mt"],
      ["stop.arriveAt", null],
      ["stop.waitingHours", "h"],
      ["stop.weatherDelayHours", "h"],
      ["stop.bunkeringHours", "h"],
      ["stop.departAt", null],
    ] as const) {
      const r = row(`stopPlans[${i}].${field}`);
      expect(r.label.startsWith(`${P}: `), r.label).toBe(true);
      expect(r.value, field).toBe(pick(sp, field));
      expect(r.unit, field).toBe(unit);
    }
    // LSMGO is the grade bought: on board at arrival, after bunkering and at Rotterdam.
    const at = (kind: string) => sp.fuel?.breakpoints.findIndex((b) => b.kind === kind) ?? -1;
    const rob = (kind: string) => row(`stopPlans[${i}].fuel.breakpoints[${at(kind)}].robMt.LSMGO`);
    expect(rob("stop_arrival")).toMatchObject({
      label: `${P}: LSMGO on board at stop arrival`,
      unit: "mt",
    });
    expect(rob("stop_departure").label).toBe(`${P}: LSMGO on board after bunkering`);
    expect(rob("end").label).toBe(`${P}: LSMGO on board at ${D}`);
    expect((rob("stop_departure").value as number) > (rob("stop_arrival").value as number)).toBe(
      true,
    );
    expect(row(`stopPlans[${i}].fuel.grades.LSMGO.marginMt`).value).toBe(
      sp.fuel.grades.LSMGO.marginMt,
    );
    // No speed makes Gibraltar work (slow misses the berth window, fast runs short of LSMGO): it
    // is cited as not feasible at its earliest arrival, with that speed's reason.
    const g = result.stopPlans.findIndex((p) => p.optionId === "GIGIB-straitline");
    expect(row(`stopPlans[${g}].feasible`).value).toBe(false);
    expect(row(`stopPlans[${g}].reasons[0]`).value).toBe("insufficient_fuel");
  });

  it("cites where the fuel-blind best runs short", () => {
    const b = result.options.findIndex((o) => o.candidateId === result.bestCandidateId);
    const best = result.options[b];
    const lsmgo = best?.fuel?.grades.LSMGO;
    if (!best || !lsmgo?.belowMarginAt) throw new Error("the fuel-blind best runs short of LSMGO");
    const X = `${S}, route ${best.candidateId}`;
    const p = `options[${b}].fuel.grades.LSMGO`;
    expect(row(`${p}.belowMarginAt.nm`)).toEqual({
      path: `${p}.belowMarginAt.nm`,
      label: `${X}: LSMGO drops below its safety margin, distance along the route`,
      value: lsmgo.belowMarginAt.nm,
      unit: "nm",
    });
    expect(row(`${p}.belowMarginAt.at`).value).toBe(lsmgo.belowMarginAt.at);
    expect(row(`${p}.shortfallMt`)).toMatchObject({ value: lsmgo.shortfallMt, unit: "mt" });
    expect(row(`${p}.marginMt`)).toMatchObject({ value: lsmgo.marginMt, unit: "mt" });
    const end = best.fuel?.breakpoints.findIndex((k) => k.kind === "end") ?? -1;
    expect(row(`options[${b}].fuel.breakpoints[${end}].robMt.LSMGO`)).toMatchObject({
      label: `${X}: LSMGO on board at ${D}`,
      unit: "mt",
    });
    // It drops below the margin but does not run dry, and VLSFO keeps its margin: no rows.
    expect(lsmgo.runsDryAt).toBeNull();
    expect(rows.some((r) => r.path.startsWith(`${p}.runsDryAt`))).toBe(false);
    expect(rows.some((r) => r.path.startsWith(`options[${b}].fuel.grades.VLSFO`))).toBe(false);
  });

  it("every calculation row resolves to its value in the result", () => {
    const calc = rows.filter((r) => !/^(inputs|weather|calculation|ais)\./.test(r.path));
    expect(calc.length).toBeGreaterThan(50);
    for (const r of calc) expect(pick(result, r.path), r.label).toEqual(r.value);
  });

  it("reads the same rows from the stored plan (JSON round trip of inputs and outputs)", () => {
    // What the stored-plan view keeps of the optimiser input (read/db-source.ts).
    const { candidates, arriveBy, curve, hazards } = fleet.input;
    const stored = {
      subject: fleet.subject,
      profile: fleet.profile,
      destination: { name: fleet.destination.name },
      input: JSON.parse(JSON.stringify({ candidates, arriveBy, curve, hazards })),
    };
    const again = routeSpeedFactRows(stored, JSON.parse(JSON.stringify(result)), snapshot, {
      calculationId: 1,
    });
    // The view's plan carries no load condition; a fleet vessel's is null, so no row differs.
    expect(again).toEqual(rows);
  });

  it("names every row by path, label and unit", () => {
    expect(shape(rows)).toMatchSnapshot();
  });
});

describe("route-plan fact rows", () => {
  it("keeps AIS labels unchanged", () => {
    const ship = live.traffic
      .filter(
        (t) =>
          t.name?.trim() &&
          (t.shipType === "cargo" || t.shipType === "tanker") &&
          (t.sogKn ?? 0) >= 8,
      )
      .sort((a, b) => a.mmsi.localeCompare(b.mmsi))[0];
    const rotterdam = world.ports.find((p) => p.name === "Rotterdam");
    if (!ship || !rotterdam) throw new Error("no AIS ship or no Rotterdam");
    const plan = shipRoutePlan(world, ship, rotterdam, graph, live.weather, zones);
    const result = optimiseRouteSpeed(plan.input);
    const rows = routeSpeedFactRows(plan, result, snapshot, {
      mmsi: ship.mmsi,
      calculationId: 1,
      ship,
    });
    expect(shape(rows)).toMatchSnapshot();
  });
});
