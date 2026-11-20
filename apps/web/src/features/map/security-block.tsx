/**
 * A route option's or a bunker stop plan's security in the route tray (Track 3): the danger areas it crosses with the
 * hours inside each, the armed team its plan chose (provider and ports from the quote list, days
 * and boarding times as fact chips), and the cost lines and convoy wait, every number a fact chip
 * from the plan. Also the Suez-or-Cape line: the canal route's total beside the Cape's.
 */
import type { CostLine, RoutePlanView } from "@pharos/shared";
import { FactCell } from "./fact-cell";
import { factAtPath } from "./route-facts";

/** Names the block reads beside the plan: each quote's team, and each area's name. */
export interface SecurityNames {
  teams: ReadonlyMap<number, { provider: string; embark: string; disembark: string }>;
  areas: ReadonlyMap<string, string>;
}

const COST_TEXT: Partial<Record<CostLine["kind"], string>> = {
  security_team: "Armed team",
  war_risk_premium: "War-risk premium",
  canal_dues: "Canal dues",
};

export function SecurityBlock({
  plan,
  index,
  names,
  kind = "route",
}: {
  plan: RoutePlanView;
  index: number;
  names?: SecurityNames;
  /** `route`: `options[index]`; `stop`: `stopPlans[index]`, each with its own security plan. */
  kind?: "route" | "stop";
}) {
  const at = kind === "route" ? `options[${index}]` : `stopPlans[${index}]`;
  const sec =
    kind === "route"
      ? plan.result.options[index]?.security
      : plan.result.stopPlans[index]?.security;
  const id =
    kind === "route"
      ? plan.result.options[index]?.candidateId
      : plan.result.stopPlans[index]?.optionId;
  if (!sec || sec.spans.length === 0) return null;
  const f = (field: string) => factAtPath(plan.facts, `${at}.security.${field}`);
  const team = sec.quoteId === null ? undefined : names?.teams.get(sec.quoteId);
  return (
    <dl
      className={
        kind === "route"
          ? "mt-1 grid gap-0.5 pl-7 text-xs text-text-2"
          : "mt-1 grid gap-0.5 text-xs text-text-2"
      }
      data-testid={`security-${id}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <dt className="text-text-3">Danger areas</dt>
        {sec.spans.map((s, k) => (
          <dd key={`${s.areaId}-${s.enterNm}`}>
            {names?.areas.get(s.areaId) ?? s.areaId}{" "}
            <FactCell fact={f(`spans[${k}].hoursInside`)} />
            {k < sec.spans.length - 1 ? "," : ""}
          </dd>
        ))}
      </div>
      {sec.needsTeam ? (
        sec.quoteId === null ? (
          <div className="text-alarm">No security quote covers this route's guarded areas.</div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <dt className="text-text-3">Armed team</dt>
            <dd className="text-text-1">
              {team
                ? `${team.provider}, ${team.embark} to ${team.disembark}`
                : `quote ${sec.quoteId}`}
              , <FactCell fact={f("teamDays")} />, boards{" "}
              <FactCell fact={f("embarkAt")} kind="time" />
            </dd>
          </div>
        )
      ) : null}
      {sec.costLines.length > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <dt className="text-text-3">Costs</dt>
          {sec.costLines.map((l, k) => (
            <dd key={l.kind}>
              {COST_TEXT[l.kind] ?? l.kind} <FactCell fact={f(`costLines[${k}].usd`)} />
              {k < sec.costLines.length - 1 || sec.convoyWaitHours > 0 ? "," : ""}
            </dd>
          ))}
          {sec.convoyWaitHours > 0 ? (
            <dd>
              Convoy wait <FactCell fact={f("convoyWaitHours")} />
            </dd>
          ) : null}
        </div>
      ) : null}
    </dl>
  );
}

/** The candidate the planner adds round the Cape of Good Hope (Track 3). */
const CAPE = "K";

/**
 * Suez or the Cape, when a plan has both: the canal route's total (team, premium and dues in it)
 * beside the Cape route's. The canal route is the recommended one when it goes through the canal,
 * else the first feasible one that does. Both totals are the plan's facts; nothing is subtracted.
 */
export function SuezOrCape({ plan }: { plan: RoutePlanView }) {
  const { options, bestCandidateId } = plan.result;
  const cape = options.findIndex((o) => o.candidateId === CAPE);
  const viaCanal = (i: number) =>
    options[i]?.security?.costLines.some((l) => l.kind === "canal_dues") ?? false;
  const best = options.findIndex((o) => o.candidateId === bestCandidateId);
  const suez = viaCanal(best) ? best : options.findIndex((o, i) => o.feasible && viaCanal(i));
  if (cape < 0 || suez < 0) return null;
  const total = (i: number) => factAtPath(plan.facts, `options[${i}].totalCostUsd`);
  return (
    <p className="text-xs text-text-2" data-testid="suez-or-cape">
      <span className="text-text-3">Suez or the Cape: </span>
      route {options[suez]?.candidateId} through Suez totals{" "}
      <FactCell fact={total(suez)} metric="suez-total" /> with the team, war-risk premium and canal
      dues; route {CAPE} round the Cape totals <FactCell fact={total(cape)} metric="cape-total" />
      {options[cape]?.feasible ? "" : " and is not feasible"}.
    </p>
  );
}
