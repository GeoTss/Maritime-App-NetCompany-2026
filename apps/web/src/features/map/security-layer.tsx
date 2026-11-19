/**
 * Danger areas on the map (Track 3): each area's boxes shaded by its JMIC level and outlined
 * dashed, with one label naming the area, its level and what it needs. Geometry and text are the
 * API's (seeded from cited sources); the source and the reason sit in the side column's list.
 */
import type { SecurityArea } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { cn } from "@/lib/utils";
import type { MapColors } from "./basemap-style";
import { LABEL_PRIORITY } from "./map-labels";
import { LEVEL_TEXT, LEVEL_TONE, POLICY_SHORT, TONE_TEXT } from "./security-text";

/** Where an area's label sits: the centre of its largest box. */
export function labelPoint(area: SecurityArea): { lat: number; lon: number } {
  const size = (b: SecurityArea["boxes"][number]) => (b.maxLat - b.minLat) * (b.maxLon - b.minLon);
  const box = [...area.boxes].sort((a, b) => size(b) - size(a))[0];
  if (!box) return { lat: 0, lon: 0 };
  return { lat: (box.minLat + box.maxLat) / 2, lon: (box.minLon + box.maxLon) / 2 };
}

export function SecurityLayer({
  areas,
  colors,
}: {
  areas: readonly SecurityArea[];
  colors: MapColors;
}) {
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: areas.flatMap((a) =>
        a.boxes.map((b) => ({
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [b.minLon, b.minLat],
                [b.maxLon, b.minLat],
                [b.maxLon, b.maxLat],
                [b.minLon, b.maxLat],
                [b.minLon, b.minLat],
              ],
            ],
          },
          properties: { id: a.id, tone: LEVEL_TONE[a.level] },
        })),
      ),
    }),
    [areas],
  );
  if (areas.length === 0) return null;
  const tone = [
    "match",
    ["get", "tone"],
    "alarm",
    colors.alarm,
    "caution",
    colors.caution,
    colors.plan,
  ] as unknown as string;
  return (
    <>
      <Source id="security-areas" type="geojson" data={data}>
        <Layer
          id="security-fill"
          type="fill"
          paint={{ "fill-color": tone, "fill-opacity": 0.1, "fill-antialias": false }}
        />
        <Layer
          id="security-line"
          type="line"
          paint={{
            "line-color": tone,
            "line-width": 1,
            "line-opacity": 0.8,
            "line-dasharray": [3, 2],
          }}
        />
      </Source>
      {areas.map((a) => {
        const at = labelPoint(a);
        const t = LEVEL_TONE[a.level];
        return (
          <Marker key={a.id} longitude={at.lon} latitude={at.lat} anchor="center">
            <div
              data-testid={`danger-label-${a.id}`}
              data-map-label={LABEL_PRIORITY.port}
              className="flex w-max max-w-40 flex-col items-center rounded-sm bg-ink-950/70 px-1 py-0.5 text-center text-2xs leading-tight"
            >
              <span className="text-text-1">{a.name}</span>
              <span className={cn("font-medium", TONE_TEXT[t])}>
                {LEVEL_TEXT[a.level]} · {POLICY_SHORT[a.policy]}
              </span>
            </div>
          </Marker>
        );
      })}
    </>
  );
}
