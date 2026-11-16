/**
 * The map screen: offline basemap with AIS traffic, the managed fleet, weather, hazards and port
 * queues; a panel for the selected fleet vessel or public ship; the route tray after a plan.
 *
 * Selection lives in the address (`?vessel=<id>` or `?mmsi=<mmsi>`) so a view can be shared.
 * Selecting never calls the network beyond GETs: `POST /api/route-plan` only runs from a Plan
 * route button, and a different selection discards the previous plan.
 */
import { MapsIcon, Radar01Icon, ShipIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { type CommandGroupDef, useRegisterCommands } from "@/components/command-menu";
import { useMediaQuery } from "@/lib/motion";
import { useSourceStatus } from "@/lib/queries";
import {
  DEFAULT_LAYERS,
  LAYER_LABEL,
  type LayerKey,
  type LayerState,
  LayerToggles,
  type WeatherStatus,
} from "./layer-toggles";
import {
  publicShips,
  useCongestion,
  useHazards,
  usePlanRoute,
  usePorts,
  useTraffic,
  useVessels,
  useVoyage,
  useWeather,
} from "./map-data";
import { type MapFocus, MapView } from "./map-view";
import { RouteTray, TRAY_SNAPS } from "./route-tray";
import { ShipPanel } from "./ship-panel";
import { VesselPanel } from "./vessel-panel";

const EMPTY: never[] = [];
const PANEL_WIDTH_PX = 332;

/** The element's rendered height, kept current (the layer switches wrap and grow). */
function useElementHeight(el: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!el) return;
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return height;
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery("(min-width: 768px)", true);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [toggles, setToggles] = useState<HTMLElement | null>(null);
  const [snap, setSnap] = useState<number | string | null>(TRAY_SNAPS[1]);

  const vessels = useVessels();
  const traffic = useTraffic();
  const hazards = useHazards();
  const congestion = useCongestion();
  const ports = usePorts();
  const weather = useWeather(step);
  const planner = usePlanRoute();

  const vesselParam = params.get("vessel");
  const selectedVesselId = vesselParam && /^\d+$/.test(vesselParam) ? Number(vesselParam) : null;
  const selectedMmsi = selectedVesselId === null ? params.get("mmsi") : null;

  const vesselItems = vessels.data?.items ?? EMPTY;
  const trafficItems = useMemo(
    () => publicShips(traffic.data?.items ?? EMPTY, vesselItems),
    [traffic.data, vesselItems],
  );
  const portItems = ports.data?.items ?? EMPTY;
  const vessel = vesselItems.find((v) => v.id === selectedVesselId) ?? null;
  const ship = trafficItems.find((s) => s.mmsi === selectedMmsi) ?? null;
  const voyage = useVoyage(vessel?.voyageId);

  const plan = planner.data ?? null;
  const { reset: resetPlan } = planner;
  const subjectKey = vessel ? `v${vessel.id}` : ship ? `s${ship.mmsi}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a plan belongs to the subject it was made for.
  useEffect(() => {
    resetPlan();
    setSnap(TRAY_SNAPS[1]);
  }, [subjectKey, resetPlan]);

  const selectVessel = useCallback(
    (id: number, fly?: { lat: number; lon: number }) => {
      setParams({ vessel: String(id) }, { replace: true });
      if (fly) setFocus({ ...fly, key: `v${id}-${Date.now()}` });
    },
    [setParams],
  );
  const selectShip = useCallback(
    (mmsi: string, fly?: { lat: number; lon: number }) => {
      setParams({ mmsi }, { replace: true });
      if (fly) setFocus({ ...fly, key: `s${mmsi}-${Date.now()}` });
    },
    [setParams],
  );
  const clearSelection = useCallback(() => setParams({}, { replace: true }), [setParams]);

  const toggleLayer = useCallback(
    (key: LayerKey, on: boolean) => setLayers((l) => ({ ...l, [key]: on })),
    [],
  );

  const commands = useMemo<CommandGroupDef>(
    () => ({
      id: "map",
      heading: "Map",
      items: [
        ...vesselItems.flatMap((v) =>
          v.position
            ? [
                {
                  id: `map-vessel-${v.id}`,
                  label: v.name,
                  keywords: [v.imo, v.mmsi, "vessel", "fleet"],
                  hint: v.mmsi,
                  icon: ShipIcon,
                  onSelect: () => selectVessel(v.id, v.position ?? undefined),
                },
              ]
            : [],
        ),
        ...portItems.map((p) => ({
          id: `map-port-${p.id}`,
          label: p.name,
          keywords: [p.unlocode, "port"],
          hint: p.unlocode,
          icon: MapsIcon,
          onSelect: () =>
            setFocus({ lat: p.position.lat, lon: p.position.lon, key: `p${p.id}-${Date.now()}` }),
        })),
        ...trafficItems.map((s) => ({
          id: `map-ship-${s.mmsi}`,
          label: s.name ?? `MMSI ${s.mmsi}`,
          keywords: [s.mmsi, "ship", "ais"],
          hint: s.mmsi,
          icon: Radar01Icon,
          onSelect: () => selectShip(s.mmsi, { lat: s.lat, lon: s.lon }),
        })),
        ...(Object.keys(LAYER_LABEL) as LayerKey[]).map((key) => ({
          id: `map-layer-${key}`,
          label: `Toggle ${LAYER_LABEL[key].toLowerCase()} layer`,
          keywords: ["layer", "show", "hide"],
          onSelect: () => toggleLayer(key, !layers[key]),
        })),
      ],
    }),
    [vesselItems, portItems, trafficItems, layers, selectVessel, selectShip, toggleLayer],
  );
  useRegisterCommands(commands);

  const weatherStatus: WeatherStatus = weather.noSnapshot
    ? "none"
    : weather.data
      ? "ready"
      : weather.isError
        ? "error"
        : "loading";

  const trayFraction = plan ? (typeof snap === "number" ? snap : TRAY_SNAPS[1]) : 0;
  const containerHeight = container?.clientHeight ?? 0;
  const hasPanel = vessel !== null || ship !== null;
  const showPanel = hasPanel && (wide || !plan);
  // A failed read is said out loud: a failed hazard load must not read as "no hazards".
  const failed = [
    vessels.isError ? "the fleet" : null,
    traffic.isError ? "AIS traffic" : null,
    ports.isError ? "ports" : null,
    hazards.isError ? "hazards" : null,
    congestion.isError ? "port queues" : null,
  ].filter((x): x is string => x !== null);
  const sources = useSourceStatus();
  const aisMode = sources.data?.items.find((s) => s.source === "ais")?.mode ?? null;
  const togglesHeight = useElementHeight(toggles);
  // On a phone the panel covers the lower part of the map (at most 55 %).
  const phonePanel = !wide && showPanel ? containerHeight * 0.55 : 0;

  const panelClass = wide
    ? "pointer-events-auto absolute top-2 right-2 z-10 w-[332px] max-w-[calc(100%-1rem)]"
    : "pointer-events-auto absolute inset-x-2 bottom-2 z-10 max-h-[55%]";
  const panelStyle = wide ? { bottom: `calc(${trayFraction * 100}% + 8px)` } : undefined;

  return (
    <div ref={setContainer} className="relative h-full min-h-[24rem] overflow-hidden bg-ink-950">
      <h1 className="sr-only">Map</h1>
      <MapView
        layers={layers}
        vessels={vesselItems}
        traffic={trafficItems}
        hazards={hazards.data?.items ?? EMPTY}
        congestion={congestion.data?.items ?? EMPTY}
        ports={portItems}
        weather={weather.data}
        plan={plan}
        track={plan ? null : (voyage.data?.plannedTrack ?? null)}
        selectedVesselId={selectedVesselId}
        selectedMmsi={selectedMmsi}
        focus={focus}
        inset={{
          bottom: Math.max(trayFraction * containerHeight, phonePanel),
          right: wide && showPanel ? PANEL_WIDTH_PX : 0,
          top: togglesHeight + 8,
        }}
        ready={(vessels.isSuccess || vessels.isError) && (hazards.isSuccess || hazards.isError)}
        aisMode={aisMode}
        onSelectVessel={(v) => selectVessel(v.id)}
        onSelectShip={(mmsi) => selectShip(mmsi)}
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-start gap-1.5 p-2">
        <LayerToggles
          ref={setToggles}
          className="pointer-events-auto"
          layers={layers}
          onToggle={toggleLayer}
          trafficCount={traffic.data ? trafficItems.length : null}
          weatherStatus={weatherStatus}
          weather={weather.data}
          step={step}
          onStepCommit={setStep}
        />
        {failed.length > 0 ? (
          <p
            role="alert"
            className="pointer-events-auto rounded-sm border border-alarm/60 bg-ink-900 px-2 py-1 text-xs text-text-1"
          >
            Could not load {failed.join(", ")}.
          </p>
        ) : null}
      </div>

      {showPanel ? (
        <div className={panelClass} style={panelStyle}>
          {vessel ? (
            <VesselPanel
              vessel={vessel}
              plan={plan}
              planning={planner.isPending}
              planError={planner.error}
              onPlan={() => planner.mutate({ vessel: vessel.name })}
              onClose={clearSelection}
              className="max-h-full"
            />
          ) : ship ? (
            <ShipPanel
              ship={ship}
              ports={portItems}
              plan={plan}
              planning={planner.isPending}
              planError={planner.error}
              onPlan={(unlocode) => planner.mutate({ vessel: ship.mmsi, destination: unlocode })}
              onClose={clearSelection}
              className="max-h-full"
            />
          ) : null}
        </div>
      ) : selectedMmsi && traffic.data && !ship ? (
        <p className="pointer-events-auto absolute top-2 right-2 rounded-sm border border-line bg-ink-900 px-2 py-1 text-xs text-text-2">
          MMSI {selectedMmsi} is not in the latest AIS list.
        </p>
      ) : null}

      <p className="pointer-events-none absolute bottom-1 left-12 text-2xs text-text-3">
        Land: Natural Earth, public domain
      </p>

      {plan ? (
        <RouteTray
          plan={plan}
          container={container}
          snap={snap}
          onSnapChange={setSnap}
          onClose={() => planner.reset()}
        />
      ) : null}
    </div>
  );
}
