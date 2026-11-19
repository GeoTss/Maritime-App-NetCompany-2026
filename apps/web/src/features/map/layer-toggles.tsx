/**
 * Layer switches and the weather forecast slider. Waves are on from the start, wind is one switch
 * away (both draw from the one snapshot); both are off, and say why, when the API has no snapshot
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

export type LayerKey =
  | "traffic"
  | "fleet"
  | "waves"
  | "wind"
  | "hazards"
  | "security"
  | "congestion";
export type LayerState = Record<LayerKey, boolean>;

export const DEFAULT_LAYERS: LayerState = {
  traffic: true,
  fleet: true,
  waves: true,
  wind: false,
  hazards: true,
  security: true,
  congestion: true,
};

export const LAYER_LABEL: Record<LayerKey, string> = {
  traffic: "AIS traffic",
  fleet: "Fleet",
  waves: "Waves",
  wind: "Wind",
  hazards: "Hazards",
  security: "Danger areas",
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

/** Both weather switches draw from the one forecast snapshot. */
const isWeather = (key: LayerKey) => key === "waves" || key === "wind";

/** Legend samples: the dart at a few points of each drawing scale (sizes as in `weather-layer`). */
const WAVE_SAMPLES = [
  { label: "0", size: 0.45, tone: "text-wave-dart-0" },
  { label: "2", size: 0.65, tone: "text-wave-dart-1" },
  { label: "4", size: 0.9, tone: "text-wave-dart-3" },
] as const;
const WIND_SAMPLES = [
  { label: "0", size: 0.4, tone: "text-wind-0" },
  { label: "10", size: 0.55, tone: "text-wind-1" },
  { label: "20", size: 0.75, tone: "text-wind-2" },
  { label: "34+", size: 0.95, tone: "text-wind-3" },
] as const;

function DartSample({ kind, size, tone }: { kind: "wave" | "wind"; size: number; tone: string }) {
  const px = Math.round(22 * size);
  return (
    <svg
      aria-hidden
      viewBox="0 0 48 48"
      width={px}
      height={px}
      className={cn("fill-current", tone)}
    >
      {kind === "wave" ? (
        <path d="M24 7 L40 38 L24 30 L8 38 Z" strokeLinejoin="round" />
      ) : (
        <path d="M24 4 L31 34 L24 44 L17 34 Z" />
      )}
    </svg>
  );
}

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
              const disabled = isWeather(key) && weatherOff;
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
            const disabled = isWeather(key) && weatherOff;
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

      {(layers.waves || layers.wind) && !weatherOff ? (
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
                  "aria-label": "Weather forecast time",
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
                  <span className="w-16">Waves, m</span>
                  {WAVE_SAMPLES.map((d) => (
                    <span key={d.label} className="flex items-center gap-0.5">
                      <DartSample kind="wave" size={d.size} tone={d.tone} />
                      {d.label}
                    </span>
                  ))}
                  <span className="flex items-center gap-0.5">
                    <DartSample kind="wave" size={1.15} tone="text-storm" />
                    {weather.heavyWeatherWaveM}+ (heavy weather)
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 text-2xs text-text-2"
                  data-testid="wind-legend"
                >
                  <span className="w-16">Wind, kn</span>
                  {WIND_SAMPLES.map((d) => (
                    <span key={d.label} className="flex items-center gap-0.5">
                      <DartSample kind="wind" size={d.size} tone={d.tone} />
                      {d.label}
                    </span>
                  ))}
                </div>
                <div className="text-2xs text-text-3">
                  Each dart points the way the waves or the wind travel; bigger and brighter is
                  stronger.
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
