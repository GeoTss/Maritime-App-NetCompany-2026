/**
 * The security plan of a walked route: the danger areas it crosses, the armed team it needs and
 * the quote that covers it, the war-risk premium, the canal dues and the wait for the convoy.
 * Pure: every input, the clock included, comes in as an argument.
 */
import type {
  CanalTerms,
  CostLine,
  LatLon,
  RouteOptionResult,
  SecurityArea,
  SecurityPlanResult,
  SecurityQuoteCandidate,
} from "@pharos/shared";
import { areaSpansOfSteps, inBox } from "./areas.js";
import { SECURITY_POINT_MAX_NM, WAR_RISK_PREMIUM_PCT } from "./constants.js";
import { greatCircleNm } from "./geo.js";

const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;

export interface WalkedForSecurity {
  mid: LatLon;
  nm: number;
  hours: number;
  startAt: Date;
}

type Reason = Extract<RouteOptionResult["reasons"][number], "security_unavailable" | "avoid_area">;

/** The distance along the walk (nm, at the start of the nearest sub-step) of `p`, or null if far. */
function alongTrack(steps: WalkedForSecurity[], p: LatLon): { nm: number; at: Date } | null {
  let nm = 0;
  let best: { nm: number; at: Date; d: number } | null = null;
  for (const s of steps) {
    const d = greatCircleNm(s.mid, p);
    if (!best || d < best.d) best = { nm, at: s.startAt, d };
    nm += s.nm;
  }
  return best && best.d <= SECURITY_POINT_MAX_NM ? { nm: best.nm, at: best.at } : null;
}

/**
 * - `guards` spans need a team. A quote covers the route when its embark point lies before the
 *   first such span and its disembark point after the last (both within `SECURITY_POINT_MAX_NM` of
 *   the track), and it is valid at embarkation. The cheapest covering quote is chosen (then the
 *   lower id); team days = max(minDays, ceil(hours between the points / 24)).
 * - Each `premium` area crossed costs `WAR_RISK_PREMIUM_PCT` % of the hull value.
 * - The canal costs its dues, and the convoy wait is the time from reaching its box to the next
 *   daily northbound convoy.
 * - An `avoid` area gives `avoid_area`; a team nobody covers gives `security_unavailable`.
 */
export function securityPlan(a: {
  steps: WalkedForSecurity[];
  areas: SecurityArea[];
  quotes: SecurityQuoteCandidate[];
  hullValueUsd: number;
  canal: CanalTerms | null;
}): { result: SecurityPlanResult; reasons: Reason[] } {
  const byId = new Map(a.areas.map((x) => [x.id, x]));
  const spans = areaSpansOfSteps(
    a.steps,
    a.areas.map((x) => ({ id: x.id, boxes: x.boxes })),
  );
  const policy = (id: string) => byId.get(id)?.policy;
  const reasons: Reason[] = [];
  if (spans.some((s) => policy(s.areaId) === "avoid")) reasons.push("avoid_area");

  const guards = spans.filter((s) => policy(s.areaId) === "guards");
  const needsTeam = guards.length > 0;
  const costLines: CostLine[] = [];
  let chosen: {
    q: SecurityQuoteCandidate;
    days: number;
    usd: number;
    embarkAt: Date;
    disembarkAt: Date;
  } | null = null;
  if (needsTeam) {
    const firstIn = Math.min(...guards.map((s) => s.enterNm));
    const lastOut = Math.max(...guards.map((s) => s.exitNm));
    for (const q of a.quotes) {
      const on = alongTrack(a.steps, q.embark.position);
      const off = alongTrack(a.steps, q.disembark.position);
      if (!on || !off || on.nm > firstIn || off.nm < lastOut) continue;
      if (q.validUntil !== null && Date.parse(q.validUntil) < on.at.getTime()) continue;
      const hours = (off.at.getTime() - on.at.getTime()) / HOUR_MS;
      const days = Math.max(q.minDays, Math.ceil(hours / DAY_HOURS));
      const usd = days * q.dayRateUsd + q.fixedFeesUsd;
      if (!chosen || usd < chosen.usd || (usd === chosen.usd && q.quoteId < chosen.q.quoteId)) {
        chosen = { q, days, usd, embarkAt: on.at, disembarkAt: off.at };
      }
    }
    if (chosen) costLines.push({ kind: "security_team", usd: chosen.usd });
    else reasons.push("security_unavailable");
  }

  const premiumAreas = spans.filter((s) => policy(s.areaId) === "premium").length;
  if (premiumAreas > 0) {
    costLines.push({
      kind: "war_risk_premium",
      usd: premiumAreas * (WAR_RISK_PREMIUM_PCT / 100) * a.hullValueUsd,
    });
  }

  let convoyWaitHours = 0;
  if (a.canal) {
    const canal = a.canal;
    const reach = a.steps.find((s) => inBox(s.mid, canal.box));
    if (reach) {
      costLines.push({ kind: "canal_dues", usd: canal.duesUsd });
      const t = reach.startAt;
      const hourOfDay = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600;
      convoyWaitHours = (canal.convoyHourUtc - hourOfDay + DAY_HOURS) % DAY_HOURS;
    }
  }

  return {
    result: {
      spans,
      needsTeam,
      quoteId: chosen ? chosen.q.quoteId : null,
      embarkPortId: chosen ? chosen.q.embark.portId : null,
      disembarkPortId: chosen ? chosen.q.disembark.portId : null,
      embarkAt: chosen ? chosen.embarkAt.toISOString() : null,
      disembarkAt: chosen ? chosen.disembarkAt.toISOString() : null,
      teamDays: chosen ? chosen.days : 0,
      costLines,
      extraCostUsd: costLines.reduce((s, l) => s + l.usd, 0),
      convoyWaitHours,
    },
    reasons,
  };
}
