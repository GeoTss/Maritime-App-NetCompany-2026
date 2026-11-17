/**
 * A fleet vessel: identity, fuel on board per grade, alerts, load (from a plan's facts), the
 * fuel-on-board projection and the Plan route button. The vessel detail carries `facts`: fuel on
 * board, voyage, next port and its ETA are fact chips (cited, never animated). While the detail
 * is pending each of those six values is a skeleton, so no uncited number shows first. Once
 * loaded, fuel on board falls back to the plain fleet-record value under the "simulated data" tag
 * only when its fact is null; next port and its ETA read "—" when their facts are null (the
 * voyage view's own "next" rule differs, so it is not used); the UI derives nothing.
 */
import type { FobProjection, RoutePlanView, VesselDetail, VesselSummary } from "@pharos/shared";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ErrorState } from "@/components/error-state";
import { StateFlag } from "@/components/primitives/state-flag";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/lib/api";
import { formatNumber, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useVesselDetail, useVoyage } from "./map-data";
import { Field, PanelFrame, Section } from "./panel-frame";
import { loadFacts } from "./route-facts";
import { FactCell } from "./route-tray";

const GRADES = ["LSMGO", "VLSFO", "HSFO"] as const;

const ALERT_TEXT: Record<string, string> = {
  lsmgo_below_margin_for_eca:
    "Low-sulphur fuel (LSMGO) would fall below the safety margin before leaving the emission control area",
};

/** Machine flag to a sentence: known flags are worded, unknown ones are made readable. */
export function alertText(flag: string): string {
  return ALERT_TEXT[flag] ?? flag.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Beacon is for what you can act on, so no series uses it. LSMGO, the grade the alert is about,
 * keeps the caution hue; VLSFO is slate; HSFO is hint text drawn dashed so it stays apart.
 */
const chartConfig = {
  LSMGO: { label: "LSMGO", color: "var(--chart-4)" },
  VLSFO: { label: "VLSFO", color: "var(--plan)" },
  HSFO: { label: "HSFO", color: "var(--text-3)" },
} satisfies ChartConfig;
const DASHED: Partial<Record<(typeof GRADES)[number], string>> = { HSFO: "4 3" };

/** Fuel on board after each leg, as the projection returned it; no value is derived here. */
function FobChart({
  rob,
  projection,
  capacity,
}: {
  rob: VesselSummary["robMt"];
  projection: FobProjection;
  capacity: VesselDetail["tankCapacityMt"] | undefined;
}) {
  const data = [
    { leg: "Now", ...rob },
    ...projection.legs.map((l) => ({ leg: `Leg ${l.index + 1}`, ...l.robAfterMt })),
  ];
  const grades = GRADES.filter((g) => data.some((d) => d[g] !== 0));
  const below = GRADES.filter((g) => projection.belowMarginAtLeg[g] !== null);
  // Axis: zero and each shown grade's tank capacity, as the API returned it.
  const caps = capacity ? grades.map((g) => capacity[g]).filter((c) => c > 0) : [];
  const ticks = caps.length > 0 ? [...new Set([0, ...caps])].sort((a, b) => a - b) : undefined;
  // The safety-margin line, from the projection's margin, for the grades drawn.
  const margins = grades.filter((g) => projection.safetyMarginMt[g] > 0);
  return (
    <div className="flex flex-col gap-1.5" data-testid="fob-chart">
      <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="leg" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={36}
            fontSize={11}
            ticks={ticks}
            domain={ticks ? [0, ticks[ticks.length - 1] ?? 0] : undefined}
          />
          {margins.map((g) => (
            <ReferenceLine
              key={`margin-${g}`}
              y={projection.safetyMarginMt[g]}
              stroke={`var(--color-${g})`}
              strokeDasharray="2 3"
              strokeOpacity={0.7}
              data-testid={`margin-line-${g}`}
            />
          ))}
          <ChartTooltip content={<ChartTooltipContent />} />
          {grades.map((g) => (
            <Line
              key={g}
              dataKey={g}
              type="linear"
              stroke={`var(--color-${g})`}
              strokeWidth={1.5}
              strokeDasharray={DASHED[g]}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-text-2">
        {grades.map((g) => (
          <li key={g} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("inline-block w-3 border-t-2", DASHED[g] && "border-dashed")}
              style={{ borderColor: `var(--color-${g})` }}
            />
            {g}
          </li>
        ))}
        <li className="text-text-3">Tonnes on board after each leg</li>
        {margins.length > 0 ? <li className="text-text-3">Dotted line: safety margin</li> : null}
      </ul>
      {below.length > 0 ? (
        <p className="text-caution">
          {below
            .map(
              (g) =>
                `${g} drops below the safety margin at leg ${(projection.belowMarginAtLeg[g] ?? 0) + 1}`,
            )
            .join("; ")}
          .
        </p>
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

      <Section title="Fuel on board to destination">
        {detail.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : detail.isError ? (
          <ErrorState
            error={detail.error}
            title="The projection could not be loaded"
            className="p-0"
          />
        ) : detail.data.fobProjection ? (
          <FobChart
            rob={vessel.robMt}
            projection={detail.data.fobProjection}
            capacity={detail.data.tankCapacityMt}
          />
        ) : (
          <p className="text-text-2">This vessel has no voyage to project.</p>
        )}
      </Section>
    </PanelFrame>
  );
}
