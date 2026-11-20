/**
 * The voyage timeline: what the recommended plan does along its way, in time order. It walks the
 * plan's track again with the optimiser's own walk (`walkRouteOption`, `walkStopPlan`), so every
 * time and position matches the plan, and reads the rest from the result: the port call's jobs and
 * notices, the security plan's spans and team. New maths here is only where things happen along
 * the walk: sulphur-ECA lines, sewage discharge windows, and the closest pass of each storm. Pure.
 */
import {
  type LatLon,
  type PortAction,
  RouteSpeedInput,
  type RouteSpeedResult,
  TIMELINE_KIND_ORDER,
  type VoyageEvent,
} from "@pharos/shared";
import type { CoastIndex } from "./coast.js";
import { withinNmOfLand } from "./coast.js";
import {
  ECA_CHANGEOVER_LEAD_HOURS,
  PROVISIONS_RESERVE_DAYS,
  SEWAGE_DISCHARGE_MIN_LAND_NM,
  SEWAGE_DISCHARGE_MIN_SOG_KN,
  SEWAGE_MIN_WINDOW_HOURS,
  STORM_PASS_NEAR_NM,
} from "./constants.js";
import { inSulphurEca } from "./eca.js";
import { greatCircleNm, nearestAlongNm } from "./geo.js";
import { provisionsDaysLeft } from "./port-call.js";
import { walkRouteOption } from "./route-optimiser.js";
import { walkStopPlan } from "./stop-plan.js";
import { type StormArea, stormAreas } from "./storms.js";
import { lerp, type WalkedStep } from "./track.js";

const HOUR_MS = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A walked sub-step with where it starts along the track (nm) and when it ends (ms). */
interface Leg {
  step: WalkedStep;
  fromNm: number;
  startMs: number;
  endMs: number;
}

/** Where and when along the walk: by distance or by time, interpolated within a sub-step. */
function along(legs: Leg[], start: LatLon, startMs: number) {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const totalNm = last ? last.fromNm + last.step.nm : 0;
  const atNm = (nm: number): { ms: number; position: LatLon; nm: number } => {
    if (!first || !last) return { ms: startMs, position: start, nm: 0 };
    const leg = legs.find((l) => nm <= l.fromNm + l.step.nm) ?? last;
    const t = leg.step.nm > 0 ? Math.min(1, Math.max(0, (nm - leg.fromNm) / leg.step.nm)) : 0;
    return {
      ms: leg.startMs + t * (leg.endMs - leg.startMs),
      position: lerp(leg.step.start, leg.step.end, t),
      nm: Math.min(Math.max(nm, 0), totalNm),
    };
  };
  const atMs = (ms: number): { position: LatLon; nm: number } => {
    if (!first || !last || ms <= first.startMs) return { position: start, nm: 0 };
    for (const [k, leg] of legs.entries()) {
      if (ms < leg.startMs) {
        // In a pause (at the stop) before this leg: where the previous leg ended.
        const prev = legs[k - 1] ?? leg;
        return { position: prev.step.end, nm: prev.fromNm + prev.step.nm };
      }
      if (ms <= leg.endMs) {
        const t = leg.endMs > leg.startMs ? (ms - leg.startMs) / (leg.endMs - leg.startMs) : 0;
        return {
          position: lerp(leg.step.start, leg.step.end, t),
          nm: leg.fromNm + t * leg.step.nm,
        };
      }
    }
    return { position: last.step.end, nm: totalNm };
  };
  return { atNm, atMs, totalNm };
}

function toLegs(steps: WalkedStep[]): Leg[] {
  let nm = 0;
  return steps.map((step) => {
    const startMs = step.startAt.getTime();
    const leg = { step, fromNm: nm, startMs, endMs: startMs + step.hours * HOUR_MS };
    nm += step.nm;
    return leg;
  });
}

/** ECA lines crossed: where the sub-step midpoints go in or out of a sulphur ECA. */
function ecaEvents(legs: Leg[], startMs: number): VoyageEvent[] {
  const out: VoyageEvent[] = [];
  let inside: boolean | null = null;
  for (const leg of legs) {
    const now = inSulphurEca(leg.step.mid);
    const where = { at: iso(leg.startMs), position: leg.step.start, alongNm: leg.fromNm };
    if (inside === null && now) {
      out.push({
        kind: "eca_entry",
        ...where,
        atDeparture: true,
        changeoverStartAt: null,
        grade: "LSMGO",
      });
    } else if (inside === false && now) {
      const lead = Math.max(startMs, leg.startMs - ECA_CHANGEOVER_LEAD_HOURS * HOUR_MS);
      out.push({
        kind: "eca_entry",
        ...where,
        atDeparture: false,
        changeoverStartAt: iso(lead),
        grade: "LSMGO",
      });
    } else if (inside === true && !now) {
      out.push({ kind: "eca_exit", ...where, grade: "VLSFO" });
    }
    inside = now;
  }
  return out;
}

/**
 * Where holding-tank sewage may go overboard: runs of consecutive sub-steps whose midpoint is more
 * than 12 nm from land at 4 kn or more over ground, unbroken by a stay. Runs shorter than 1 h are
 * dropped.
 */
function sewageEvents(legs: Leg[], coast: CoastIndex | null): VoyageEvent[] {
  if (!coast) return [];
  const out: VoyageEvent[] = [];
  let run: Leg[] = [];
  const close = () => {
    const a = run[0];
    const b = run[run.length - 1];
    const hours = run.reduce((s, l) => s + l.step.hours, 0);
    if (a && b && hours >= SEWAGE_MIN_WINDOW_HOURS) {
      out.push({
        kind: "sewage_window_open",
        at: iso(a.startMs),
        position: a.step.start,
        alongNm: a.fromNm,
        windowHours: hours,
      });
      out.push({
        kind: "sewage_window_close",
        at: iso(b.endMs),
        position: b.step.end,
        alongNm: b.fromNm + b.step.nm,
      });
    }
    run = [];
  };
  for (const leg of legs) {
    const open =
      leg.step.sogKn >= SEWAGE_DISCHARGE_MIN_SOG_KN &&
      !withinNmOfLand(leg.step.mid, coast, SEWAGE_DISCHARGE_MIN_LAND_NM);
    const prev = run[run.length - 1];
    // A stay between two sub-steps (the stop) ends the run.
    if (prev && (!open || leg.startMs - prev.endMs > 1000)) close();
    if (open) run.push(leg);
  }
  close();
  return out;
}

/**
 * The storms the route passes near: one event per storm (neighbouring grid cells of one storm
 * merged, as their circles touch), at its closest approach, and only when that is within
 * `STORM_PASS_NEAR_NM` of its edge. Each says whether the route passes while the storm is on,
 * after it has blown out, or before it starts (a route crossing where a storm was is explained).
 * Waves are the storm's highest; its window spans its cells'.
 */
function stormEvents(
  points: LatLon[],
  areas: StormArea[],
  at: ReturnType<typeof along>,
): VoyageEvent[] {
  const near = areas
    .map((area) => ({ area, pass: nearestAlongNm(points, area.center) }))
    .map((c) => ({ ...c, clearanceNm: c.pass.offNm - c.area.radiusNm }))
    .filter((c) => c.clearanceNm <= STORM_PASS_NEAR_NM);
  // Cells of one storm: circles that touch (a quarter of slack takes in diagonal neighbours).
  const group = near.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : root(group[i] as number));
  for (const [i, a] of near.entries()) {
    for (const [j, b] of near.entries()) {
      if (j <= i) continue;
      const touch = (a.area.radiusNm + b.area.radiusNm) * 1.25;
      if (greatCircleNm(a.area.center, b.area.center) <= touch) group[root(j)] = root(i);
    }
  }
  const storms = new Map<number, typeof near>();
  for (const [i, c] of near.entries()) storms.set(root(i), [...(storms.get(root(i)) ?? []), c]);
  return [...storms.values()].map((storm) => {
    const closest = storm.reduce((m, c) => (c.clearanceNm < m.clearanceNm ? c : m));
    const p = at.atNm(closest.pass.nm);
    const from = Math.min(...storm.map((c) => Date.parse(c.area.from)));
    const open = storm.some((c) => c.area.until === null);
    const until = open ? null : Math.max(...storm.map((c) => Date.parse(c.area.until as string)));
    const timing = p.ms < from ? "before" : until !== null && p.ms > until ? "after" : "during";
    return {
      kind: "storm_passed" as const,
      at: iso(p.ms),
      position: p.position,
      alongNm: p.nm,
      stormId: closest.area.id,
      clearanceNm: closest.clearanceNm,
      maxWaveHeightM: Math.max(...storm.map((c) => c.area.maxWaveHeightM)),
      synthetic: storm.some((c) => c.area.synthetic),
      activeFrom: iso(from),
      activeUntil: until === null ? null : iso(until),
      timing,
    };
  });
}

const sortEvents = (events: VoyageEvent[]): VoyageEvent[] =>
  events
    .map((e, i) => ({ e, i }))
    .sort(
      (a, b) =>
        Date.parse(a.e.at) - Date.parse(b.e.at) ||
        TIMELINE_KIND_ORDER.indexOf(a.e.kind) - TIMELINE_KIND_ORDER.indexOf(b.e.kind) ||
        a.i - b.i,
    )
    .map(({ e }) => e);

/**
 * The recommended plan's events (the fuel-blind best route when there is no plan), sorted by time
 * then by kind. Empty when that option cannot be walked (no candidate, no sea route).
 */
export function voyageTimeline(a: {
  input: RouteSpeedInput;
  result: RouteSpeedResult;
  coast: CoastIndex | null;
}): VoyageEvent[] {
  const input = RouteSpeedInput.parse(a.input);
  const { result } = a;
  const startMs = Date.parse(input.startAt);
  const plan = result.plan;
  const optionId = plan?.optionId ?? result.bestCandidateId;
  const stopPlanIndex =
    plan?.kind === "stop" ? result.stopPlans.findIndex((s) => s.optionId === optionId) : -1;
  const stopPlan = stopPlanIndex >= 0 ? result.stopPlans[stopPlanIndex] : undefined;
  const option = stopPlan ? undefined : result.options.find((o) => o.candidateId === optionId);
  if (!stopPlan && !option) return [];

  const stopWalk = stopPlan ? walkStopPlan(input, optionId, stopPlan.speedKn, stopPlan.stop) : null;
  const walk = stopPlan ? stopWalk : walkRouteOption(input, optionId, option?.speedKn ?? 0);
  if (!walk || walk.points.length === 0) return [];
  const legs = toLegs(walk.steps);
  const start = walk.points[0] as LatLon;
  const end = walk.points[walk.points.length - 1] as LatLon;
  const at = along(legs, start, startMs);

  const events: VoyageEvent[] = [
    { kind: "departure", at: input.startAt, position: start, alongNm: 0 },
    ...ecaEvents(legs, startMs),
    ...sewageEvents(legs, a.coast),
    ...stormEvents(walk.points, stormAreas(input.weather), at),
  ];

  if (stopPlan && stopWalk) {
    const timeline = stopPlan.stop;
    const call = stopPlan.portCall;
    const stopNm = legs
      .filter((l) => l.step.pointIndexAfter <= stopWalk.stopPointIndex)
      .reduce((s, l) => s + l.step.nm, 0);
    const position = walk.points[stopWalk.stopPointIndex] ?? start;
    if (timeline) {
      const actions: PortAction[] = ["bunkering"];
      for (const job of call?.jobs ?? []) if (job.done) actions.push(job.kind);
      if (timeline.clearanceHours > 0) actions.push("clearance");
      if (call?.costLines.some((l) => l.kind === "port_dues")) actions.push("port_dues");
      const where = {
        position,
        alongNm: stopNm,
        stopIndex: stopPlanIndex,
        unlocode: stopPlan.unlocode,
      };
      const bunkerGrade = input.stops.find((st) => st.optionId === optionId)?.grade ?? "LSMGO";
      events.push({ kind: "port_arrival", at: timeline.arriveAt, ...where, actions, bunkerGrade });
      // Provisions bought here get their own entry: the voyage would run short without them.
      const jobIndex = call?.jobs.findIndex((j) => j.kind === "provisions" && j.done) ?? -1;
      if (jobIndex >= 0) {
        events.push({ kind: "provisions_restock", at: timeline.arriveAt, ...where, jobIndex });
      }
      events.push({ kind: "port_departure", at: timeline.departAt, ...where });
    }
    for (const notice of call?.notices ?? []) {
      const p = at.atMs(Date.parse(notice.dueAt));
      events.push({
        kind: "notice_due",
        at: notice.dueAt,
        position: p.position,
        alongNm: p.nm,
        stopIndex: stopPlanIndex,
        notice: notice.kind,
        overdue: notice.overdue,
      });
    }
  }

  // A route option's or a stop plan's: both are worked out over the walk this timeline reads.
  const security = option?.security ?? stopPlan?.security ?? null;
  if (security) {
    for (const span of security.spans) {
      const enter = at.atNm(span.enterNm);
      const exit = at.atNm(span.exitNm);
      events.push({
        kind: "danger_area_entry",
        at: iso(enter.ms),
        position: enter.position,
        alongNm: enter.nm,
        areaId: span.areaId,
        hoursInside: span.hoursInside,
        guarded: security.needsTeam && security.quoteId !== null,
      });
      events.push({
        kind: "danger_area_exit",
        at: iso(exit.ms),
        position: exit.position,
        alongNm: exit.nm,
        areaId: span.areaId,
      });
    }
    const quote = input.security?.quotes.find((q) => q.quoteId === security.quoteId);
    if (quote && security.embarkAt) {
      const p = nearestAlongNm(walk.points, quote.embark.position);
      events.push({
        kind: "guards_embark",
        at: security.embarkAt,
        position: quote.embark.position,
        alongNm: p.nm,
        portId: quote.embark.portId,
      });
    }
    if (quote && security.disembarkAt) {
      const p = nearestAlongNm(walk.points, quote.disembark.position);
      events.push({
        kind: "guards_disembark",
        at: security.disembarkAt,
        position: quote.disembark.position,
        alongNm: p.nm,
        portId: quote.disembark.portId,
      });
    }
  }

  const eta = stopPlan?.eta ?? (option?.eta as string);
  const hours = (Date.parse(eta) - startMs) / HOUR_MS;
  const daysLeft = stopPlan?.portCall
    ? stopPlan.portCall.provisionsDaysAtEta
    : input.stores
      ? provisionsDaysLeft(input.stores, hours)
      : null;
  events.push({
    kind: "arrival",
    at: eta,
    position: end,
    alongNm: at.totalNm,
    provisionsDaysLeft: daysLeft,
    restockNeeded: daysLeft !== null && daysLeft < PROVISIONS_RESERVE_DAYS,
  });

  return sortEvents(events);
}
