import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BunkerPlanLayer, bunkerPlanBounds } from "./bunker-plan-layer";
import { makeBunkerPlan, VESSELS } from "./map-fixtures";

/** A stand-in map: a flat projection at `scale` pixels per degree (zoomed out: small scale). */
const map: { current: unknown } = { current: undefined };
const flatMap = (scale: number) => ({
  project: ([lon, lat]: [number, number]) => ({ x: 400 + lon * scale, y: 300 - lat * scale }),
  getContainer: () => ({ clientWidth: 4000, clientHeight: 3000 }),
  on: () => undefined,
  off: () => undefined,
});

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
  useMap: () => ({ current: map.current }),
}));

afterEach(() => {
  cleanup();
  map.current = undefined;
});

const renderLayer = (plan = makeBunkerPlan()) =>
  render(
    <MemoryRouter>
      <BunkerPlanLayer plan={plan} />
    </MemoryRouter>,
  );

describe("BunkerPlanLayer", () => {
  it("labels each option by rank, supplier and port, over its total as a fact chip", () => {
    renderLayer();
    const plan = makeBunkerPlan();
    for (const option of plan.options) {
      const row = screen.getByTestId(`bunker-port-${option.optionId}`);
      expect(row.textContent).toContain(`${option.rank} · ${option.supplier}, ${option.port.name}`);
      const chip = row.querySelector(`[data-fact-id="${option.totalCost.id}"]`);
      expect(chip?.getAttribute("data-slot")).toBe("fact-chip");
    }
    // Cited numbers never animate.
    expect(document.querySelector("number-flow-react")).toBeNull();
  });

  it("rings the recommended option in its own tone and the others in plan slate", () => {
    renderLayer();
    expect(screen.getByTestId("bunker-port-MTMLA-kestrel").getAttribute("data-best")).toBe("true");
    const rings = screen.getAllByTestId("bunker-ring").map((r) => r.getAttribute("data-tone"));
    expect(rings.filter((t) => t === "recommended")).toHaveLength(1);
    expect(rings.filter((t) => t === "option").length).toBeGreaterThan(0);
  });

  it("an infeasible option says so and is ringed as one", () => {
    const plan = makeBunkerPlan();
    const [best, second, third] = plan.options;
    if (!best || !second || !third) throw new Error("fixture needs three options");
    // Far from the others, so it gets its own ring.
    const far = {
      ...third,
      feasible: false,
      port: { ...third.port, position: { lat: 51.95, lon: 4.14 } },
    };
    renderLayer({ ...plan, options: [best, second, far] });
    const row = screen.getByTestId("bunker-port-GIGIB-straitline");
    expect(row.getAttribute("data-feasible")).toBe("false");
    expect(within(row).getByText("infeasible")).toBeTruthy();
    const rings = screen.getAllByTestId("bunker-ring").map((r) => r.getAttribute("data-tone"));
    expect(rings).toContain("infeasible");
  });

  it("options whose ports are drawn together stack in one plate", () => {
    // Zoomed out: Algeciras and Gibraltar are about one pixel apart.
    map.current = flatMap(10);
    renderLayer();
    expect(screen.getAllByTestId("marker")).toHaveLength(2);
    const plate = screen.getByTestId("bunker-plate-ESALG-nordwind");
    const rows = within(plate)
      .getAllByTestId(/^bunker-port-/)
      .map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["bunker-port-ESALG-nordwind", "bunker-port-GIGIB-straitline"]);
  });

  it("zoomed in, the same ports get a plate each", () => {
    map.current = flatMap(2000);
    renderLayer();
    expect(screen.getAllByTestId("marker")).toHaveLength(3);
    expect(screen.getByTestId("bunker-plate-GIGIB-straitline")).toBeTruthy();
  });

  it("without a map to measure with, only identical positions stack", () => {
    renderLayer();
    expect(screen.getAllByTestId("marker")).toHaveLength(3);
  });

  it("shows a supplier's name as text", () => {
    const plan = makeBunkerPlan();
    const [best, ...rest] = plan.options;
    if (!best) throw new Error("fixture needs an option");
    renderLayer({
      ...plan,
      options: [{ ...best, supplier: 'Kestrel <img src=x onerror="alert(1)">' }, ...rest],
    });
    expect(screen.getByTestId("bunker-port-MTMLA-kestrel").textContent).toContain(
      'Kestrel <img src=x onerror="alert(1)">',
    );
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("bunkerPlanBounds", () => {
  it("covers every option's port and the plan's vessel", () => {
    const plan = makeBunkerPlan();
    expect(bunkerPlanBounds(plan, VESSELS)).toEqual([
      [-5.4562, 33.1386],
      [27.0159, 36.1408],
    ]);
  });

  it("covers the ports alone when the vessel has no position", () => {
    const plan = makeBunkerPlan();
    expect(bunkerPlanBounds(plan, [])).toEqual([
      [-5.4562, 35.88],
      [14.5, 36.1408],
    ]);
  });

  it("is null for a plan with no options", () => {
    expect(bunkerPlanBounds({ ...makeBunkerPlan(), options: [] }, [])).toBeNull();
  });
});
