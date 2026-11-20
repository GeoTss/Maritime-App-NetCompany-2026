import type { BunkerPlanView, RoutePlanView } from "@pharos/shared";
import { cleanup, render, waitFor } from "@testing-library/react";
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { bunkerPlanBounds } from "./bunker-plan-layer";
import { DEFAULT_LAYERS } from "./layer-toggles";
import {
  CONGESTION,
  HAZARDS,
  makeBunkerPlan,
  makeStoredRoutePlan,
  PORTS,
  TRAFFIC,
  VESSELS,
} from "./map-fixtures";
import { MapView, type MapViewProps } from "./map-view";
import { planBounds } from "./route-layer";

/** A canvas element 1200 by 800 px (happy-dom lays nothing out). */
function wideCanvas(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 1200 });
  Object.defineProperty(el, "clientHeight", { value: 800 });
  return el;
}

/** Every `fitBounds` any stub map was asked for, across mounts. */
const fits: { bounds: unknown; options: { padding: Record<string, number> } }[] = [];

// Like react-map-gl 8: the map is created after the first commit (in a resolved promise), so the
// ref is null until then; `onLoad` fires later still, and children render once the map exists.
vi.mock("react-map-gl/maplibre", () => ({
  Map: forwardRef(function MapStub(
    { children, onLoad }: { children?: ReactNode; onLoad?: () => void },
    ref,
  ) {
    const [created, setCreated] = useState(false);
    useEffect(() => {
      let live = true;
      Promise.resolve().then(() => live && setCreated(true));
      return () => {
        live = false;
      };
    }, []);
    useImperativeHandle(
      ref,
      () =>
        created
          ? {
              fitBounds: (bounds: unknown, options: (typeof fits)[number]["options"]) =>
                fits.push({ bounds, options }),
              easeTo: () => undefined,
              getZoom: () => 4,
              // Wide, and every point in view: neither the first view nor a selection reframes.
              getContainer: wideCanvas,
              project: () => ({ x: 600, y: 400 }),
              getMap: () => ({
                hasImage: () => true,
                addImage: () => undefined,
                on: () => undefined,
                off: () => undefined,
              }),
            }
          : null,
      [created],
    );
    useEffect(() => {
      if (created) onLoad?.();
    }, [created, onLoad]);
    return <div data-testid="map">{created ? children : null}</div>;
  }),
  Marker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Source: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Layer: () => null,
  NavigationControl: () => null,
  useMap: () => ({ current: undefined }),
}));

const INSET = { bottom: 300, right: 332, top: 130 };

const props = (over: Partial<MapViewProps> = {}): MapViewProps => ({
  layers: DEFAULT_LAYERS,
  vessels: VESSELS,
  traffic: TRAFFIC.items,
  hazards: HAZARDS.items,
  congestion: CONGESTION.items,
  ports: PORTS.items,
  weather: undefined,
  plan: null,
  bunkerPlan: null,
  track: null,
  selectedVesselId: null,
  selectedMmsi: null,
  focus: null,
  inset: INSET,
  ready: true,
  aisMode: null,
  onSelectVessel: () => undefined,
  onSelectShip: () => undefined,
  ...over,
});

const ui = (p: MapViewProps) => (
  <MemoryRouter>
    <TooltipProvider>
      <MapView {...p} />
    </TooltipProvider>
  </MemoryRouter>
);

beforeEach(() => {
  fits.length = 0;
});
afterEach(cleanup);

/** The padding every plan fit uses: clear of the layer switches, the tray and the panel. */
const PLAN_PADDING = {
  top: INSET.top + 24,
  left: 24,
  bottom: INSET.bottom + 24,
  right: INSET.right + 24,
};

describe("MapView framing a stored plan", () => {
  it("frames a bunker plan already in the cache once the map has loaded", async () => {
    const plan: BunkerPlanView = makeBunkerPlan();
    // The plan and the fleet are there on the first commit, before the map exists.
    render(ui(props({ bunkerPlan: plan })));
    await waitFor(() => expect(fits).toHaveLength(1));
    expect(fits[0]?.bounds).toEqual(bunkerPlanBounds(plan, VESSELS));
    expect(fits[0]?.options.padding).toEqual(PLAN_PADDING);
  });

  it("frames a route plan already in the cache once the map has loaded", async () => {
    const plan: RoutePlanView = makeStoredRoutePlan(2);
    render(ui(props({ plan })));
    await waitFor(() => expect(fits).toHaveLength(1));
    expect(fits[0]?.bounds).toEqual(planBounds(plan));
    expect(fits[0]?.options.padding).toEqual(PLAN_PADDING);
  });

  it("frames the same cached plan again on a remount", async () => {
    const plan = makeBunkerPlan();
    const first = render(ui(props({ bunkerPlan: plan })));
    await waitFor(() => expect(fits).toHaveLength(1));
    first.unmount();
    render(ui(props({ bunkerPlan: plan })));
    await waitFor(() => expect(fits).toHaveLength(2));
    expect(fits[1]?.bounds).toEqual(fits[0]?.bounds);
  });

  it("frames each plan once: a new inset does not reframe it", async () => {
    const plan = makeBunkerPlan();
    const view = render(ui(props({ bunkerPlan: plan })));
    await waitFor(() => expect(fits).toHaveLength(1));
    view.rerender(ui(props({ bunkerPlan: plan, inset: { ...INSET, top: 60 } })));
    view.rerender(ui(props({ bunkerPlan: plan, ready: true, inset: { ...INSET, right: 0 } })));
    await new Promise((r) => setTimeout(r, 20));
    expect(fits).toHaveLength(1);
  });

  it("waits for the fleet before framing a bunker plan, then includes the vessel", async () => {
    const plan = makeBunkerPlan();
    const view = render(ui(props({ bunkerPlan: plan, ready: false, vessels: [] })));
    await waitFor(() => expect(view.getByTestId("map").childElementCount).toBeGreaterThan(0));
    expect(fits).toHaveLength(0);
    view.rerender(ui(props({ bunkerPlan: plan, ready: true })));
    await waitFor(() => expect(fits).toHaveLength(1));
    expect(fits[0]?.bounds).toEqual(bunkerPlanBounds(plan, VESSELS));
  });

  it("a plan cleared and shown again is framed again", async () => {
    const plan = makeStoredRoutePlan(2);
    const view = render(ui(props({ plan })));
    await waitFor(() => expect(fits).toHaveLength(1));
    view.rerender(ui(props({ plan: null })));
    view.rerender(ui(props({ plan })));
    await waitFor(() => expect(fits).toHaveLength(2));
  });
});
