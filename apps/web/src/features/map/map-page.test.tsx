import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ReactNode, useImperativeHandle } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenuProvider } from "@/components/command-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import {
  CONGESTION,
  HAZARDS,
  makePlan,
  PORTS,
  TRAFFIC,
  VESSEL_DETAIL,
  VESSELS,
  VOYAGE,
  WEATHER,
} from "./map-fixtures";
import { MapPage } from "./map-page";

// WebGL does not exist in happy-dom: the map becomes a plain tree that records what is drawn.
vi.mock("react-map-gl/maplibre", () => ({
  Map: forwardRef(function MapMock({ children }: { children?: ReactNode }, ref) {
    useImperativeHandle(ref, () => ({
      fitBounds: () => undefined,
      easeTo: () => undefined,
      getZoom: () => 4,
      getMap: () => ({ hasImage: () => true, addImage: () => undefined }),
    }));
    return <div data-testid="map">{children}</div>;
  }),
  Marker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Source: ({ id, children }: { id: string; children?: ReactNode }) => (
    <div data-testid={`source-${id}`}>{children}</div>
  ),
  Layer: ({ id }: { id: string }) => <div data-testid={`layer-${id}`} />,
  NavigationControl: () => null,
}));

interface Call {
  method: string;
  path: string;
  body: string | null;
}
let calls: Call[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi({ weather = "ok" as "ok" | "none" } = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      calls.push({ method: init?.method ?? "GET", path, body: (init?.body as string) ?? null });
      if (path === "/api/vessels") return json({ items: VESSELS });
      if (path === "/api/vessels/1") return json(VESSEL_DETAIL);
      if (path === "/api/voyages/1") return json(VOYAGE);
      if (path === "/api/traffic") return json(TRAFFIC);
      if (path === "/api/hazards") return json(HAZARDS);
      if (path === "/api/congestion") return json(CONGESTION);
      if (path === "/api/ports") return json(PORTS);
      if (path.startsWith("/api/weather"))
        return weather === "none" ? json({ error: "no_weather_snapshot" }, 404) : json(WEATHER);
      if (path === "/api/route-plan") return json(makePlan());
      return json({ error: "not_found" }, 404);
    }),
  );
}

function renderPage(initial = "/") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <CommandMenuProvider>
          <MemoryRouter initialEntries={[initial]}>
            <MapPage />
          </MemoryRouter>
        </CommandMenuProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => stubApi());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MapPage", () => {
  it("no weather snapshot disables the layer", async () => {
    stubApi({ weather: "none" });
    renderPage();
    const toggle = await screen.findByRole("button", { name: /weather/i });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(true));
    expect(toggle.textContent).toMatch(/no snapshot/i);
    expect(screen.queryByTestId("layer-weather-points")).toBeNull();
  });

  it("draws the weather layer when a snapshot exists and the layer is switched on", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", { name: /weather/i });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);
    expect(await screen.findByTestId("layer-weather-points")).toBeTruthy();
    expect(screen.getByTestId("forecast-time").textContent).toMatch(/14 Nov 08:00Z/);
  });

  it("selecting a vessel sends no POST", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("fleet-vessel-1"));
    expect(await screen.findByRole("region", { name: "Vessel panel" })).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/vessels/1")).toBe(true));
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("opens a vessel from the address, still without a POST", async () => {
    renderPage("/?vessel=1");
    expect(await screen.findByRole("region", { name: "Vessel panel" })).toBeTruthy();
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("the alerted vessel carries the ripple and the others do not", async () => {
    renderPage();
    await screen.findByTestId("fleet-vessel-1");
    expect(within(screen.getByTestId("fleet-vessel-1")).getByTestId("fleet-ripple")).toBeTruthy();
    expect(within(screen.getByTestId("fleet-vessel-2")).queryByTestId("fleet-ripple")).toBeNull();
    expect(screen.getAllByTestId("fleet-ripple")).toHaveLength(1);
  });

  it("plans a route only when Plan route is pressed, then opens the tray with facts", async () => {
    renderPage("/?vessel=1");
    const button = await screen.findByRole("button", { name: "Plan route" });
    expect(calls.some((c) => c.path === "/api/route-plan")).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByTestId("route-row-B")).toBeTruthy();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe("/api/route-plan");
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ vessel: "MV Aegean Pioneer" });
    // The recommended route is drawn.
    expect(screen.getByTestId("layer-route-recommended")).toBeTruthy();
  });

  it("a public ship shows untrusted text as text and plans to a chosen port", async () => {
    renderPage("/?mmsi=211121690");
    const panel = await screen.findByRole("region", { name: "Ship panel" });
    // The destination contains markup: it is shown literally, never parsed.
    expect(within(panel).getByText("PIRAEUS <b>x</b>")).toBeTruthy();
    expect(panel.querySelector("b")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Plan route" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
