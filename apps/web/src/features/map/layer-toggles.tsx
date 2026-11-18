/**
 * Layer switches and the weather forecast slider. Weather is on from the start (the demo's first
 * step shows the wave and wind overlay); it is off, and says why, when the API has no snapshot
 * (404). Counts are animated metrics; the forecast time is the API's time for that step, written in UTC.
 *
 * The strip is kept small so it does not sit over the map: the forecast time, the slider and its
 * day ticks show; the wave legend and the snapshot's source open from Legend. On a phone, or when
 * an open panel leaves the switches too little room for one row, they fold into a Layers menu.
 */
import { Layers01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { WeatherView } from "@pharos/shared";
import { type Ref, useState } from "react";
import { MetricNumber } from "@/components/metric-number";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { formatUtc, formatUtcDay } from "@/lib/format";
import { useMediaQuery } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type LayerKey = "traffic" | "fleet" | "weather" | "hazards" | "congestion";
export type LayerState = Record<LayerKey, boolean>;

export const DEFAULT_LAYERS: LayerState = {
  traffic: true,
  fleet: true,
  weather: true,
  hazards: true,
  congestion: true,
};

export const LAYER_LABEL: Record<LayerKey, string> = {
  traffic: "AIS traffic",
  fleet: "Fleet",
  weather: "Weather",
  hazards: "Hazards",
  congestion: "Port queues",
};

/** One tick per UTC day, at the first forecast step of that day, from the API's step times. */
export function dayTicks(stepTimes: readonly string[]): { index: number; label: string }[] {
  const ticks: { index: number; label: string }[] = [];
  let last = "";
  stepTimes.forEach((t, index) => {
    const label = formatUtcDay(t);
    if (label !== last) ticks.push({ index, label });
    last = label;
  });
  return ticks;
}

const WAVE_SWATCHES = ["bg-wave-0", "bg-wave-1", "bg-wave-2", "bg-wave-3"];

export type WeatherStatus = "loading" | "ready" | "none" | "error";

export function LayerToggles({
  layers,
  onToggle,
  trafficCount,
  weatherStatus,
  weather,
  step,
  onStepCommit,
  squeezed = false,
  className,
  ref,
}: {
  /** The switches have too little room for one row (a panel is open): they fold into a menu. */
  squeezed?: boolean;
  ref?: Ref<HTMLElement>;
  layers: LayerState;
  onToggle: (key: LayerKey, on: boolean) => void;
  trafficCount: number | null;
  weatherStatus: WeatherStatus;
  weather: WeatherView | undefined;
  step: number;
  onStepCommit: (step: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [legend, setLegend] = useState(false);
  const shown = draft ?? step;
  const weatherOff = weatherStatus === "none";
  const compact = !useMediaQuery("(min-width: 768px)", true) || squeezed;
  const noSnapshot = "No weather snapshot is loaded, so there is no forecast to draw";
  return (
    <section
      ref={ref}
      aria-label="Map layers"
      className={cn(
        "flex w-fit max-w-full flex-col gap-1.5 rounded-sm border border-line bg-ink-900 p-1.5",
        className,
      )}
    >
      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="text-text-1">
              <HugeiconsIcon icon={Layers01Icon} strokeWidth={1.75} data-icon="inline-start" />
              Layers
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.keys(LAYER_LABEL) as LayerKey[]).map((key) => {
              const disabled = key === "weather" && weatherOff;
              return (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={layers[key] && !disabled}
                  disabled={disabled}
                  onCheckedChange={(on) => onToggle(key, on === true)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {LAYER_LABEL[key]}
                  {disabled ? <span className="text-2xs text-text-3">no snapshot</span> : null}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(LAYER_LABEL) as LayerKey[]).map((key) => {
            const disabled = key === "weather" && weatherOff;
            const on = layers[key] && !disabled;
            return (
              <Toggle
                key={key}
                size="default"
                variant="outline"
                pressed={on}
                disabled={disabled}
                onPressedChange={(next) => onToggle(key, next)}
                title={disabled ? noSnapshot : undefined}
                data-layer={key}
                className={cn(
                  "data-[state=on]:border-beacon/60",
                  on ? "text-text-1" : "text-text-2",
                )}
              >
                {on ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    strokeWidth={2}
                    className="size-3 text-beacon"
                    data-testid="layer-check"
                  />
                ) : null}
                {LAYER_LABEL[key]}
                {key === "traffic" && trafficCount !== null ? (
                  <span className="text-text-2">
                    <MetricNumber value={trafficCount} unit={null} />
                  </span>
                ) : null}
                {disabled ? <span className="text-2xs text-text-3">no snapshot</span> : null}
              </Toggle>
            );
          })}
        </div>
      )}

      {layers.weather && !weatherOff ? (
        <Collapsible
          open={legend}
          onOpenChange={setLegend}
          className="flex flex-col gap-1 px-1 pb-0.5"
          data-testid="weather-controls"
        >
          {weather ? (
            <>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-2">Forecast</span>
                <span data-testid="forecast-time" className="text-text-1">
                  {weather.stepTimes[shown] ? formatUtc(weather.stepTimes[shown]) : "—"}
                </span>
                {/* The legend and the snapshot explain the layer; they open on request. */}
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="xs" className="ml-auto text-text-2">
                    {legend ? "Hide legend" : "Legend"}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <Slider
                aria-label="Forecast step"
                thumbProps={{
                  "aria-label": "Wave forecast time",
                  "aria-valuetext": weather.stepTimes[shown]
                    ? formatUtc(weather.stepTimes[shown])
                    : undefined,
                }}
                min={0}
                max={Math.max(weather.steps - 1, 0)}
                step={1}
                value={[shown]}
                onValueChange={([v]) => setDraft(v ?? 0)}
                onValueCommit={([v]) => {
                  setDraft(null);
                  onStepCommit(v ?? 0);
                }}
              />
              <div className="relative h-3.5 text-2xs text-text-3" data-testid="day-ticks">
                {(() => {
                  const ticks = dayTicks(weather.stepTimes);
                  // The first and last day are labelled, at the two ends, so the labels fit at any
                  // width; each day between keeps a small tick so no day disappears.
                  return ticks.map((t, i) => {
                    const first = i === 0;
                    const last = i === ticks.length - 1;
                    return (
                      <span
                        key={t.index}
                        className={cn(
                          "absolute top-0 whitespace-nowrap",
                          first ? "" : last ? "-translate-x-full" : "-translate-x-1/2",
                        )}
                        style={{ left: `${(t.index / Math.max(weather.steps - 1, 1)) * 100}%` }}
                      >
                        {first || last ? (
                          t.label
                        ) : (
                          <i aria-hidden className="block h-1 w-px bg-text-3" />
                        )}
                      </span>
                    );
                  });
                })()}
              </div>
              <CollapsibleContent className="flex flex-col gap-1 pt-0.5">
                <div
                  className="flex items-center gap-2 text-2xs text-text-2"
                  data-testid="wave-legend"
                >
                  <span>Wave height</span>
                  <span aria-hidden className="flex">
                    {WAVE_SWATCHES.map((c) => (
                      <i key={c} className={cn("h-2 w-4 border border-line", c)} />
                    ))}
                  </span>
                  <span>0 to 3+ m</span>
                </div>
                <div className="text-2xs text-text-3">
                  Dot size: wave height. Tick: direction the waves travel.
                </div>
                <div className="text-2xs text-text-3">
                  Snapshot {weather.snapshotId}, {weather.source}, fetched{" "}
                  {formatUtc(weather.fetchedAt)}
                </div>
              </CollapsibleContent>
            </>
          ) : (
            <span className="text-xs text-text-2">
              {weatherStatus === "error" ? "Weather could not be loaded." : "Loading forecast…"}
            </span>
          )}
        </Collapsible>
      ) : null}
    </section>
  );
}
