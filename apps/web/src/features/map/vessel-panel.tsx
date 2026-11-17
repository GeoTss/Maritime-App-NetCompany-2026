/**
 * A fleet vessel: identity, fuel on board per grade, alerts, load (from a plan's facts), its fuel
 * on board along the current plan and the Plan route button. The vessel detail carries `facts`:
 * fuel on board, voyage, next port and its ETA are fact chips (cited, never animated). While the
 * detail is pending each of those six values is a skeleton, so no uncited number shows first. Once
 * loaded, fuel on board falls back to the plain fleet-record value under the "simulated data" tag
 * only when its fact is null; next port and its ETA read "—" when their facts are null (the
 * voyage view's own "next" rule differs, so it is not used); the UI derives nothing.
 */
import type { FuelGrade, RoutePlanView, TrackFuel, VesselSummary } from "@pharos/shared";
import { ErrorState } from "@/components/error-state";
import { StateFlag } from "@/components/primitives/state-flag";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import type { ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/lib/api";
import { formatNumber, formatUtc } from "@/lib/format";
import { FactCell } from "./fact-cell";
import { type CurveSeries, type DrawnTrack, GradePlot, gradesBurned } from "./fuel-curve";
import { useVesselDetail, useVoyage } from "./map-data";
import { Field, PanelFrame, Section } from "./panel-frame";
import { loadFacts } from "./route-facts";

const GRADES = ["LSMGO", "VLSFO", "HSFO"] as const;

const ALERT_TEXT: Record<string, string> = {
  lsmgo_below_margin_for_eca:
    "Low-sulphur fuel (LSMGO) would fall below the safety margin before leaving the emission control area",
  lsmgo_runs_out: "LSMGO runs out before arrival at the planned speed",
};

/** Machine flag to a sentence: known flags are worded, unknown ones are made readable. */
export function alertText(flag: string): string {
  return ALERT_TEXT[flag] ?? flag.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The current plan is the baseline: slate, one solid line per grade. */
const CURRENT_PLAN: CurveSeries = {
  key: "current",
  name: "Current plan",
  stroke: "var(--plan)",
  strokeWidth: 1.5,
  isAnimationActive: false,
};
const currentPlanConfig = {
  current: { label: "Current plan", color: "var(--plan)" },
} satisfies ChartConfig;

/**
 * Where a grade falls below its margin and runs out, as the calculation returned it: "LSMGO falls
 * below its margin 1,483 nm along the current plan and runs out at 3,118 nm." Null when it keeps
 * its margin.
 */
export function shortText(grade: FuelGrade, fuel: TrackFuel): string | null {
  const { belowMarginAt: below, runsDryAt: dry } = fuel.grades[grade];
  if (below) {
    const out = dry ? ` and runs out at ${formatNumber(dry.nm, "nm")}` : "";
    return `${grade} falls below its margin ${formatNumber(below.nm, "nm")} along the current plan${out}.`;
  }
  return dry ? `${grade} runs out ${formatNumber(dry.nm, "nm")} along the current plan.` : null;
}

/**
 * Fuel on board along the rest of the current plan at the planned speed, one small chart per grade
 * burned: the one fuel calculation the alert above reads, drawn straight between its breakpoints,
 * with each grade's safety margin and the first point below it. Static: no animation, no tooltip.
 */
export function CurrentPlanFuel({ fuel }: { fuel: TrackFuel }) {
  const tracks: DrawnTrack[] = [{ key: CURRENT_PLAN.key, fuel }];
  const grades = gradesBurned(tracks);
  const short = grades.flatMap((g) => shortText(g, fuel) ?? []);
  const anyBelow = grades.some((g) => fuel.grades[g].belowMarginAt !== null);
  return (
    <div className="flex flex-col gap-2" data-testid="current-plan-fuel">
      {grades.map((g) => {
        const { marginMt, belowMarginAt, runsDryAt } = fuel.grades[g];
        return (
          <figure key={g} className="flex min-w-0 flex-col gap-0.5" data-testid={`plan-fuel-${g}`}>
            <figcaption className="text-2xs font-medium text-text-1">{g} on board, t</figcaption>
            <GradePlot
              grade={g}
              tracks={tracks}
              series={[CURRENT_PLAN]}
              config={currentPlanConfig}
              margin={marginMt}
              below={belowMarginAt}
              zeroLine={runsDryAt !== null}
              className="h-24"
              label={`${g} on board in tonnes over nautical miles from now, along the current plan${marginMt > 0 ? ", with the safety margin" : ""}${belowMarginAt ? ", where it first falls below it" : ""}${runsDryAt ? ", and the empty tank" : ""}.`}
            />
          </figure>
        );
      })}
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-text-2">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-3 border-t-2 border-plan" />
          current plan, planned speed
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-3 border-t border-dashed border-text-3" />
          safety margin
        </li>
        {anyBelow ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rounded-full bg-alarm" />
            first below the margin
          </li>
        ) : null}
      </ul>
      {short.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-text-1" data-testid="plan-fuel-short">
          {short.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : fuel.keepsMargins ? (
        <p className="text-text-2">Every grade keeps its safety margin to the destination.</p>
      ) : null}
    </div>
  );
}

export function VesselPanel({
  vessel,
  plan,
  planning,
  planError,
  onPlan,
  onClose,
  className,
  fold,
}: {
  vessel: VesselSummary;
  plan: RoutePlanView | null;
  planning: boolean;
  planError: unknown;
  onPlan: () => void;
  onClose: () => void;
  className?: string;
  /** Folds the panel to its header row (while the route tray is open on a wide screen). */
  fold?: { folded: boolean; onFoldedChange: (folded: boolean) => void };
}) {
  const detail = useVesselDetail(vessel.id);
  const voyage = useVoyage(vessel.voyageId);
  const load = plan ? loadFacts(plan.facts) : null;
  const capacity = detail.data?.tankCapacityMt;
  const facts = detail.data?.facts;
  const robFacts = facts?.robMt ?? null;

  return (
    <PanelFrame
      label="Vessel panel"
      className={className}
      fold={fold}
      onClose={onClose}
      title={vessel.name}
      subtitle={
        <span className="flex flex-wrap gap-x-2">
          <span>
            IMO <span className="font-mono text-2xs">{vessel.imo}</span>
          </span>
          <span>
            MMSI <span className="font-mono text-2xs">{vessel.mmsi}</span>
          </span>
          <span>{vessel.shipType.replace(/_/g, " ")}</span>
        </span>
      }
      footer={
        <>
          <Button type="button" size="lg" onClick={onPlan} disabled={planning} aria-busy={planning}>
            {planning ? "Planning…" : plan ? "Plan route again" : "Plan route"}
          </Button>
          <p className="text-2xs text-text-3">
            Compares routes and speeds with the weather forecast. Stores the calculation; nothing is
            sent or changed.
          </p>
          {planError ? (
            <p role="alert" className="text-alarm">
              {describeFailure(planError)}
            </p>
          ) : null}
        </>
      }
      tags={<DataTag kind="simulated" />}
    >
      {vessel.alerts.length > 0 ? (
        <Section title="Alerts">
          <ul className="flex flex-col gap-1" data-testid="vessel-alerts">
            {vessel.alerts.map((a) => (
              <li key={a} className="flex items-start gap-1.5 text-text-1">
                <StateFlag kind="V" className="mt-1" />
                <span>{alertText(a)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Fuel on board">
        <dl className="flex flex-col gap-1">
          {GRADES.map((g) => (
            <Field key={g} label={g}>
              {detail.isPending ? (
                <Skeleton className="inline-block h-3.5 w-16 align-middle" />
              ) : robFacts ? (
                <FactCell fact={robFacts[g]} />
              ) : (
                <span>{formatNumber(vessel.robMt[g], "mt")}</span>
              )}
              {capacity && capacity[g] > 0 ? (
                <span className="text-text-3"> of {formatNumber(capacity[g], "mt")}</span>
              ) : null}
            </Field>
          ))}
        </dl>
      </Section>

      <Section title="Position">
        <dl className="flex flex-col gap-1">
          <Field label="Last fix">
            {vessel.position ? (
              <span className="font-mono text-2xs">
                {vessel.position.lat.toFixed(3)}, {vessel.position.lon.toFixed(3)}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Reported at">
            {vessel.positionAt ? formatUtc(vessel.positionAt) : "—"}
          </Field>
          {detail.isPending || voyage.data ? (
            <>
              <Field label="Voyage">
                {detail.isPending ? (
                  <Skeleton className="inline-block h-3.5 w-16 align-middle" />
                ) : (
                  <>
                    {facts?.voyageNo ? (
                      <FactCell fact={facts.voyageNo} />
                    ) : (
                      <span className="font-mono text-2xs">{voyage.data?.voyageNo}</span>
                    )}
                    {voyage.data ? `, ${voyage.data.status}` : null}
                  </>
                )}
              </Field>
              <Field label="Next port">
                {detail.isPending ? (
                  <Skeleton className="inline-block h-3.5 w-20 align-middle" />
                ) : facts?.nextPort ? (
                  <FactCell fact={facts.nextPort} />
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Next port ETA">
                {detail.isPending ? (
                  <Skeleton className="inline-block h-3.5 w-28 align-middle" />
                ) : facts?.nextPortEta ? (
                  <FactCell fact={facts.nextPortEta} kind="time" />
                ) : (
                  "—"
                )}
              </Field>
            </>
          ) : null}
        </dl>
      </Section>

      <Section title="Load condition">
        {plan && load ? (
          <dl className="flex flex-col gap-1" data-testid="vessel-load">
            <Field label="Displacement">
              <FactCell fact={load.displacement} />
            </Field>
            <Field label="Load factor">
              <FactCell fact={load.loadFactor} />
            </Field>
            <Field label="Load condition">
              <FactCell fact={load.loadCondition} />
            </Field>
          </dl>
        ) : (
          <p className="text-text-2">Shown, with its source, once you plan a route.</p>
        )}
      </Section>

      <Section title="Fuel on board along the current plan">
        {detail.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : detail.isError ? (
          <ErrorState
            error={detail.error}
            title="The fuel on board along the plan could not be loaded"
            className="p-0"
          />
        ) : detail.data.fuelTrack ? (
          <CurrentPlanFuel fuel={detail.data.fuelTrack} />
        ) : (
          <p className="text-text-2">This vessel has no voyage to project.</p>
        )}
      </Section>
    </PanelFrame>
  );
}
