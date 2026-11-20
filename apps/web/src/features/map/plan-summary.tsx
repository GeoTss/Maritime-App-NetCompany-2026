/**
 * The two answers a fleet vessel's route plan gives, read from the plan's facts by output path:
 *
 * - `PlanSummary`: the recommended plan first. For a bunker stop: the port and quote, speed, ETA,
 *   the berth window, the plan total, what the stop adds against the best route ignoring fuel, the
 *   next feasible quote and the margin over it, and the stop card. Under it, the proposals the plan
 *   implies (the stop's purchase order, the voyage instruction), pending until approved. With no
 *   recommended plan it says "No feasible plan" and why, quote by quote, in words.
 * - `FuelBlindBest`: the best route ignoring fuel on board, marked with the vessel-alert flag and
 *   "Runs short of <grade>" when it falls below a margin, with where.
 *
 * Every number is a fact chip (a dash when the plan returned no fact for it); the UI derives none.
 * Supplier and port names are text from the quote records (`GET /api/quotes`).
 */
import type { FuelGrade, RoutePlanView, StopPlanResult } from "@pharos/shared";
import { type ReactNode, useId } from "react";
import { StateFlag } from "@/components/primitives/state-flag";
import { possessive } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FactCell } from "./fact-cell";
import { PortCallBlock } from "./port-call-block";
import { ProposeFromPlan } from "./propose-from-plan";
import {
  ARRIVE_BY_FIELD,
  breakpointRobFact,
  dbFact,
  fuelBlindBest,
  gradeCheckFact,
  gradesShort,
  knowsFuel,
  planFact,
  reasonText,
  recommendedTrack,
  type StopField,
  type StopNames,
  stopFact,
  stopGrade,
  stopPlanName,
  stopPriceFact,
  stopReasonText,
  type TrackRef,
  trackFact,
} from "./route-facts";
import { SecurityBlock, type SecurityNames } from "./security-block";

/** "Kestrel Marine Fuels at Marsaxlokk", or the port's UN/LOCODE alone when the quote is unknown. */
function StopName({ stop, names }: { stop: StopPlanResult; names?: StopNames }) {
  const { supplier, port } = stopPlanName(stop, names);
  if (!supplier) return <span className="font-mono text-2xs">{port}</span>;
  return (
    <>
      {supplier} at {port}
    </>
  );
}

function Readout({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs text-text-2 font-label">{term}</dt>
      <dd className="text-sm text-text-1 tabular-nums">{children}</dd>
    </div>
  );
}

function CardRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line px-2 last:border-b-0">
      <dt className="text-text-2">{term}</dt>
      <dd className="text-right text-text-1 tabular-nums">{children}</dd>
    </div>
  );
}

const STOP_ROWS: { field: StopField; term: string; kind?: "time" }[] = [
  { field: "arriveAt", term: "Arrives", kind: "time" },
  { field: "waitingHours", term: "Waiting at anchor" },
  { field: "clearanceHours", term: "Clearance" },
  { field: "weatherDelayHours", term: "Waiting for workable weather" },
  { field: "bunkeringHours", term: "Bunkering" },
  { field: "serviceHours", term: "Alongside (bunkers, stores, waste)" },
  { field: "departAt", term: "Departs", kind: "time" },
];

/** The stop card: the timeline at the port, what is bought and the fuel on board around it. */
function StopCard({
  plan,
  index,
  destination,
}: {
  plan: RoutePlanView;
  index: number;
  destination: string;
}) {
  const { facts } = plan;
  const stop = plan.result.stopPlans[index];
  if (!stop) return null;
  const t: TrackRef = { kind: "stop", index };
  const grade = stopGrade(facts, index, stop.fuel);
  const price = stopPriceFact(facts, index);
  const rob = (kind: "stop_arrival" | "stop_departure" | "end") =>
    grade ? breakpointRobFact(facts, t, stop.fuel, kind, grade) : undefined;
  return (
    <dl
      data-testid="stop-card"
      className="grid border border-line text-xs @lg:grid-cols-2 @lg:[&>div:nth-last-child(2)]:border-b-0"
    >
      {STOP_ROWS.map((r) => (
        <CardRow key={r.field} term={r.term}>
          <FactCell
            fact={stopFact(facts, index, r.field)}
            kind={r.kind}
            metric={`stop-${r.field}`}
          />
          {r.field === "weatherDelayHours" && stop.stop?.beyondForecast ? (
            <span className="block text-xs text-text-2" data-testid="beyond-forecast">
              weather beyond the forecast, counted as workable
            </span>
          ) : null}
        </CardRow>
      ))}
      <CardRow term="Buys">
        <FactCell fact={trackFact(facts, t, "qtyMt")} metric="stop-qtyMt" />
        {grade ? <span className="text-text-2"> {grade}</span> : null}
      </CardRow>
      {price ? (
        <CardRow term="Price">
          <FactCell fact={price} metric="stop-price" />
        </CardRow>
      ) : null}
      <CardRow term="Fuel bought">
        <FactCell fact={trackFact(facts, t, "bunkerFuelCostUsd")} metric="stop-bunkerFuelCostUsd" />
      </CardRow>
      <CardRow term="Barge fee">
        <FactCell fact={trackFact(facts, t, "bargeFeeUsd")} metric="stop-bargeFeeUsd" />
      </CardRow>
      {grade ? (
        <>
          <CardRow term={`${grade} on arrival`}>
            <FactCell fact={rob("stop_arrival")} metric="rob-stop_arrival" />
          </CardRow>
          <CardRow term={`${grade} after bunkering`}>
            <FactCell fact={rob("stop_departure")} metric="rob-stop_departure" />
          </CardRow>
          <CardRow term={`${grade} at ${destination}`}>
            <FactCell fact={rob("end")} metric="rob-end" />
          </CardRow>
        </>
      ) : null}
    </dl>
  );
}

/** What the plan adds against the best route ignoring fuel, and how it compares with the next. */
function AddsAndNext({ plan, names }: { plan: RoutePlanView; names?: StopNames }) {
  const { facts, result } = plan;
  const rec = result.plan;
  if (!rec) return null;
  const next = rec.next;
  const nextStop = next ? result.stopPlans.findIndex((s) => s.optionId === next.optionId) : -1;
  const nextRoute = next ? result.options.findIndex((o) => o.candidateId === next.optionId) : -1;
  const nextTotal =
    nextStop >= 0
      ? trackFact(facts, { kind: "stop", index: nextStop }, "totalCostUsd")
      : nextRoute >= 0
        ? trackFact(facts, { kind: "option", index: nextRoute }, "totalCostUsd")
        : undefined;
  const nextPlan = nextStop >= 0 ? result.stopPlans[nextStop] : undefined;
  const isBest = rec.kind === "route" && rec.optionId === result.bestCandidateId;
  return (
    <div className="flex flex-col gap-1 text-xs text-text-2">
      {isBest ? (
        <p>It is also the best route ignoring fuel on board.</p>
      ) : (
        <p data-testid="plan-adds">
          Adds{" "}
          <FactCell
            fact={planFact(facts, "addedHours")}
            metric="plan-addedHours"
            className="text-text-1"
          />{" "}
          and{" "}
          <FactCell
            fact={planFact(facts, "addedUsd")}
            metric="plan-addedUsd"
            className="text-text-1"
          />{" "}
          against the best route ignoring fuel; the fuel bought is not counted.
        </p>
      )}
      {next ? (
        <p data-testid="plan-next">
          Next feasible {nextPlan ? "quote" : "route"}:{" "}
          <span className="text-text-1">
            {nextPlan ? <StopName stop={nextPlan} names={names} /> : `route ${next.optionId}`}
          </span>
          , plan total <FactCell fact={nextTotal} metric="next-total" className="text-text-1" />.
          This plan costs{" "}
          <FactCell
            fact={planFact(facts, "next.marginUsd")}
            metric="plan-next-margin"
            className="text-text-1"
          />{" "}
          less.
        </p>
      ) : (
        <p data-testid="plan-next">
          No other {rec.kind === "stop" ? "quote" : "route"} makes the voyage work.
        </p>
      )}
    </div>
  );
}

/** Why there is no recommended plan: every quote's stop plan (or every route) with its reasons. */
function NoFeasiblePlan({ plan, names }: { plan: RoutePlanView; names?: StopNames }) {
  const { result } = plan;
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5" data-testid="no-plan">
      <h3 id={id} className="flex items-center gap-1.5 text-base font-medium text-alarm font-title">
        <StateFlag kind="V" />
        No feasible plan
      </h3>
      <ul className="flex flex-col gap-1 text-xs text-text-2">
        {result.stopPlans.length > 0
          ? result.stopPlans.map((s) => (
              <li key={s.optionId} data-testid={`stop-reasons-${s.optionId}`}>
                <span className="text-text-1">
                  <StopName stop={s} names={names} />
                </span>
                : {s.reasons.length > 0 ? s.reasons.map(stopReasonText).join("; ") : "feasible"}
              </li>
            ))
          : result.options.map((o) => (
              <li key={o.candidateId}>
                <span className="text-text-1">Route {o.candidateId}</span>:{" "}
                {o.reasons.length > 0
                  ? o.reasons.map((r) => reasonText(r).replace(/^Blocked: /, "")).join("; ")
                  : "feasible"}
              </li>
            ))}
      </ul>
    </section>
  );
}

export function PlanSummary({
  plan,
  names,
  security,
}: {
  plan: RoutePlanView;
  names?: StopNames;
  /** Each security quote's team and each danger area's name (Track 3). */
  security?: SecurityNames;
}) {
  const id = useId();
  const titleId = useId();
  if (!knowsFuel(plan)) return null;
  const { facts, result } = plan;
  const track = recommendedTrack(plan);
  if (!result.plan || !track) return <NoFeasiblePlan plan={plan} names={names} />;
  const stop = track.kind === "stop" ? result.stopPlans[track.index] : undefined;
  const option = track.kind === "option" ? result.options[track.index] : undefined;
  const candidate = option ? plan.candidates.find((c) => c.id === option.candidateId) : undefined;
  const name = stop ? stopPlanName(stop, names) : null;
  return (
    <section
      aria-labelledby={`${id} ${titleId}`}
      className="flex flex-col gap-2.5"
      data-testid="plan-summary"
    >
      <div className="flex flex-col gap-0.5">
        <p id={id} className="flex items-center gap-2 text-2xs font-medium text-beacon font-label">
          <span aria-hidden className="inline-block w-5 border-t-2 border-beacon" />
          Recommended plan
        </p>
        <h3
          id={titleId}
          className="text-base font-medium text-text-1 font-title"
          data-testid="plan-title"
        >
          {name ? (
            <>
              Call at {name.supplier ? name.port : <span className="font-mono">{name.port}</span>}{" "}
              for bunkers
              {name.supplier ? (
                <span className="text-text-2">, {possessive(name.supplier)} quote</span>
              ) : null}
            </>
          ) : (
            <>
              Route {option?.candidateId}
              {candidate ? <span className="text-text-2">, {candidate.label}</span> : null}
            </>
          )}
        </h3>
      </div>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 @md:grid-cols-4">
        <Readout term="Speed">
          <FactCell fact={trackFact(facts, track, "speedKn")} metric="plan-speedKn" />
        </Readout>
        <Readout term={`ETA at ${plan.destination}`}>
          <FactCell fact={trackFact(facts, track, "eta")} kind="time" metric="plan-eta" />
        </Readout>
        <Readout term="Berth window closes">
          <FactCell fact={dbFact(facts, ARRIVE_BY_FIELD)} kind="time" metric="plan-arriveBy" />
        </Readout>
        <Readout term={stop ? "Plan total, fuel bought included" : "Plan total"}>
          <FactCell fact={trackFact(facts, track, "totalCostUsd")} metric="plan-totalCostUsd" />
        </Readout>
      </dl>
      {/* The decision sits with the headline, in view as the tray opens; the detail follows. */}
      <ProposeFromPlan
        calculationId={plan.calculationId}
        plan={result.plan}
        securityTeam={
          result.plan.kind === "route"
            ? result.options.some(
                (o) => o.candidateId === result.plan?.optionId && o.security?.quoteId != null,
              )
            : result.stopPlans.some(
                (s) => s.optionId === result.plan?.optionId && s.security?.quoteId != null,
              )
        }
      />
      <AddsAndNext plan={plan} names={names} />
      {stop ? <StopCard plan={plan} index={track.index} destination={plan.destination} /> : null}
      {stop ? (
        <PortCallBlock plan={plan} index={track.index} destination={plan.destination} />
      ) : null}
      {stop ? <SecurityBlock plan={plan} index={track.index} names={security} kind="stop" /> : null}
    </section>
  );
}

/** "Runs short of LSMGO": where a grade first falls below its margin, and where it runs dry. */
function ShortOf({ plan, grade }: { plan: RoutePlanView; grade: FuelGrade }) {
  const best = fuelBlindBest(plan);
  if (!best) return null;
  const { facts } = plan;
  const fuel = plan.result.options[best.index]?.fuel ?? null;
  const at = gradeCheckFact(facts, best, grade, "belowMarginAt.at");
  const dry = fuel?.grades[grade].runsDryAt
    ? gradeCheckFact(facts, best, grade, "runsDryAt.nm")
    : null;
  return (
    <li className="flex flex-col gap-0.5" data-testid={`runs-short-${grade}`}>
      <span className="flex items-center gap-1.5 font-medium text-alarm">
        <StateFlag kind="V" />
        Runs short of {grade}
      </span>
      <span className="pl-5 text-text-2">
        Below its margin{" "}
        <FactCell
          fact={gradeCheckFact(facts, best, grade, "belowMarginAt.nm")}
          metric={`short-${grade}-nm`}
          className="text-text-1"
        />{" "}
        into the route
        {at ? (
          <>
            , <FactCell fact={at} kind="time" className="text-text-1" />
          </>
        ) : null}
        {dry !== null ? (
          <>
            ; runs dry at <FactCell fact={dry} metric={`dry-${grade}-nm`} className="text-text-1" />
          </>
        ) : null}
        .
      </span>
    </li>
  );
}

export function FuelBlindBest({ plan }: { plan: RoutePlanView }) {
  const id = useId();
  const titleId = useId();
  if (!knowsFuel(plan)) return null;
  const best = fuelBlindBest(plan);
  const option = best ? plan.result.options[best.index] : undefined;
  if (!best || !option) return null;
  const candidate = plan.candidates.find((c) => c.id === option.candidateId);
  const short = gradesShort(option.fuel);
  const same =
    plan.result.plan?.kind === "route" && plan.result.plan.optionId === option.candidateId;
  if (same) return null;
  return (
    <section
      aria-labelledby={`${id} ${titleId}`}
      className="flex flex-col gap-1.5 text-xs"
      data-testid="fuel-blind-best-summary"
    >
      <p id={id} className="flex items-center gap-2 text-2xs font-medium text-text-2 font-label">
        <span
          aria-hidden
          className={cn(
            "inline-block w-5 border-t-2",
            short.length > 0 ? "border-dotted border-alarm" : "border-plan",
          )}
        />
        Best route ignoring fuel on board
      </p>
      <h3 id={titleId} className="text-base font-medium text-text-1 font-title">
        Route {option.candidateId}
        {candidate ? <span className="text-text-2">, {candidate.label}</span> : null}
      </h3>
      <p className="text-text-2">
        At <FactCell fact={trackFact(plan.facts, best, "speedKn")} className="text-text-1" />, total{" "}
        <FactCell fact={trackFact(plan.facts, best, "totalCostUsd")} className="text-text-1" />
      </p>
      {short.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {short.map((g) => (
            <ShortOf key={g} plan={plan} grade={g} />
          ))}
        </ul>
      ) : (
        <p className="text-text-2">Keeps every fuel margin.</p>
      )}
    </section>
  );
}
