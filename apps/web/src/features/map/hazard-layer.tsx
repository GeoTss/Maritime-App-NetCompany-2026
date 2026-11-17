/**
 * Hazard zones in alarm red, drawn with the radius the API returned (`zoneRadiusNm`). The
 * label is untrusted text; the demo hazard says it is synthetic. The callout sits above the
 * hazard, clear of the port labels drawn to the right of their ports, and moves left or below
 * near the edges of the visible map so the "synthetic" tag is never clipped.
 */

import type { HazardZoneList } from "@pharos/shared";
import circle from "@turf/circle";
import { useMemo } from "react";
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

function HazardCallout({ hazard }: { hazard: Hazard }) {
  const { ref, flip, below } = useFlipLabel<HTMLDivElement>(hazard.lon, hazard.lat);
  return (
    <Marker longitude={hazard.lon} latitude={hazard.lat} anchor="center">
      <div className="relative size-0">
        <div
          ref={ref}
          data-testid={`hazard-${hazard.id}`}
          data-map-label={LABEL_PRIORITY.hazard}
          data-label-side={`${below ? "below" : "above"}-${flip ? "left" : "right"}`}
          className={cn(
            "absolute flex w-max max-w-44 flex-col items-start gap-0.5 rounded-sm border border-alarm/60 bg-ink-950/85 px-1.5 py-1 text-xs",
            below ? "top-2" : "bottom-2",
            flip ? "right-2" : "left-2",
          )}
        >
          <span className="flex items-center gap-1.5 text-alarm">
            {KIND_TEXT[hazard.kind] ?? hazard.kind}
            {hazard.source === "synthetic" || hazard.kind === "synthetic" ? (
              <DataTag kind="synthetic" />
            ) : null}
          </span>
          <UntrustedText
            text={hazard.label}
            className="line-clamp-3 text-text-2"
            title={hazard.label}
          />
        </div>
      </div>
    </Marker>
  );
}

export function HazardLayer({
  hazards,
  colors,
}: {
  hazards: HazardZoneList["items"];
  colors: MapColors;
}) {
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
        <HazardCallout key={h.id} hazard={h} />
      ))}
    </>
  );
}
