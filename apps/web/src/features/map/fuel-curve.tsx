/**
 * Fuel on board along the track, one small chart per grade burned: the recommended plan in beacon
 * (with the jump where the stop bunkers), the best route ignoring fuel on board dotted in alarm
 * when it runs short (slate when it keeps its margins), the safety margin as a dashed reference
 * line, and the first point the best route falls below its margin as an alarm dot.
 *
 * Drawn from the breakpoints the plan returned (start, grade changes, stop arrival and departure,
 * destination), straight between them. A static chart: never animated, no tooltip; the only
 * numbers on it are axis ticks. The margin printed under each chart is the plan's cited fact.
 * `GradePlot`, the drawing of one grade, is shared with the vessel panel's current-plan chart.
 */
import type { FuelGrade, GradeFuelCheck, RoutePlanView, TrackFuel } from "@pharos/shared";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { formatDigits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FactCell } from "./fact-cell";
import {
  fuelBlindBest,
  GRADES,
  gradeCheckFact,
  gradesShort,
  knowsFuel,
  recommendedTrack,
  type TrackRef,
  trackFuel,
} from "./route-facts";

type SeriesKey = "plan" | "best";

/** One line of a grade's chart: drawing data only, never printed. */
export interface CurveSeries {
  key: string;
  name: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  /** Always false: a cited quantity is never animated. */
  isAnimationActive: false;
}

interface Track {
  key: SeriesKey;
  ref: TrackRef;
  fuel: TrackFuel;
  short: boolean;
}

/** The tracks drawn: the recommended plan, and the best route ignoring fuel when it is another. */
export function curveTracks(plan: RoutePlanView): Track[] {
  const tracks: Track[] = [];
  const rec = recommendedTrack(plan);
  const best = fuelBlindBest(plan);
  const recFuel = rec ? trackFuel(plan, rec) : null;
  if (rec && recFuel) tracks.push({ key: "plan", ref: rec, fuel: recFuel, short: false });
  const same = rec?.kind === "option" && best?.index === rec.index;
  const bestFuel = best && !same ? trackFuel(plan, best) : null;
  if (best && bestFuel) {
    tracks.push({
      key: "best",
      ref: best,
      fuel: bestFuel,
      short: gradesShort(bestFuel).length > 0,
    });
  }
  return tracks;
}

/** A track as a grade's chart draws it: the key of its series, and its fuel on board. */
export interface DrawnTrack {
  key: string;
  fuel: TrackFuel;
}

/** The grades any drawn track burns, in grade order. */
export const gradesBurned = (tracks: readonly DrawnTrack[]): FuelGrade[] =>
  GRADES.filter((g) => tracks.some((t) => t.fuel.grades[g].neededMt > 0));

/** How each track is drawn: one meaning per colour (beacon recommended, alarm runs short). */
export function curveSeries(tracks: readonly Track[]): CurveSeries[] {
  return tracks.map((t) =>
    t.key === "plan"
      ? {
          key: "plan",
          name: "Recommended plan",
          stroke: "var(--beacon)",
          strokeWidth: 2,
          isAnimationActive: false,
        }
      : {
          key: "best",
          name: "Best route ignoring fuel on board",
          stroke: t.short ? "var(--alarm)" : "var(--plan)",
          strokeWidth: 1.5,
          strokeDasharray: t.short ? "2 3" : "5 3",
          isAnimationActive: false,
        },
  );
}

/**
 * One row per breakpoint, carrying only its own track's value, in the order returned: each line
 * reads its rows in order and steps over the other track's (a stop's arrival and departure share a
 * distance, so the jump draws as a vertical step).
 */
function rows(tracks: readonly DrawnTrack[], grade: FuelGrade) {
  return tracks.flatMap((t) =>
    t.fuel.breakpoints.map((b) => ({ nm: b.nm, [t.key]: b.robMt[grade] })),
  );
}

const config = {
  plan: { label: "Recommended plan", color: "var(--beacon)" },
  best: { label: "Best route ignoring fuel on board", color: "var(--alarm)" },
} satisfies ChartConfig;

const tick = (v: number) => formatDigits(v, "nm");

/**
 * One grade's fuel on board over the distance from now: each series straight through its track's
 * breakpoints, the safety margin (`margin` > 0) as a dashed reference line, `below`, the first
 * point under the margin, as an alarm dot, and with `zeroLine` the empty-tank line. Drawing only:
 * never animated, no tooltip; the only numbers on it are axis ticks.
 */
export function GradePlot({
  grade,
  tracks,
  series,
  config: chartConfig,
  margin,
  below,
  label,
  zeroLine = false,
  className,
}: {
  grade: FuelGrade;
  tracks: readonly DrawnTrack[];
  series: readonly CurveSeries[];
  config: ChartConfig;
  margin: number;
  below: GradeFuelCheck["belowMarginAt"];
  /** What the drawing shows, in words, for assistive technology. */
  label: string;
  /** Draws the empty tank (0 t) as a solid line, for a track that runs dry. */
  zeroLine?: boolean;
  className?: string;
}) {
  return (
    <div role="img" aria-label={label}>
      <ChartContainer config={chartConfig} className={cn("aspect-auto h-32 w-full", className)}>
        <LineChart data={rows(tracks, grade)} margin={{ left: 0, right: 10, top: 6, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            type="number"
            dataKey="nm"
            domain={[0, "dataMax"]}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={tick}
          />
          <YAxis
            type="number"
            tickLine={false}
            axisLine={false}
            width={36}
            fontSize={11}
            tickFormatter={tick}
          />
          {zeroLine ? <ReferenceLine y={0} stroke="var(--line-strong)" /> : null}
          {margin > 0 ? (
            <ReferenceLine
              y={margin}
              stroke="var(--text-3)"
              strokeDasharray="4 3"
              data-testid={`margin-line-${grade}`}
            />
          ) : null}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              type="linear"
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
              strokeDasharray={s.strokeDasharray}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={s.isAnimationActive}
            />
          ))}
          {below ? (
            <ReferenceDot
              x={below.nm}
              y={below.robMt}
              r={3.5}
              fill="var(--alarm)"
              stroke="var(--ink-950)"
              data-testid={`below-margin-${grade}`}
            />
          ) : null}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function GradeChart({
  plan,
  grade,
  tracks,
  series,
}: {
  plan: RoutePlanView;
  grade: FuelGrade;
  tracks: Track[];
  series: CurveSeries[];
}) {
  const marginTrack = tracks[0];
  const margin = marginTrack?.fuel.grades[grade].marginMt ?? 0;
  const best = tracks.find((t) => t.key === "best");
  const below = best?.fuel.grades[grade].belowMarginAt ?? null;
  const marginFact = marginTrack
    ? gradeCheckFact(plan.facts, marginTrack.ref, grade, "marginMt")
    : undefined;
  const drawn = series.map((s) => s.name.toLowerCase()).join(" and the ");
  return (
    <figure className="flex min-w-0 flex-col gap-1" data-testid={`fuel-curve-${grade}`}>
      <figcaption className="flex items-baseline justify-between gap-2 text-2xs text-text-2">
        <span className="font-medium text-text-1">{grade} on board, t</span>
        {/* The plan cites the margin of the grades it is about (the bought one, the one short). */}
        {marginFact ? (
          <span>
            Margin <FactCell fact={marginFact} metric={`margin-${grade}`} className="text-text-1" />
          </span>
        ) : null}
      </figcaption>
      <GradePlot
        grade={grade}
        tracks={tracks}
        series={series}
        config={config}
        margin={margin}
        below={below}
        label={`${grade} on board in tonnes over nautical miles from now, along the ${drawn}${margin > 0 ? ", with the safety margin" : ""}${below ? ", and where the best route ignoring fuel first falls below it" : ""}.`}
      />
    </figure>
  );
}

export function FuelCurve({ plan, className }: { plan: RoutePlanView; className?: string }) {
  if (!knowsFuel(plan)) return null;
  const tracks = curveTracks(plan);
  const grades = gradesBurned(tracks);
  if (tracks.length === 0 || grades.length === 0) return null;
  const series = curveSeries(tracks);
  const best = tracks.find((t) => t.key === "best");
  return (
    <section
      aria-label="Fuel on board along the track"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-testid="fuel-curve"
    >
      <h3 className="text-base font-medium text-text-1 font-title">
        Fuel on board along the track
      </h3>
      <div className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-1 @6xl:grid-cols-2">
        {grades.map((g) => (
          <GradeChart key={g} plan={plan} grade={g} tracks={tracks} series={series} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-2xs text-text-2">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "inline-block w-4 border-t-2",
                s.key === "plan" && "border-beacon",
                s.key === "best" &&
                  (best?.short ? "border-dotted border-alarm" : "border-dashed border-plan"),
              )}
            />
            {s.name}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t border-dashed border-text-3" />
          safety margin
        </li>
        {best?.short ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rounded-full bg-alarm" />
            first below the margin
          </li>
        ) : null}
      </ul>
    </section>
  );
}
