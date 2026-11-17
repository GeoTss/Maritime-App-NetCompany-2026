import type { RoutePlanView } from "@pharos/shared";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapColors } from "./basemap-style";
import { makeFuelPlan, makePlan, PORTS } from "./map-fixtures";
import { planShortfall, planStop, RouteLayer } from "./route-layer";

vi.mock("react-map-gl/maplibre", () => ({
  Marker: ({
    children,
    longitude,
    latitude,
  }: {
    children?: ReactNode;
    longitude: number;
    latitude: number;
  }) => (
    <div data-testid="marker" data-lon={longitude} data-lat={latitude}>
      {children}
    </div>
  ),
  Source: ({ data, children }: { data: unknown; children?: ReactNode }) => (
    <div data-testid="routes-source" data-geojson={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Layer: () => null,
  useMap: () => ({ current: undefined }),
}));

afterEach(cleanup);

const colors = { plan: "a", alarm: "b", beacon: "c" } as unknown as MapColors;
const ports = [
  ...PORTS.items,
  {
    id: 3,
    name: "Marsaxlokk",
    unlocode: "MTMLA",
    position: { lat: 35.82, lon: 14.54 },
    isEu: true,
  },
];

const roles = () => {
  const data = JSON.parse(screen.getByTestId("routes-source").dataset.geojson ?? "{}") as {
    features: { properties: { role: string } }[];
  };
  return data.features.map((f) => f.properties.role);
};

describe("RouteLayer", () => {
  it("draws the stop marker at the port and the shortfall marker", () => {
    const plan = makeFuelPlan();
    render(<RouteLayer plan={plan} track={null} colors={colors} ports={ports} />);
    const stop = screen.getByTestId("stop-marker");
    const arrival = plan.result.stopPlans[0]?.fuel?.breakpoints.find(
      (b) => b.kind === "stop_arrival",
    );
    const marker = stop.closest("[data-testid=marker]") as HTMLElement;
    expect(Number(marker.dataset.lon)).toBe(arrival?.position.lon);
    expect(Number(marker.dataset.lat)).toBe(arrival?.position.lat);
    expect(stop.textContent).toBe("Bunker stop, Marsaxlokk");
    const short = screen.getByTestId("shortfall-marker");
    const at = short.closest("[data-testid=marker]") as HTMLElement;
    expect(Number(at.dataset.lon)).toBe(-8.1);
    expect(Number(at.dataset.lat)).toBe(46.2);
    expect(short.textContent).toBe("Below the LSMGO margin, ignoring fuel on board");
    expect(short.querySelector("[data-flag=V]")).not.toBeNull();
    // Both routes that run short are drawn ruled out; none is drawn recommended without its track.
    expect(roles()).toEqual(["infeasible", "infeasible", "infeasible"]);
  });

  it("draws the stop plan's track as recommended when the view carries it", () => {
    const base = makeFuelPlan();
    const plan: RoutePlanView = {
      ...base,
      candidates: [
        ...base.candidates,
        {
          id: "MTMLA-kestrel",
          label: "Via Marsaxlokk",
          points: [
            { lat: 33, lon: 27 },
            { lat: 35.82, lon: 14.54 },
            { lat: 51.9, lon: 4.1 },
          ],
        },
      ],
    };
    render(<RouteLayer plan={plan} track={null} colors={colors} ports={ports} />);
    expect(roles()).toContain("recommended");
  });

  it("names the stop by its code without a port list, and draws no markers for an AIS ship", () => {
    expect(planStop(makeFuelPlan())?.name).toBe("MTMLA");
    expect(planStop(makePlan())).toBeNull();
    expect(planShortfall(makePlan())).toBeNull();
    expect(planStop(makeFuelPlan({ infeasible: true }))).toBeNull();
  });
});
