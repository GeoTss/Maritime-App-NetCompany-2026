/**
 * Route geometry exactly as returned. A plan draws every candidate by role: the recommended route
 * in --beacon, the current plan dashed in --plan, an infeasible route dotted in --alarm, the rest thin
 * in --plan. Without a plan, a selected vessel's planned track is drawn dashed.
 */
import type { LatLon, RoutePlanView } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { MapColors } from "./basemap-style";
import { type RouteRole, routeRole } from "./route-style";

export const ROUTE_LAYER_IDS = [
  "route-other",
  "route-planned",
  "route-infeasible",
  "route-recommended",
  "voyage-track",
] as const;

const line = (points: LatLon[], role: string) => ({
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates: points.map((p) => [p.lon, p.lat]) },
  properties: { role },
});

export function RouteLayer({
  plan,
  track,
  colors,
}: {
  plan: RoutePlanView | null;
  track: LatLon[] | null;
  colors: MapColors;
}) {
  const data = useMemo(() => {
    const features = [];
    if (plan) {
      plan.result.options.forEach((option, index) => {
        const candidate = plan.candidates.find((c) => c.id === option.candidateId);
        if (candidate) features.push(line(candidate.points, routeRole(plan, index)));
      });
    } else if (track && track.length >= 2) {
      features.push(line(track, "track"));
    }
    return { type: "FeatureCollection" as const, features };
  }, [plan, track]);

  const role = (r: RouteRole | "track") => ["==", ["get", "role"], r] as const;
  return (
    <Source id="routes" type="geojson" data={data}>
      <Layer
        id="voyage-track"
        type="line"
        filter={role("track") as never}
        paint={{ "line-color": colors.plan, "line-width": 1.5, "line-dasharray": [3, 2] }}
      />
      <Layer
        id="route-other"
        type="line"
        filter={role("other") as never}
        paint={{ "line-color": colors.plan, "line-width": 1.5 }}
      />
      <Layer
        id="route-planned"
        type="line"
        filter={role("planned") as never}
        paint={{ "line-color": colors.plan, "line-width": 2, "line-dasharray": [3, 2] }}
      />
      <Layer
        id="route-infeasible"
        type="line"
        filter={role("infeasible") as never}
        paint={{ "line-color": colors.alarm, "line-width": 2, "line-dasharray": [1, 2] }}
      />
      <Layer
        id="route-recommended"
        type="line"
        filter={role("recommended") as never}
        paint={{ "line-color": colors.beacon, "line-width": 3 }}
      />
    </Source>
  );
}

/** The plan's bounding box, for framing the map: drawing geometry, not a result. */
export function planBounds(plan: RoutePlanView): [[number, number], [number, number]] | null {
  const pts = plan.candidates.flatMap((c) => c.points);
  if (pts.length === 0) return null;
  const lons = pts.map((p) => p.lon);
  const lats = pts.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
