/**
 * The hazard or weather area being placed in the Scenario panel, drawn dashed with the radius the
 * form holds (red for a hazard, storm-coloured for weather) until it is added. Drawing only.
 */
import circle from "@turf/circle";
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { ScenarioPreview } from "@/features/scenario/scenario-data";
import type { MapColors } from "./basemap-style";

export function ScenarioPreviewLayer({
  preview,
  colors,
}: {
  preview: ScenarioPreview;
  colors: MapColors;
}) {
  const data = useMemo(
    () =>
      circle([preview.center.lon, preview.center.lat], preview.radiusNm, {
        units: "nauticalmiles",
        steps: 72,
      }),
    [preview],
  );
  return (
    <Source id="scenario-preview" type="geojson" data={data}>
      <Layer
        id="scenario-preview"
        type="line"
        paint={{
          "line-color": preview.kind === "hazard" ? colors.alarm : colors.storm,
          "line-width": 1.5,
          "line-dasharray": [2, 2],
        }}
      />
    </Source>
  );
}
