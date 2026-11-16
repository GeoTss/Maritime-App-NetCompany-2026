/**
 * A fleet vessel: identity, fuel on board per grade, alerts, load (from a plan's facts), the
 * fuel-on-board projection and the Plan route button. Fleet records carry no `facts[]`, so their
 * numbers are animated metrics, labelled as simulated data; only a plan's numbers are fact chips.
 */
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FobProjection, RoutePlanResponse, VesselSummary } from "@pharos/shared";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ErrorState } from "@/components/error-state";
import { MetricNumber } from "@/components/metric-number";
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
function FobChart({ rob, projection }: { rob: VesselSummary["robMt"]; projection: FobProjection }) {
  const data = [
    { leg: "Now", ...rob },
    ...projection.legs.map((l) => ({ leg: `Leg ${l.index + 1}`, ...l.robAfterMt })),
  ];
  const grades = GRADES.filter((g) => data.some((d) => d[g] !== 0));
  const below = GRADES.filter((g) => projection.belowMarginAtLeg[g] !== null);
  return (
    <div className="flex flex-col gap-1.5" data-testid="fob-chart">
      <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="leg" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={36} fontSize={11} />
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
}: {
  vessel: VesselSummary;
  plan: RoutePlanResponse | null;
  planning: boolean;
  planError: unknown;
  onPlan: () => void;
  onClose: () => void;
  className?: string;
}) {
  const detail = useVesselDetail(vessel.id);
  const voyage = useVoyage(vessel.voyageId);
  const load = plan ? loadFacts(plan.facts) : null;
  const capacity = detail.data?.tankCapacityMt;

  return (
    <PanelFrame
      label="Vessel panel"
      className={className}
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
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0 text-caution"
                />
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
              <MetricNumber value={vessel.robMt[g]} unit="mt" />
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
          {voyage.data ? (
            <>
              <Field label="Voyage">
                <span className="font-mono text-2xs">{voyage.data.voyageNo}</span>,{" "}
                {voyage.data.status}
              </Field>
              <Field label="Next port ETA">
                {voyage.data.nextEta ? formatUtc(voyage.data.nextEta) : "—"}
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
          <FobChart rob={vessel.robMt} projection={detail.data.fobProjection} />
        ) : (
          <p className="text-text-2">This vessel has no voyage to project.</p>
        )}
      </Section>
    </PanelFrame>
  );
}
