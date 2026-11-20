/**
 * Route geometry exactly as returned. A plan draws every candidate by role: the recommended route
 * in --beacon, the current plan dashed in --plan, an infeasible route dotted in --alarm, the rest thin
 * in --plan. Without a plan, a selected vessel's planned track is drawn dashed.
 *
 * A recommended plan that calls at a bunker port draws a stop marker at the port (the stop's
 * arrival position, as returned), and its track through the port when the view carries it as a
 * candidate with the stop plan's id. Where the best route ignoring fuel on board first falls below
 * a margin, an alarm marker says so in words. Markers are HTML (the basemap has no glyphs).
 */
import type { LatLon, PortList, RoutePlanView } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { StateFlag } from "@/components/primitives/state-flag";
import { cn } from "@/lib/utils";
import type { MapColors } from "./basemap-style";
import { useFlipLabel } from "./map-labels";
import { fuelBlindBest, gradesShort, recommendedTrack } from "./route-facts";
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

/** The bunker stop of the recommended plan: where it is and what to call it. */
export function planStop(plan: RoutePlanView, ports: PortList["items"] = []) {
  const track = recommendedTrack(plan);
  if (track?.kind !== "stop") return null;
  const stop = plan.result.stopPlans[track.index];
  const arrival = stop?.fuel?.breakpoints.find((b) => b.kind === "stop_arrival");
  if (!stop || !arrival) return null;
  const port = ports.find((p) => p.unlocode === stop.unlocode);
  return { optionId: stop.optionId, position: arrival.position, name: port?.name ?? stop.unlocode };
}

/** Where the best route ignoring fuel first falls below a margin, and in which grade. */
export function planShortfall(plan: RoutePlanView) {
  const best = fuelBlindBest(plan);
  const fuel = best ? (plan.result.options[best.index]?.fuel ?? null) : null;
  const grade = gradesShort(fuel)[0];
  const at = grade ? fuel?.grades[grade].belowMarginAt : null;
  return grade && at ? { grade, position: at.position } : null;
}

function StopMarker({ position, name }: { position: LatLon; name: string }) {
  const { ref, flip, offscreen } = useFlipLabel<HTMLDivElement>(position.lon, position.lat, 12);
  return (
    <Marker longitude={position.lon} latitude={position.lat} anchor="center" style={{ zIndex: 5 }}>
      <div className="relative size-0" data-testid="stop-marker">
        <span
          aria-hidden
          className="absolute size-4 -translate-1/2 rounded-full border-[1.5px] border-beacon bg-ink-950"
        />
        <span aria-hidden className="absolute size-1.5 -translate-1/2 rounded-full bg-beacon" />
        <div
          ref={ref}
          data-map-obstacle={offscreen ? undefined : ""}
          style={flip ? { right: "12px" } : { left: "12px" }}
          className={cn(
            "absolute top-0 w-max -translate-y-1/2 rounded-sm border border-beacon bg-ink-900 px-1.5 py-0.5 text-xs text-text-1",
            offscreen && "invisible",
          )}
        >
          Bunker stop, {name}
        </div>
      </div>
    </Marker>
  );
}

function ShortfallMarker({ position, grade }: { position: LatLon; grade: string }) {
  const { ref, flip, offscreen } = useFlipLabel<HTMLDivElement>(position.lon, position.lat, 10);
  return (
    <Marker longitude={position.lon} latitude={position.lat} anchor="center" style={{ zIndex: 4 }}>
      <div className="relative size-0" data-testid="shortfall-marker">
        <span aria-hidden className="absolute size-2.5 -translate-1/2 rounded-full bg-alarm" />
        <div
          ref={ref}
          data-map-obstacle={offscreen ? undefined : ""}
          style={flip ? { right: "10px" } : { left: "10px" }}
          className={cn(
            "absolute top-0 flex w-max -translate-y-1/2 items-center gap-1.5 rounded-sm border border-alarm bg-ink-900 px-1.5 py-0.5 text-xs text-alarm",
            offscreen && "invisible",
          )}
        >
          <StateFlag kind="V" />
          Below the {grade} margin, ignoring fuel on board
        </div>
      </div>
    </Marker>
  );
}

export function RouteLayer({
  plan,
  track,
  colors,
  ports,
}: {
  plan: RoutePlanView | null;
  track: LatLon[] | null;
  colors: MapColors;
  /** Port names for the stop marker (by UN/LOCODE). */
  ports?: PortList["items"];
}) {
  const data = useMemo(() => {
    const features = [];
    if (plan) {
      plan.result.options.forEach((option, index) => {
        const candidate = plan.candidates.find((c) => c.id === option.candidateId);
        if (candidate) features.push(line(candidate.points, routeRole(plan, index)));
      });
      // The recommended stop plan's own track, when the view carries it as a candidate.
      const rec = plan.result.plan;
      const via = rec?.kind === "stop" ? plan.candidates.find((c) => c.id === rec.optionId) : null;
      if (via) features.push(line(via.points, "recommended"));
    } else if (track && track.length >= 2) {
      features.push(line(track, "track"));
    }
    return { type: "FeatureCollection" as const, features };
  }, [plan, track]);
  const stop = plan ? planStop(plan, ports) : null;
  const shortfall = plan ? planShortfall(plan) : null;

  const role = (r: RouteRole | "track") => ["==", ["get", "role"], r] as const;
  return (
    <>
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
      {shortfall ? <ShortfallMarker position={shortfall.position} grade={shortfall.grade} /> : null}
      {stop ? <StopMarker position={stop.position} name={stop.name} /> : null}
    </>
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
