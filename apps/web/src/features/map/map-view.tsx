/**
 * The MapLibre canvas: offline basemap, the five layers, a plan (route or bunker) when there is
 * one, and framing. All layers are children of one `Map`; the parent decides what is visible and
 * selected.
 */
import type {
  AisTrafficList,
  BunkerPlanView,
  HazardZoneList,
  LatLon,
  PortCongestionList,
  PortList,
  RoutePlanView,
  SourceMode,
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
import { BunkerPlanLayer, bunkerPlanBounds } from "./bunker-plan-layer";
import { CongestionLayer } from "./congestion-layer";
import { FleetLayer } from "./fleet-layer";
import { HazardLayer } from "./hazard-layer";
import type { LayerState } from "./layer-toggles";
import { declutterLabels, MapInsetContext } from "./map-labels";
import { planBounds, RouteLayer } from "./route-layer";
import { StormLayer } from "./storm-layer";
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
  plan: RoutePlanView | null;
  /** A stored bunker plan from the address: its ports, ringed by rank. */
  bunkerPlan: BunkerPlanView | null;
  track: LatLon[] | null;
  selectedVesselId: number | null;
  selectedMmsi: string | null;
  focus: MapFocus | null;
  /** Screen pixels the overlays take (panel right, tray or phone panel bottom, layer switches
   * top), so framing and labels leave them clear. */
  inset: { bottom: number; right: number; top: number };
  /** The fleet and hazard reads have settled: the first view can be framed. */
  ready: boolean;
  /** The AIS source's mode, for port figures counted from AIS. */
  aisMode: SourceMode | null;
  onSelectVessel: (vessel: VesselSummary) => void;
  onSelectShip: (mmsi: string) => void;
}

/** Below this canvas width the demo view cuts off the fleet, so the first view frames it. */
const NARROW_CANVAS_PX = 640;
/** A selection closer than this to an overlay or the edge counts as hidden. */
const EDGE_MARGIN_PX = 32;

/** Where to put `center` so it lands in the middle of the part of the canvas no overlay covers. */
const clearOffset = (inset: MapViewProps["inset"]): [number, number] => [
  -inset.right / 2,
  (inset.top - inset.bottom) / 2,
];

/** The ship a canvas click selects. A click inside an HTML marker (the fleet button) is the
 * marker's own: the click bubbles to the map, but must not select what is drawn underneath. */
export function pickShipMmsi(e: MapLayerMouseEvent): string | null {
  const target = e.originalEvent?.target as Element | null | undefined;
  if (target?.closest?.(".maplibregl-marker")) return null;
  const mmsi = e.features?.find((f) => typeof f.properties?.mmsi === "string")?.properties?.mmsi;
  return typeof mmsi === "string" ? mmsi : null;
}

/** The hazard a "Show on map" fly targets (its focus key is `h<id>-<time>`), else null. */
function hazardShown(focus: MapFocus | null): { id: string; key: string } | null {
  if (!focus?.key.startsWith("h")) return null;
  return { id: focus.key.slice(1, focus.key.lastIndexOf("-")), key: focus.key };
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
    bunkerPlan,
    track,
    selectedVesselId,
    selectedMmsi,
    focus,
    inset,
    ready,
    aisMode,
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
  const [loaded, setLoaded] = useState(false);

  const onLoad = useCallback(() => {
    setLoaded(true);
    const map = ref.current?.getMap();
    if (!map || map.hasImage(SHIP_ARROW_IMAGE)) return;
    const image = drawShipArrow();
    if (image) map.addImage(SHIP_ARROW_IMAGE, image, { sdf: true });
  }, []);

  // The first view: on a narrow canvas the demo view cuts off the flagged vessel and the hazard,
  // so frame them (clear of the layer switches): the vessels with an alert (all vessels when none
  // has one) and the hazards. Framing the whole fleet would zoom out to where every label
  // collides. A selection or a plan frames itself instead.
  const framedFirst = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: framed once, when the data is in.
  useEffect(() => {
    const map = ref.current;
    if (framedFirst.current || !loaded || !ready || !map) return;
    framedFirst.current = true;
    if (selectedVesselId !== null || selectedMmsi !== null || plan || bunkerPlan) return;
    if (map.getContainer().clientWidth >= NARROW_CANVAS_PX) return;
    const alerted = vessels.filter((v) => v.alerts.length > 0);
    const points: [number, number][] = [
      ...(alerted.length > 0 ? alerted : vessels).flatMap((v) =>
        v.position ? [[v.position.lon, v.position.lat] as const] : [],
      ),
      ...hazards.map((h) => [h.lon, h.lat] as const),
    ].map(([lon, lat]) => [lon, lat]);
    if (points.length === 0) return;
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      {
        padding: { top: inset.top + 24, left: 24, right: 24, bottom: inset.bottom + 32 },
        duration: 0,
        maxZoom: DEMO_VIEW.zoom,
      },
    );
  }, [loaded, ready]);

  // A selection (address, click or ⌘K) under the panel, the tray or off the canvas is brought
  // into the clear part of the map. One that is already visible stays where it is.
  const selectionKey =
    selectedVesselId !== null ? `v${selectedVesselId}` : selectedMmsi ? `s${selectedMmsi}` : null;
  const selectedVessel = vessels.find((v) => v.id === selectedVesselId);
  const selectedShip = selectedMmsi ? traffic.find((s) => s.mmsi === selectedMmsi) : undefined;
  const target = selectedVessel?.position ?? selectedShip ?? null;
  const framedSelection = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per selection, when it can be placed.
  useEffect(() => {
    if (selectionKey === null) {
      framedSelection.current = null;
      return;
    }
    const map = ref.current;
    if (!loaded || !map || !target || framedSelection.current === selectionKey) return;
    framedSelection.current = selectionKey;
    // ⌘K flies to its own selection (see below).
    if (focus?.key.startsWith(`${selectionKey}-`)) return;
    const { x, y } = map.project([target.lon, target.lat]);
    const el = map.getContainer();
    const hidden =
      x < EDGE_MARGIN_PX ||
      y < inset.top + EDGE_MARGIN_PX ||
      x > el.clientWidth - inset.right - EDGE_MARGIN_PX ||
      y > el.clientHeight - inset.bottom - EDGE_MARGIN_PX;
    if (!hidden) return;
    map.easeTo({
      center: [target.lon, target.lat],
      offset: clearOffset(inset),
      duration: reduce ? 0 : 500,
    });
  }, [selectionKey, loaded, target?.lat, target?.lon]);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const mmsi = pickShipMmsi(e);
      if (mmsi) onSelectShip(mmsi);
    },
    [onSelectShip],
  );

  // A plan's frame: clear of the layer switches, the tray and the panel.
  const planPadding = {
    top: inset.top + 24,
    left: 24,
    bottom: inset.bottom + 24,
    right: inset.right + 24,
  };

  // Frame a route plan once the map has loaded: every candidate. Once per plan (a new inset does
  // not reframe it); clearing it and showing it again frames it again. The map is created after
  // the first commit, so a plan already in the cache waits for `loaded` and is marked framed only
  // once a fit was issued.
  const planId = plan?.calculationId ?? null;
  const framedPlan = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame once per plan, when the map can.
  useEffect(() => {
    if (!plan) {
      framedPlan.current = null;
      return;
    }
    const map = ref.current;
    const bounds = planBounds(plan);
    if (!loaded || !map || !bounds || framedPlan.current === plan.calculationId) return;
    map.fitBounds(bounds as LngLatBoundsLike, {
      padding: planPadding,
      duration: reduce ? 0 : 600,
      maxZoom: 7,
    });
    framedPlan.current = plan.calculationId;
  }, [planId, loaded]);

  // Frame a bunker plan once the map has loaded and the fleet is in: the vessel and every
  // option's port. Once per plan, by the same rules as a route plan.
  const bunkerId = bunkerPlan?.calculationId ?? null;
  const framedBunker = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame once per plan, when the map and the vessel can.
  useEffect(() => {
    if (!bunkerPlan) {
      framedBunker.current = null;
      return;
    }
    const map = ref.current;
    if (!loaded || !ready || !map || framedBunker.current === bunkerPlan.calculationId) return;
    const box = bunkerPlanBounds(bunkerPlan, vessels);
    if (!box) return;
    map.fitBounds(box, { padding: planPadding, duration: reduce ? 0 : 600, maxZoom: 7 });
    framedBunker.current = bunkerPlan.calculationId;
  }, [bunkerId, ready, loaded]);

  // Fly to a selection made from the command menu, into the part of the map no panel covers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fly once per focus, not on inset changes.
  useEffect(() => {
    if (!focus) return;
    ref.current?.easeTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(ref.current?.getZoom() ?? 0, 5),
      offset: clearOffset(inset),
      duration: reduce ? 0 : 500,
    });
  }, [focus, reduce]);

  // Labels that would overlap a more important one hide until zoomed apart. Run after the labels
  // have re-rendered (two frames) whenever the view or what is drawn changes.
  const declutter = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = ref.current?.getContainer?.();
        if (el) declutterLabels(el);
      }),
    );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when anything drawn changes.
  useEffect(declutter, [
    declutter,
    loaded,
    vessels,
    ports,
    congestion,
    hazards,
    layers,
    zoom,
    inset.right,
    inset.top,
    selectedVesselId,
    bunkerPlan,
  ]);
  useEffect(() => {
    const map = loaded ? ref.current?.getMap() : undefined;
    if (!map) return;
    map.on("resize", declutter);
    return () => {
      map.off("resize", declutter);
    };
  }, [loaded, declutter]);

  const interactive = layers.traffic ? [...TRAFFIC_LAYER_IDS] : [];
  const insetValue = useMemo(
    () => ({ right: inset.right, bottom: inset.bottom, top: inset.top }),
    [inset.right, inset.bottom, inset.top],
  );
  return (
    <MapInsetContext.Provider value={insetValue}>
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
        onMoveEnd={(e) => {
          setZoom(e.viewState.zoom);
          declutter();
        }}
        onClick={onClick}
        onMouseMove={(e) => setCursor(e.features && e.features.length > 0 ? "pointer" : "")}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-left" showCompass={false} />
        {layers.weather && weather ? <WeatherLayer weather={weather} colors={colors} /> : null}
        {layers.hazards ? (
          <HazardLayer hazards={hazards} colors={colors} showId={hazardShown(focus)} />
        ) : null}
        {layers.hazards ? <StormLayer plan={plan} colors={colors} /> : null}
        <RouteLayer plan={plan} track={track} colors={colors} ports={ports} />
        {layers.traffic ? (
          <TrafficLayer traffic={traffic} colors={colors} selectedMmsi={selectedMmsi} />
        ) : null}
        {layers.congestion ? (
          <CongestionLayer
            congestion={congestion}
            ports={ports}
            compact={zoom < COMPACT_BELOW_ZOOM}
            aisMode={aisMode}
          />
        ) : null}
        {bunkerPlan ? <BunkerPlanLayer plan={bunkerPlan} /> : null}
        {layers.fleet ? (
          <FleetLayer vessels={vessels} selectedId={selectedVesselId} onSelect={onSelectVessel} />
        ) : null}
      </MapGL>
    </MapInsetContext.Provider>
  );
}
