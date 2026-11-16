/**
 * The managed fleet as HTML markers (labels are HTML: the map has no glyphs). The vessel with an
 * alert carries the Magic UI ripple: the map's one self-running effect, static under reduced motion.
 */
import type { VesselSummary } from "@pharos/shared";
import { Marker } from "react-map-gl/maplibre";
import { Ripple } from "@/components/ui/ripple";
import { usePrefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function FleetLayer({
  vessels,
  selectedId,
  onSelect,
}: {
  vessels: VesselSummary[];
  selectedId: number | null;
  onSelect: (vessel: VesselSummary) => void;
}) {
  const reduce = usePrefersReducedMotion();
  return (
    <>
      {vessels.map((v) => {
        if (!v.position) return null;
        const alerted = v.alerts.length > 0;
        const selected = v.id === selectedId;
        return (
          <Marker
            key={v.id}
            longitude={v.position.lon}
            latitude={v.position.lat}
            anchor="center"
            style={{ zIndex: alerted ? 3 : selected ? 2 : 1 }}
          >
            <button
              type="button"
              data-testid={`fleet-vessel-${v.id}`}
              data-alerted={alerted}
              aria-label={`${v.name}${alerted ? ", has an alert" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(v)}
              className="group relative flex items-center outline-none"
            >
              <span className="relative flex size-4 items-center justify-center">
                {alerted ? (
                  <Ripple
                    mainCircleSize={22}
                    spacing={14}
                    numCircles={3}
                    mainCircleOpacity={0.9}
                    color="var(--caution)"
                    aria-hidden
                    data-testid="fleet-ripple"
                    data-static={reduce}
                    className="mask-none!"
                  />
                ) : null}
                <span
                  className={cn(
                    "relative size-3 rounded-full border-2 border-ink-950",
                    alerted ? "bg-caution" : "bg-beacon",
                    selected && "ring-2 ring-text-1",
                    "group-focus-visible:ring-2 group-focus-visible:ring-text-1",
                  )}
                />
              </span>
              <span className="ml-1 rounded-sm bg-ink-950/85 px-1 text-xs whitespace-nowrap text-text-1">
                {v.name}
              </span>
            </button>
          </Marker>
        );
      })}
    </>
  );
}
