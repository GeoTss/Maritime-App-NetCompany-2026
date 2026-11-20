/**
 * Hazard zones in alarm red, drawn with the radius the API returned (`zoneRadiusNm`). Each zone
 * carries a small callout with its kind (the demo hazard says it is synthetic); the report itself,
 * untrusted text, opens on a click or on "Show on map" and closes again, one at a time, so a
 * warning never sits over the map for good. The callout sits above the hazard, clear of the port
 * labels drawn to the right of their ports, and moves left or below near the edges of the visible
 * map so the "synthetic" tag is never clipped.
 */

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { HazardZoneList } from "@pharos/shared";
import circle from "@turf/circle";
import { useEffect, useMemo, useState } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { DataTag } from "@/components/source-badge";
import { UntrustedText } from "@/components/untrusted-text";
import { cn } from "@/lib/utils";
import type { MapColors } from "./basemap-style";
import { LABEL_PRIORITY, useFlipLabel } from "./map-labels";

const KIND_TEXT: Record<string, string> = {
  distress_beacon: "Distress beacon",
  sar_aircraft: "SAR aircraft",
  aton: "Aid to navigation",
  safety_message: "Safety message",
  synthetic: "Hazard",
};

type Hazard = HazardZoneList["items"][number];

function HazardCallout({
  hazard,
  open,
  onOpenChange,
}: {
  hazard: Hazard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { ref, flip, below } = useFlipLabel<HTMLDivElement>(hazard.lon, hazard.lat);
  const kind = KIND_TEXT[hazard.kind] ?? hazard.kind;
  return (
    <Marker longitude={hazard.lon} latitude={hazard.lat} anchor="center">
      <div className="relative size-0">
        <div
          ref={ref}
          data-testid={`hazard-${hazard.id}`}
          data-map-label={LABEL_PRIORITY.hazard}
          data-label-side={`${below ? "below" : "above"}-${flip ? "left" : "right"}`}
          data-open={open}
          className={cn(
            "absolute flex w-max max-w-44 flex-col items-start gap-0.5 rounded-sm border border-alarm/60 bg-ink-950/85 text-xs",
            below ? "top-2" : "bottom-2",
            flip ? "right-2" : "left-2",
          )}
        >
          {/* Closed, the callout is its kind alone; the report opens on request and closes again. */}
          <button
            type="button"
            aria-expanded={open}
            aria-label={
              open
                ? `Hide the ${kind.toLowerCase()} report`
                : `Show the ${kind.toLowerCase()} report`
            }
            onClick={() => onOpenChange(!open)}
            className="flex w-full items-center gap-1.5 px-1.5 py-1 text-alarm outline-none focus-visible:ring-2 focus-visible:ring-beacon/50"
          >
            {kind}
            {hazard.source === "synthetic" || hazard.kind === "synthetic" ? (
              <DataTag kind="synthetic" />
            ) : null}
            {open ? (
              <HugeiconsIcon icon={Cancel01Icon} size={12} className="ml-auto text-text-2" />
            ) : null}
          </button>
          {open ? (
            <UntrustedText
              text={hazard.label}
              className="line-clamp-3 px-1.5 pb-1 text-text-2"
              title={hazard.label}
            />
          ) : null}
        </div>
      </div>
    </Marker>
  );
}

export function HazardLayer({
  hazards,
  colors,
  showId,
}: {
  hazards: HazardZoneList["items"];
  colors: MapColors;
  /** The hazard "Show on map" last flew to, with the fly's key: its report opens. */
  showId?: { id: string; key: string } | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = showId?.key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: opens once per "Show on map", by its key.
  useEffect(() => {
    if (showId) setOpenId(showId.id);
  }, [shown]);
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: hazards.map((h) =>
        circle([h.lon, h.lat], h.zoneRadiusNm, { units: "nauticalmiles", steps: 72 }),
      ),
    }),
    [hazards],
  );
  const centres = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: hazards.map((h) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [h.lon, h.lat] },
        properties: {},
      })),
    }),
    [hazards],
  );
  return (
    <>
      <Source id="hazard-centres" type="geojson" data={centres}>
        <Layer
          id="hazard-centre"
          type="circle"
          paint={{
            "circle-radius": 4,
            "circle-color": colors.alarm,
            "circle-stroke-color": colors.text,
            "circle-stroke-width": 1,
          }}
        />
      </Source>
      <Source id="hazards" type="geojson" data={data}>
        <Layer
          id="hazard-fill"
          type="fill"
          paint={{ "fill-color": colors.alarm, "fill-opacity": 0.12 }}
        />
        <Layer
          id="hazard-line"
          type="line"
          paint={{ "line-color": colors.alarm, "line-width": 1.5, "line-dasharray": [4, 2] }}
        />
      </Source>
      {hazards.map((h) => (
        <HazardCallout
          key={h.id}
          hazard={h}
          open={openId === h.id}
          onOpenChange={(open) => setOpenId(open ? h.id : null)}
        />
      ))}
    </>
  );
}
