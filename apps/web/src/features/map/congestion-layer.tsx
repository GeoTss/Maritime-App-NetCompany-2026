/** Port markers: ships at anchor and waiting hours (animated metrics), with the data's source. */
import type { PortCongestionList, PortList } from "@pharos/shared";
import { Marker } from "react-map-gl/maplibre";
import { MetricNumber } from "@/components/metric-number";
import { formatUtcFull } from "@/lib/format";

export function CongestionLayer({
  congestion,
  ports,
  compact,
}: {
  congestion: PortCongestionList["items"];
  ports: PortList["items"];
  /** One line per port (name, ships at anchor, waiting hours) when the map is zoomed out. */
  compact: boolean;
}) {
  return (
    <>
      {congestion.map((c) => {
        const port = ports.find((p) => p.id === c.portId);
        if (!port) return null;
        return (
          <Marker
            key={c.portId}
            longitude={port.position.lon}
            latitude={port.position.lat}
            anchor="top-left"
          >
            <div
              data-testid={`port-${c.unlocode}`}
              title={`${c.portName}: observed ${formatUtcFull(c.observedAt)}`}
              className="ml-1.5 flex flex-col rounded-sm border border-line bg-ink-950/85 px-1.5 py-1 text-xs"
            >
              <span className="flex items-center gap-1.5 text-text-1">
                <span aria-hidden className="size-1.5 rounded-full bg-text-2" />
                {c.portName}
                {compact ? null : (
                  <span className="font-mono text-2xs text-text-3">{c.unlocode}</span>
                )}
                {compact ? (
                  <span className="text-text-2">
                    <MetricNumber value={c.anchoredCount} unit={null} />
                    {" / "}
                    <MetricNumber value={c.waitingHours} unit="h" />
                  </span>
                ) : null}
              </span>
              {compact ? null : (
                <span className="flex items-baseline gap-2 text-text-2">
                  <span>
                    <MetricNumber value={c.anchoredCount} unit={null} /> at anchor
                  </span>
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
                    {c.source}
                  </span>
                </span>
              )}
            </div>
          </Marker>
        );
      })}
    </>
  );
}
