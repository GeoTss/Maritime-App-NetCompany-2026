/**
 * Layer switches and the weather forecast slider. Weather is on from the start (the demo's first
 * step shows the wave and wind overlay); it is off, and says why, when the API has no snapshot
 * (404). Counts are animated metrics; the forecast time is the API's time for that step, written in UTC.
 */
import type { WeatherView } from "@pharos/shared";
import { type Ref, useState } from "react";
import { MetricNumber } from "@/components/metric-number";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { formatUtc } from "@/lib/format";
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
  return (
    <section
      ref={ref}
      aria-label="Map layers"
      className={cn(
        "flex w-fit max-w-full flex-col gap-1.5 rounded-sm border border-line bg-ink-900 p-1.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(LAYER_LABEL) as LayerKey[]).map((key) => {
          const disabled = key === "weather" && weatherOff;
          return (
            <Toggle
              key={key}
              size="default"
              variant="outline"
              pressed={layers[key] && !disabled}
              disabled={disabled}
              onPressedChange={(on) => onToggle(key, on)}
              title={
                disabled
                  ? "No weather snapshot is loaded, so there is no forecast to draw"
                  : undefined
              }
              data-layer={key}
              className="text-text-2 data-[state=on]:border-beacon/60 data-[state=on]:text-text-1"
            >
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
