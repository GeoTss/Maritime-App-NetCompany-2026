/**
 * The MapLibre canvas: offline basemap, the five layers, and framing. All layers are children of
 * one `Map`; the parent decides what is visible and selected.
 */
import type {
  AisTrafficList,
  HazardZoneList,
  LatLon,
  PortCongestionList,
  PortList,
  RoutePlanResponse,
  VesselSummary,
  WeatherView,
} from "@pharos/shared";
import { type LngLatBoundsLike, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapGL,
  type MapLayerMouseEvent,
  type MapRef,
  NavigationControl,
} from "react-map-gl/maplibre";
import { usePrefersReducedMotion } from "@/lib/motion";
import {
  buildBasemapStyle,
  DEMO_VIEW,
  LAND_PATH,
  type MapColors,
  readMapColors,
} from "./basemap-style";
import { CongestionLayer } from "./congestion-layer";
import { FleetLayer } from "./fleet-layer";
import { HazardLayer } from "./hazard-layer";
import type { LayerState } from "./layer-toggles";
import { planBounds, RouteLayer } from "./route-layer";
import { drawShipArrow, SHIP_ARROW_IMAGE, TRAFFIC_LAYER_IDS, TrafficLayer } from "./traffic-layer";
import { WeatherLayer } from "./weather-layer";

// The worker is bundled with the app (offline, same origin); MapLibre otherwise looks for it
// next to its own module, which Vite's dependency cache moves.
setWorkerUrl(workerUrl);

/** Below this zoom, port labels shrink to one line so a busy coast stays readable. */
const COMPACT_BELOW_ZOOM = 5.5;

export interface MapFocus {
  lat: number;
  lon: number;
  /** Changes whenever the same place should be flown to again. */
  key: string;
}

export interface MapViewProps {
  layers: LayerState;
  vessels: VesselSummary[];
  traffic: AisTrafficList["items"];
  hazards: HazardZoneList["items"];
  congestion: PortCongestionList["items"];
  ports: PortList["items"];
  weather: WeatherView | undefined;
  plan: RoutePlanResponse | null;
  track: LatLon[] | null;
  selectedVesselId: number | null;
  selectedMmsi: string | null;
  focus: MapFocus | null;
  /** Screen pixels the overlays take at the bottom and right, so framing leaves them clear. */
  inset: { bottom: number; right: number };
  onSelectVessel: (vessel: VesselSummary) => void;
  onSelectShip: (mmsi: string) => void;
}

export function MapView(props: MapViewProps) {
  const {
    layers,
    vessels,
    traffic,
    hazards,
    congestion,
    ports,
    weather,
    plan,
    track,
    selectedVesselId,
    selectedMmsi,
    focus,
    inset,
    onSelectVessel,
    onSelectShip,
  } = props;
  const ref = useRef<MapRef>(null);
  const reduce = usePrefersReducedMotion();
  const colors: MapColors = useMemo(() => readMapColors(), []);
  const style = useMemo(
    () => buildBasemapStyle(colors, new URL(LAND_PATH, window.location.origin).href),
    [colors],
  );
  const [cursor, setCursor] = useState("");
  const [zoom, setZoom] = useState<number>(DEMO_VIEW.zoom);

  const onLoad = useCallback(() => {
    const map = ref.current?.getMap();
    if (!map || map.hasImage(SHIP_ARROW_IMAGE)) return;
    const image = drawShipArrow();
    if (image) map.addImage(SHIP_ARROW_IMAGE, image, { sdf: true });
  }, []);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const mmsi = e.features?.find((f) => typeof f.properties?.mmsi === "string")?.properties
        ?.mmsi;
      if (typeof mmsi === "string") onSelectShip(mmsi);
    },
    [onSelectShip],
  );

  // Frame a new plan: every candidate, clear of the tray and the panel.
  const bounds = plan ? planBounds(plan) : null;
  const planId = plan?.calculationId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame once per plan, not on every inset change.
  useEffect(() => {
    if (!bounds) return;
    ref.current?.fitBounds(bounds as LngLatBoundsLike, {
      padding: { top: 56, left: 24, bottom: inset.bottom + 24, right: inset.right + 24 },
      duration: reduce ? 0 : 600,
      maxZoom: 7,
    });
  }, [planId]);

  // Fly to a selection made from the command menu.
  useEffect(() => {
    if (!focus) return;
    ref.current?.easeTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(ref.current?.getZoom() ?? 0, 5),
      duration: reduce ? 0 : 500,
    });
  }, [focus, reduce]);

  const interactive = layers.traffic ? [...TRAFFIC_LAYER_IDS] : [];
  return (
    <MapGL
      ref={ref}
      initialViewState={DEMO_VIEW}
      mapStyle={style}
      attributionControl={false}
      minZoom={2.5}
      maxZoom={11}
      dragRotate={false}
      touchPitch={false}
      interactiveLayerIds={interactive}
      cursor={cursor}
      onLoad={onLoad}
      onMoveEnd={(e) => setZoom(e.viewState.zoom)}
      onClick={onClick}
      onMouseMove={(e) => setCursor(e.features && e.features.length > 0 ? "pointer" : "")}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="bottom-left" showCompass={false} />
      {layers.weather && weather ? <WeatherLayer weather={weather} colors={colors} /> : null}
      {layers.hazards ? <HazardLayer hazards={hazards} colors={colors} /> : null}
      <RouteLayer plan={plan} track={track} colors={colors} />
      {layers.traffic ? (
        <TrafficLayer traffic={traffic} colors={colors} selectedMmsi={selectedMmsi} />
      ) : null}
      {layers.congestion ? (
        <CongestionLayer
          congestion={congestion}
          ports={ports}
          compact={zoom < COMPACT_BELOW_ZOOM}
        />
      ) : null}
      {layers.fleet ? (
        <FleetLayer vessels={vessels} selectedId={selectedVesselId} onSelect={onSelectVessel} />
      ) : null}
    </MapGL>
  );
}
