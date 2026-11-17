/**
 * A stored bunker plan on the map: every option's port as a ring, with a label plate reading
 * "<rank> · <supplier>, <port>" over the option's total (and delay) as fact chips. The recommended
 * option is ringed in the recommended tone, the others in plan slate, an infeasible one in alarm.
 * Rings and plates are HTML markers (the basemap has no glyphs), like every map label.
 *
 * Ports drawn on top of each other (Gibraltar and Algeciras, a few kilometres apart, at most zooms)
 * share one ring and one plate, the options stacked in rank order; zoomed in far enough, they part.
 * That grouping is display geometry, measured in screen pixels; nothing here computes a number.
 */
import type { BunkerOptionView, BunkerPlanView, VesselSummary } from "@pharos/shared";
import { useEffect, useState } from "react";
import { Marker, useMap } from "react-map-gl/maplibre";
import { FactChip } from "@/components/fact-chip";
import { cn } from "@/lib/utils";
import { useFlipLabel } from "./map-labels";

/** Two ports closer than this on screen share one ring and plate (the ring is 26 px across). */
const STACK_PX = 28;
/** From the port to the plate's near edge: the ring's radius and a gap. */
const PLATE_OFFSET_PX = 17;

type Point = { x: number; y: number };
type Project = (lon: number, lat: number) => Point;

/** Options sharing one ring and plate, drawn at the first (best-ranked) one's port. */
export interface PortStack {
  anchor: BunkerOptionView;
  options: BunkerOptionView[];
}

/**
 * Groups the options (in the plan's rank order) whose ports are drawn within `STACK_PX` of a
 * group's first port. Without a map to project with, only identical positions group.
 */
export function stackOptions(options: readonly BunkerOptionView[], project?: Project): PortStack[] {
  const stacks: { at: Point | null; stack: PortStack }[] = [];
  for (const option of options) {
    const { lat, lon } = option.port.position;
    const at = project ? project(lon, lat) : null;
    const hit = stacks.find(({ at: other, stack }) =>
      at && other
        ? Math.hypot(at.x - other.x, at.y - other.y) < STACK_PX
        : stack.anchor.port.position.lat === lat && stack.anchor.port.position.lon === lon,
    );
    if (hit) hit.stack.options.push(option);
    else stacks.push({ at, stack: { anchor: option, options: [option] } });
  }
  return stacks.map((s) => s.stack);
}

/** The stacks for the current view, regrouped after every pan, zoom or resize. */
function useStacks(options: readonly BunkerOptionView[]): PortStack[] {
  const { current: map } = useMap();
  const [stacks, setStacks] = useState(() =>
    stackOptions(options, map ? (lon, lat) => map.project([lon, lat]) : undefined),
  );
  useEffect(() => {
    const update = () =>
      setStacks(stackOptions(options, map ? (lon, lat) => map.project([lon, lat]) : undefined));
    update();
    if (!map) return;
    map.on("moveend", update);
    map.on("resize", update);
    return () => {
      map.off("moveend", update);
      map.off("resize", update);
    };
  }, [map, options]);
  return stacks;
}

type Tone = "recommended" | "option" | "infeasible";

const toneOf = (stack: PortStack): Tone =>
  stack.options.some((o) => o.best)
    ? "recommended"
    : stack.options.some((o) => o.feasible)
      ? "option"
      : "infeasible";

const RING: Record<Tone, string> = {
  recommended: "border-go bg-go/12",
  option: "border-plan bg-plan/10",
  infeasible: "border-dotted border-alarm",
};
const DOT: Record<Tone, string> = {
  recommended: "bg-go",
  option: "bg-plan",
  infeasible: "bg-alarm",
};

function OptionRow({ option }: { option: BunkerOptionView }) {
  return (
    <div
      data-testid={`bunker-port-${option.optionId}`}
      data-best={option.best}
      data-feasible={option.feasible}
      data-rank={option.rank}
      className="flex flex-col gap-0.5 px-2 py-1"
    >
      <span
        className={cn(
          "whitespace-nowrap",
          option.best ? "font-semibold text-go" : "font-medium text-text-1",
        )}
      >
        {option.rank} · {option.supplier}, {option.port.name}
      </span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap text-text-2">
        <FactChip fact={option.totalCost} />
        <span aria-hidden>·</span>
        <span>
          <FactChip fact={option.delay} /> delay
        </span>
        {option.feasible ? null : <span className="text-alarm">infeasible</span>}
      </span>
    </div>
  );
}

function StackMarker({ stack }: { stack: PortStack }) {
  const { lon, lat } = stack.anchor.port.position;
  const tone = toneOf(stack);
  const { ref, flip, offscreen } = useFlipLabel<HTMLDivElement>(lon, lat, PLATE_OFFSET_PX);
  const side = `${PLATE_OFFSET_PX}px`;
  return (
    <Marker
      longitude={lon}
      latitude={lat}
      anchor="center"
      style={{ zIndex: tone === "recommended" ? 5 : 4 }}
    >
      <div className="relative size-0">
        <span
          aria-hidden
          data-testid="bunker-ring"
          data-tone={tone}
          className={cn("absolute size-6.5 -translate-1/2 rounded-full border-[1.5px]", RING[tone])}
        />
        <span
          aria-hidden
          className={cn("absolute size-1.5 -translate-1/2 rounded-full", DOT[tone])}
        />
        {/* An obstacle: a port or vessel label it would cover hides instead (see map-labels). */}
        <div
          ref={ref}
          data-map-obstacle={offscreen ? undefined : ""}
          data-testid={`bunker-plate-${stack.anchor.optionId}`}
          data-label-side={flip ? "left" : "right"}
          style={flip ? { right: side } : { left: side }}
          className={cn(
            "absolute top-0 flex w-max -translate-y-1/2 flex-col divide-y divide-line rounded-sm border bg-ink-900 text-xs",
            tone === "recommended" ? "border-go" : "border-line-strong",
            offscreen && "invisible",
          )}
        >
          {stack.options.map((option) => (
            <OptionRow key={option.optionId} option={option} />
          ))}
        </div>
      </div>
    </Marker>
  );
}

export function BunkerPlanLayer({ plan }: { plan: BunkerPlanView }) {
  const stacks = useStacks(plan.options);
  return (
    <>
      {stacks.map((stack) => (
        <StackMarker key={stack.anchor.optionId} stack={stack} />
      ))}
    </>
  );
}

/** What the rings mean, beside the plan chip. `track`: the vessel's current plan is drawn too. */
export function BunkerPlanLegend({ track, className }: { track: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-sm border border-line bg-ink-900 px-2.5 py-1.5 text-xs",
        className,
      )}
    >
      <p className="text-2xs text-text-2 font-label">Ranked by total delivered cost</p>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-text-1">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-go" />
          recommended
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-plan" />
          other options
        </li>
        {track ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t-[1.5px] border-dashed border-plan" />
            current plan
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * The box that frames a bunker plan: every option's port and the plan's vessel, when it has a
 * position. Drawing geometry, not a result; null when there is nothing to frame.
 */
export function bunkerPlanBounds(
  plan: BunkerPlanView,
  vessels: readonly VesselSummary[],
): [[number, number], [number, number]] | null {
  const vessel = vessels.find((v) => v.id === plan.vesselId);
  const points = [
    ...plan.options.map((o) => o.port.position),
    ...(vessel?.position ? [vessel.position] : []),
  ];
  if (points.length === 0) return null;
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
