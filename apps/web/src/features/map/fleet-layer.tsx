/**
 * The managed fleet as HTML markers (labels are HTML: the map has no glyphs). The marker is the
 * 16 px dot, centred on the vessel's position; the name sits beside it, outside the ripple of an
 * alerted vessel, and moves to the left near the right edge of the visible map. The vessel with an
 * alert carries the Magic UI ripple: the map's one self-running effect, static under reduced motion.
 */
import type { VesselSummary } from "@pharos/shared";
import { Marker } from "react-map-gl/maplibre";
import { Ripple } from "@/components/ui/ripple";
import { usePrefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LABEL_PRIORITY, useFlipLabel } from "./map-labels";

/** The ripple's rings: 22, 36 and 50 px across. The label starts clear of the outer one. */
const RIPPLE = { main: 22, spacing: 14, rings: 3 } as const;
const RIPPLE_RADIUS_PX = (RIPPLE.main + (RIPPLE.rings - 1) * RIPPLE.spacing) / 2;

function FleetMarker({
  vessel,
  position,
  selected,
  onSelect,
  reduce,
}: {
  vessel: VesselSummary;
  position: { lat: number; lon: number };
  selected: boolean;
  onSelect: (vessel: VesselSummary) => void;
  reduce: boolean;
}) {
  const alerted = vessel.alerts.length > 0;
  // From the dot's centre: past the ring for an alerted vessel, just past the dot otherwise.
  const offset = alerted ? RIPPLE_RADIUS_PX + 4 : 12;
  const side = `calc(50% + ${offset}px)`;
  const { ref, flip, offscreen } = useFlipLabel<HTMLSpanElement>(
    position.lon,
    position.lat,
    offset,
  );
  return (
    <Marker
      longitude={position.lon}
      latitude={position.lat}
      anchor="center"
      style={{ zIndex: alerted ? 3 : selected ? 2 : 1 }}
    >
      <button
        type="button"
        data-testid={`fleet-vessel-${vessel.id}`}
        data-alerted={alerted}
        data-label-side={flip ? "left" : "right"}
        aria-label={`${vessel.name}${alerted ? ", has an alert" : ""}`}
        aria-pressed={selected}
        onClick={() => onSelect(vessel)}
        className="group relative flex size-4 items-center justify-center outline-none"
      >
        {alerted ? (
          <Ripple
            mainCircleSize={RIPPLE.main}
            spacing={RIPPLE.spacing}
            numCircles={RIPPLE.rings}
            mainCircleOpacity={0.9}
            color="var(--caution)"
            aria-hidden
            data-testid="fleet-ripple"
            data-static={reduce}
            className="mask-none!"
          />
        ) : null}
        <span
          data-map-obstacle={alerted ? undefined : ""}
          className={cn(
            "relative size-3 rounded-full border-2 border-ink-950",
            alerted ? "bg-caution" : "bg-beacon",
            selected && "ring-2 ring-text-1",
            "group-focus-visible:ring-2 group-focus-visible:ring-text-1",
          )}
        />
        {alerted ? (
          // The ripple's outer ring, as an obstacle no other label may cover.
          <span
            aria-hidden
            data-map-obstacle=""
            style={{ width: RIPPLE_RADIUS_PX * 2, height: RIPPLE_RADIUS_PX * 2 }}
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2"
          />
        ) : null}
        <span
          ref={ref}
          aria-hidden
          data-map-label={alerted || selected ? LABEL_PRIORITY.flagged : LABEL_PRIORITY.vessel}
          style={flip ? { right: side } : { left: side }}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 rounded-sm bg-ink-950/85 px-1 text-xs whitespace-nowrap text-text-1 data-decluttered:invisible",
            offscreen && "invisible",
          )}
        >
          {vessel.name}
        </span>
      </button>
    </Marker>
  );
}

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
      {vessels.map((v) =>
        v.position ? (
          <FleetMarker
            key={v.id}
            vessel={v}
            position={v.position}
            selected={v.id === selectedId}
            onSelect={onSelect}
            reduce={reduce}
          />
        ) : null,
      )}
    </>
  );
}
