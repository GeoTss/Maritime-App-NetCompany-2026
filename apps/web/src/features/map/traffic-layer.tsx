/**
 * Public AIS traffic: one GeoJSON source, drawn as arrows rotated to the reported course
 * (`cogDeg`) and as plain dots for ships that report none. Click selects (see `MapView`).
 */
import type { AisTrafficList } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { MapColors } from "./basemap-style";

export const SHIP_ARROW_IMAGE = "ship-arrow";
export const TRAFFIC_LAYER_IDS = ["traffic-arrows", "traffic-dots"] as const;

export function TrafficLayer({
  traffic,
  colors,
  selectedMmsi,
}: {
  traffic: AisTrafficList["items"];
  colors: MapColors;
  selectedMmsi: string | null;
}) {
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: traffic.map((s) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
        properties: { mmsi: s.mmsi, cog: s.cogDeg ?? 0, hasCourse: s.cogDeg !== null },
      })),
    }),
    [traffic],
  );
  return (
    <Source id="traffic" type="geojson" data={data}>
      <Layer
        id="traffic-dots"
        type="circle"
        filter={["!", ["get", "hasCourse"]]}
        paint={{ "circle-radius": 2.5, "circle-color": colors.traffic }}
      />
      <Layer
        id="traffic-arrows"
        type="symbol"
        filter={["get", "hasCourse"]}
        layout={{
          "icon-image": SHIP_ARROW_IMAGE,
          "icon-rotate": ["get", "cog"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 0.5,
        }}
        paint={{ "icon-color": colors.traffic }}
      />
      <Layer
        id="traffic-selected"
        type="circle"
        filter={["==", ["get", "mmsi"], selectedMmsi ?? ""]}
        paint={{
          "circle-radius": 9,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": colors.beacon,
          "circle-stroke-width": 1.5,
        }}
      />
    </Source>
  );
}

/** A white arrow as an SDF image, so `icon-color` tints it from the design token. */
export function drawShipArrow(size = 32): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.moveTo(size / 2, size * 0.06);
  ctx.lineTo(size * 0.82, size * 0.92);
  ctx.lineTo(size / 2, size * 0.72);
  ctx.lineTo(size * 0.18, size * 0.92);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
