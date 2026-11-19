/**
 * The voyage timeline's events on the map: a small pin per event at its position on the track, for
 * the groups the timeline shows. A pin selects its row in the timeline (which scrolls into view);
 * the selected one is ringed. Positions are drawing geometry; the pins show no numbers.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import { type RoutePlanView, TIMELINE_GROUP, type TimelineGroup } from "@pharos/shared";
import { Marker } from "react-map-gl/maplibre";
import { cn } from "@/lib/utils";
import { GROUP_ICON, GROUP_LABEL } from "./voyage-timeline";

export function TimelineMarkers({
  plan,
  groups,
  selected,
  onSelect,
}: {
  plan: RoutePlanView | null;
  groups: readonly TimelineGroup[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const events = plan?.timeline?.events ?? [];
  return (
    <>
      {events.map((event, index) => {
        const group = TIMELINE_GROUP[event.kind];
        if (!groups.includes(group)) return null;
        // Port arrival and departure share a place: one pin, the arrival's.
        if (event.kind === "port_departure") return null;
        return (
          <Marker
            // biome-ignore lint/suspicious/noArrayIndexKey: events are positional (their facts are by index)
            key={index}
            longitude={event.position.lon}
            latitude={event.position.lat}
            anchor="center"
          >
            <button
              type="button"
              data-testid={`timeline-marker-${index}`}
              aria-label={`${GROUP_LABEL[group]}: show in the timeline`}
              aria-pressed={selected === index}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(index);
              }}
              className={cn(
                "grid size-5 place-items-center rounded-full border bg-ink-950/90 text-text-1",
                selected === index ? "border-beacon ring-2 ring-beacon/50" : "border-line-strong",
              )}
            >
              <HugeiconsIcon icon={GROUP_ICON[group]} size={11} strokeWidth={2} />
            </button>
          </Marker>
        );
      })}
    </>
  );
}
