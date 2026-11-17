/**
 * The map screen: offline basemap with AIS traffic, the managed fleet, weather, hazards and port
 * queues; a panel for the selected fleet vessel or public ship; the route tray after a plan.
 *
 * Selection lives in the address (`?vessel=<id>` or `?mmsi=<mmsi>`) so a view can be shared, and
 * so does a stored plan to draw (`?routePlan=<id>`, `?bunkerPlan=<id>`): an answer links to the
 * exact calculation it cited, read with a GET, never planned again. Selecting never calls the
 * network beyond GETs: `POST /api/route-plan` only runs from a Plan route button, which replaces a
 * stored route plan, and a different selection discards the previous route plan. A bunker plan
 * stays until its own Clear.
 */
import { MapsIcon, Radar01Icon, ShipIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { useSearchParams } from "react-router";
import { type CommandGroupDef, useRegisterCommands } from "@/components/command-menu";
import { StateFlag } from "@/components/primitives/state-flag";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { setDraft } from "@/features/assistant/assistant-store";
import { useAttention } from "@/lib/attention";
import { useMediaQuery } from "@/lib/motion";
import { useSourceStatus } from "@/lib/queries";
import { BunkerPlanLegend } from "./bunker-plan-layer";
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
  useBunkerPlan,
  useCongestion,
  useHazards,
  usePlanRoute,
  usePorts,
  useStopNames,
  useStoredRoutePlan,
  useTraffic,
  useVessels,
  useVoyage,
  useWeather,
} from "./map-data";
import { type MapFocus, MapView } from "./map-view";
import { NeedsYou } from "./needs-you";
import { PlanChip, planChipText } from "./plan-chip";
import { RouteTray, TRAY_SNAPS } from "./route-tray";
import { ShipPanel } from "./ship-panel";
import { VesselPanel } from "./vessel-panel";

const EMPTY: never[] = [];
const PANEL_WIDTH_PX = 332;

/** A calculation id from the address, or null when absent or not a whole number. */
const idParam = (value: string | null): number | null =>
  value && /^\d+$/.test(value) ? Number(value) : null;

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

/** After a command-menu pick, the panel's title takes focus (the menu gives focus back first). */
function focusPanelHeading() {
  window.setTimeout(() => {
    const heading = document.querySelector<HTMLElement>(
      '[aria-label="Ship panel"] h2, [aria-label="Vessel panel"] h2',
    );
    heading?.focus();
  }, 150);
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
  const attention = useAttention();
  const needsPanel = usePanelRef();
  const [needsOpen, setNeedsOpen] = useState(true);
  const [needsDrawer, setNeedsDrawer] = useState(false);

  const vessels = useVessels();
  const traffic = useTraffic();
  const hazards = useHazards();
  const congestion = useCongestion();
  const ports = usePorts();
  const weather = useWeather(step);
  const planner = usePlanRoute();

  const selectedVesselId = idParam(params.get("vessel"));
  const selectedMmsi = selectedVesselId === null ? params.get("mmsi") : null;
  const routePlanId = idParam(params.get("routePlan"));
  const bunkerPlanId = idParam(params.get("bunkerPlan"));
  const storedRoute = useStoredRoutePlan(routePlanId);
  const bunker = useBunkerPlan(bunkerPlanId);

  const vesselItems = vessels.data?.items ?? EMPTY;
  const trafficItems = useMemo(
    () => publicShips(traffic.data?.items ?? EMPTY, vesselItems),
    [traffic.data, vesselItems],
  );
  const portItems = ports.data?.items ?? EMPTY;
  const vessel = vesselItems.find((v) => v.id === selectedVesselId) ?? null;
  const ship = trafficItems.find((s) => s.mmsi === selectedMmsi) ?? null;
  const voyage = useVoyage(vessel?.voyageId);

  // A stored plan from the address, else the one just planned.
  const plan = storedRoute.data ?? planner.data ?? null;
  const stopNames = useStopNames((plan?.result.stopPlans.length ?? 0) > 0);
  const bunkerPlan = bunker.data ?? null;
  const { reset: resetPlan } = planner;
  const subjectKey = vessel ? `v${vessel.id}` : ship ? `s${ship.mmsi}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a plan belongs to the subject it was made for.
  useEffect(() => {
    resetPlan();
    setSnap(TRAY_SNAPS[1]);
  }, [subjectKey, resetPlan]);

  /** Edits the address in place (replace): the other parameters stay as they are. */
  const editParams = useCallback(
    (edit: (next: URLSearchParams) => void) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          edit(next);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  // A route plan belongs to the subject it was made for: another selection drops it.
  const select = useCallback(
    (key: "vessel" | "mmsi", value: string) =>
      editParams((next) => {
        if (next.get(key) !== value) next.delete("routePlan");
        next.delete(key === "vessel" ? "mmsi" : "vessel");
        next.set(key, value);
      }),
    [editParams],
  );
  const selectVessel = useCallback(
    (id: number, fly?: { lat: number; lon: number }) => {
      select("vessel", String(id));
      if (fly) setFocus({ ...fly, key: `v${id}-${Date.now()}` });
    },
    [select],
  );
  const selectShip = useCallback(
    (mmsi: string, fly?: { lat: number; lon: number }) => {
      select("mmsi", mmsi);
      if (fly) setFocus({ ...fly, key: `s${mmsi}-${Date.now()}` });
    },
    [select],
  );
  const clearSelection = useCallback(
    () =>
      editParams((next) => {
        for (const key of ["vessel", "mmsi", "routePlan"]) next.delete(key);
      }),
    [editParams],
  );
  const clearPlan = useCallback(
    (key: "routePlan" | "bunkerPlan") => editParams((next) => next.delete(key)),
    [editParams],
  );
  /** Plans again (a POST): a new plan replaces the stored one the address was showing. */
  const planAgain = (input: Parameters<typeof planner.mutate>[0]) => {
    if (routePlanId !== null) clearPlan("routePlan");
    planner.mutate(input);
  };
  const closeTray = () => {
    if (routePlanId !== null) clearPlan("routePlan");
    planner.reset();
  };

  // While the route tray is open on a wide screen the panel folds to its header row, so the plan
  // has the map; Expand opens it again for that plan.
  const [expandedFor, setExpandedFor] = useState<number | null>(null);
  const planKey = plan?.calculationId ?? null;
  const fold =
    wide && plan
      ? {
          folded: expandedFor !== planKey,
          onFoldedChange: (folded: boolean) => setExpandedFor(folded ? null : planKey),
        }
      : undefined;
  const panelFolded = fold?.folded ?? false;

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
                  onSelect: () => {
                    selectVessel(v.id, v.position ?? undefined);
                    focusPanelHeading();
                  },
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
          minQuery: 2,
          onSelect: () => {
            selectShip(s.mmsi, { lat: s.lat, lon: s.lon });
            focusPanelHeading();
          },
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
  // Folded, the panel is its header row and needs no height of its own.
  const panelStyle =
    wide && !panelFolded ? { bottom: `calc(${trayFraction * 100}% + 8px)` } : undefined;
  // The switches and plan chips stop short of the panel on a wide screen, wrapping instead.
  const topRowStyle =
    wide && showPanel ? { maxWidth: `calc(100% - ${PANEL_WIDTH_PX + 8}px)` } : undefined;

  const track = plan ? null : (voyage.data?.plannedTrack ?? null);
  const chips = [
    routePlanId !== null
      ? {
          key: "routePlan" as const,
          ...planChipText("route", routePlanId, storedRoute, `Showing route plan ${routePlanId}`),
        }
      : null,
    bunkerPlanId !== null
      ? {
          key: "bunkerPlan" as const,
          ...planChipText(
            "bunker",
            bunkerPlanId,
            bunker,
            `Showing bunker plan ${bunkerPlanId} · ${bunkerPlan?.options.length ?? 0} option${bunkerPlan?.options.length === 1 ? "" : "s"}`,
          ),
        }
      : null,
  ].filter((c) => c !== null);

  const toggleNeeds = () => {
    if (!wide) {
      setNeedsDrawer((o) => !o);
      return;
    }
    const panel = needsPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };
  const flyToHazard = (id: string) => {
    const h = hazards.data?.items.find((x) => x.id === id);
    if (h) setFocus({ lat: h.lat, lon: h.lon, key: `h${id}-${Date.now()}` });
  };
  const needs = (
    <NeedsYou
      items={attention.items}
      isPending={attention.isPending}
      vessels={vesselItems}
      selectedVesselId={selectedVesselId}
      onAsk={(q) => {
        setDraft(q);
        setNeedsDrawer(false);
      }}
      onShowVessel={(id) => {
        const v = vesselItems.find((x) => x.id === id);
        selectVessel(id, v?.position ?? undefined);
        setNeedsDrawer(false);
      }}
      onFlyHazard={(id) => {
        flyToHazard(id);
        setNeedsDrawer(false);
      }}
    />
  );
  const needsOpenNow = wide ? needsOpen : needsDrawer;

  const mapScreen = (
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
        bunkerPlan={bunkerPlan}
        track={track}
        selectedVesselId={selectedVesselId}
        selectedMmsi={selectedMmsi}
        focus={focus}
        inset={{
          bottom: Math.max(trayFraction * containerHeight, phonePanel),
          right: wide && showPanel && !panelFolded ? PANEL_WIDTH_PX : 0,
          top: togglesHeight + 8,
        }}
        ready={(vessels.isSuccess || vessels.isError) && (hazards.isSuccess || hazards.isError)}
        aisMode={aisMode}
        onSelectVessel={(v) => selectVessel(v.id)}
        onSelectShip={(mmsi) => selectShip(mmsi)}
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-start gap-1.5 p-2">
        <div
          ref={setToggles}
          className="flex max-w-full flex-wrap items-start gap-1.5"
          style={topRowStyle}
        >
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto h-8 bg-ink-900"
            aria-expanded={needsOpenNow}
            onClick={toggleNeeds}
          >
            <StateFlag kind="K" />
            {wide && needsOpen ? "Hide Needs you" : "Needs you"}
            {attention.items.length > 0 ? (
              <b className="font-semibold">{attention.items.length}</b>
            ) : null}
          </Button>
          <LayerToggles
            className="pointer-events-auto"
            layers={layers}
            onToggle={toggleLayer}
            trafficCount={traffic.data ? trafficItems.length : null}
            weatherStatus={weatherStatus}
            weather={weather.data}
            step={step}
            onStepCommit={setStep}
          />
          {chips.length > 0 ? (
            <div className="pointer-events-auto flex max-w-full flex-col items-start gap-1.5">
              {chips.map((chip) => (
                <PlanChip
                  key={chip.key}
                  label={chip.label}
                  failed={chip.failed}
                  onClear={() => clearPlan(chip.key)}
                />
              ))}
              {bunkerPlan ? <BunkerPlanLegend track={track !== null && track.length >= 2} /> : null}
            </div>
          ) : null}
        </div>
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
              onPlan={() => planAgain({ vessel: vessel.name })}
              onClose={clearSelection}
              className="max-h-full"
              fold={fold}
            />
          ) : ship ? (
            <ShipPanel
              ship={ship}
              ports={portItems}
              plan={plan}
              planning={planner.isPending}
              planError={planner.error}
              onPlan={(unlocode) => planAgain({ vessel: ship.mmsi, destination: unlocode })}
              onClose={clearSelection}
              className="max-h-full"
              fold={fold}
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
          names={stopNames}
          container={container}
          snap={snap}
          onSnapChange={setSnap}
          onClose={closeTray}
        />
      ) : null}
    </div>
  );

  if (!wide) {
    return (
      <>
        {mapScreen}
        <Drawer open={needsDrawer} onOpenChange={setNeedsDrawer}>
          <DrawerContent className="h-[80vh]">
            <DrawerTitle className="sr-only">Needs you</DrawerTitle>
            <DrawerDescription className="sr-only">
              What waits on you: proposals, alerts, quotes and hazards.
            </DrawerDescription>
            {needs}
          </DrawerContent>
        </Drawer>
      </>
    );
  }
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0">
      <ResizablePanel
        id="needs-you"
        panelRef={needsPanel}
        defaultSize={280}
        minSize={220}
        maxSize="40%"
        collapsible
        collapsedSize={0}
        onResize={(size) => setNeedsOpen(size.inPixels > 0)}
      >
        <div className="h-full min-w-0 overflow-hidden border-r border-line">{needs}</div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="map-canvas" minSize="30%">
        {mapScreen}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
