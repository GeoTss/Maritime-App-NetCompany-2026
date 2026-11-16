/**
 * Hazard zones in chart magenta, drawn with the radius the API returned (`zoneRadiusNm`). The
 * label is untrusted text; the demo hazard says it is synthetic.
 */

import type { HazardZoneList } from "@pharos/shared";
import circle from "@turf/circle";
import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { DataTag } from "@/components/source-badge";
import { UntrustedText } from "@/components/untrusted-text";
import type { MapColors } from "./basemap-style";

const KIND_TEXT: Record<string, string> = {
  distress_beacon: "Distress beacon",
  sar_aircraft: "SAR aircraft",
  aton: "Aid to navigation",
  safety_message: "Safety message",
  synthetic: "Hazard",
};

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
            "circle-color": colors.magenta,
            "circle-stroke-color": colors.text,
            "circle-stroke-width": 1,
          }}
        />
      </Source>
      <Source id="hazards" type="geojson" data={data}>
        <Layer
          id="hazard-fill"
          type="fill"
          paint={{ "fill-color": colors.magenta, "fill-opacity": 0.12 }}
        />
        <Layer
          id="hazard-line"
          type="line"
          paint={{ "line-color": colors.magenta, "line-width": 1.5, "line-dasharray": [4, 2] }}
        />
      </Source>
      {hazards.map((h) => (
        <Marker key={h.id} longitude={h.lon} latitude={h.lat} anchor="top-left">
          <div
            data-testid={`hazard-${h.id}`}
            className="relative ml-2 flex max-w-56 flex-col items-start gap-0.5 rounded-sm border border-chart-magenta/60 bg-ink-950/85 px-1.5 py-1 text-xs"
          >
            <span className="flex items-center gap-1.5 text-chart-magenta">
              {KIND_TEXT[h.kind] ?? h.kind}
              {h.source === "synthetic" || h.kind === "synthetic" ? (
                <DataTag kind="synthetic" />
              ) : null}
            </span>
            <UntrustedText text={h.label} className="line-clamp-2 text-text-2" title={h.label} />
          </div>
        </Marker>
      ))}
    </>
  );
}
