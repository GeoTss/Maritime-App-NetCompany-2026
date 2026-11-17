/**
 * Layer switches and the weather forecast slider. Weather is on from the start (the demo's first
 * step shows the wave and wind overlay); it is off, and says why, when the API has no snapshot
 * (404). Counts are animated metrics; the forecast time is the API's time for that step, written in UTC.
 */
import { Layers01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { WeatherView } from "@pharos/shared";
import { type Ref, useState } from "react";
import { MetricNumber } from "@/components/metric-number";
import { Button } from "@/components/ui/button";
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
  className,
  ref,
}: {
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
  const shown = draft ?? step;
  const weatherOff = weatherStatus === "none";
  const compact = !useMediaQuery("(min-width: 768px)", true);
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
        <div className="flex flex-col gap-1 px-1 pb-0.5" data-testid="weather-controls">
          {weather ? (
            <>
              <div className="flex items-baseline justify-between gap-4 text-xs">
                <span className="text-text-2">Forecast for</span>
                <span data-testid="forecast-time" className="text-text-1">
                  {weather.stepTimes[shown] ? formatUtc(weather.stepTimes[shown]) : "—"}
                </span>
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
              <div className="relative h-4 text-2xs text-text-3" data-testid="day-ticks">
                {dayTicks(weather.stepTimes).map((t) => (
                  <span
                    key={t.index}
                    className="absolute top-0 -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
                    style={{ left: `${(t.index / Math.max(weather.steps - 1, 1)) * 100}%` }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
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
              <div className="flex items-baseline justify-between gap-4 text-2xs text-text-3">
                <span>Dot size: wave height. Tick: direction the waves travel.</span>
              </div>
              <div className="text-2xs text-text-3">
                Snapshot {weather.snapshotId}, {weather.source}, fetched{" "}
                {formatUtc(weather.fetchedAt)}
              </div>
            </>
          ) : (
            <span className="text-xs text-text-2">
              {weatherStatus === "error" ? "Weather could not be loaded." : "Loading forecast…"}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
