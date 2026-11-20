/**
 * Port markers: a dot on the port and, beside it, ships at anchor and waiting hours (animated
 * metrics) with what the figure is: "simulated" for a seeded demo figure, or the AIS source's mode
 * ("recorded" or "live") for one counted from AIS positions. The label moves left of the port near
 * the right edge of the visible map.
 */
import type { PortCongestionList, PortList, SourceMode } from "@pharos/shared";
import { Marker } from "react-map-gl/maplibre";
import { MetricNumber } from "@/components/metric-number";
import { formatDigits, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LABEL_PRIORITY, useFlipLabel } from "./map-labels";

type Congestion = PortCongestionList["items"][number];

/** What the port's figure is, in the words the source badges use. */
export function congestionSourceText(source: Congestion["source"], aisMode: SourceMode | null) {
  if (source === "seed") return "simulated";
  return aisMode ?? "AIS";
}

function PortLabel({
  c,
  position,
  compact,
  aisMode,
}: {
  c: Congestion;
  position: { lat: number; lon: number };
  compact: boolean;
  aisMode: SourceMode | null;
}) {
  const { ref, flip, offscreen } = useFlipLabel<HTMLDivElement>(position.lon, position.lat, 6);
  return (
    <Marker longitude={position.lon} latitude={position.lat} anchor="center">
      <div className="group relative size-0">
        <span
          aria-hidden
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-2"
        />
        {/* Zoomed out the label waits for a hover or focus on the port, so the map stays clear;
            the port's figures are always in its accessible name. */}
        <span
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus reveals the label, as hover does.
          tabIndex={0}
          aria-label={`${c.portName}: ${formatDigits(c.anchoredCount, null)} ships at anchor, ${formatDigits(c.waitingHours, "h")} hours wait`}
          title={`${c.portName}: observed ${formatUtc(c.observedAt)}`}
          className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-beacon/60"
        />
        <div
          ref={ref}
          aria-hidden
          data-testid={`port-${c.unlocode}`}
          data-label-side={flip ? "left" : "right"}
          data-map-label={LABEL_PRIORITY.port}
          className={cn(
            "pointer-events-none absolute top-0 flex w-max -translate-y-1/2 flex-col rounded-sm border border-line bg-ink-950/85 px-1.5 py-1 text-xs data-decluttered:invisible",
            flip ? "right-1.5" : "left-1.5",
            offscreen && "invisible",
            compact && "invisible group-focus-within:visible group-hover:visible",
          )}
        >
          <span className="flex items-center gap-1.5 text-text-1">
            {c.portName}
            {compact ? (
              <span className="text-text-2">
                <MetricNumber value={c.anchoredCount} unit={null} />
                {" / "}
                <MetricNumber value={c.waitingHours} unit="h" />
              </span>
            ) : null}
          </span>
          {compact ? null : (
            <span className="flex items-baseline gap-1.5 text-text-2">
              <span>
                <MetricNumber value={c.anchoredCount} unit={null} /> at anchor
              </span>
              <span aria-hidden>·</span>
              <span>
                <MetricNumber value={c.waitingHours} unit="h" /> wait
              </span>
              <span
                data-testid="congestion-source"
                className="text-2xs text-text-3"
                title={
                  c.source === "ais"
                    ? "Counted from AIS positions near the port"
                    : "Seeded demo figure, not counted from AIS"
                }
              >
                {congestionSourceText(c.source, aisMode)}
              </span>
            </span>
          )}
        </div>
      </div>
    </Marker>
  );
}

export function CongestionLayer({
  congestion,
  ports,
  compact,
  aisMode,
}: {
  congestion: PortCongestionList["items"];
  ports: PortList["items"];
  /** One line per port (name, ships at anchor, waiting hours) when the map is zoomed out. */
  compact: boolean;
  /** The AIS source's mode, for figures counted from AIS; null until the API says. */
  aisMode: SourceMode | null;
}) {
  return (
    <>
      {congestion.map((c) => {
        const port = ports.find((p) => p.id === c.portId);
        if (!port) return null;
        return (
          <PortLabel
            key={c.portId}
            c={c}
            position={port.position}
            compact={compact}
            aisMode={aisMode}
          />
        );
      })}
    </>
  );
}
