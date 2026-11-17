import type { Fact } from "@pharos/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ReactNode, useImperativeHandle } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenuProvider } from "@/components/command-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { CongestionLayer, congestionSourceText } from "./congestion-layer";
import {
  CONGESTION,
  HAZARDS,
  makeBunkerPlan,
  makePlan,
  makeStoredRoutePlan,
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
  useMap: () => ({ current: undefined }),
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

function withTwin() {
  const first = TRAFFIC.items[0];
  if (!first) throw new Error("fixture needs a ship");
  return { items: [{ ...first, mmsi: VESSELS[0]?.mmsi ?? "999000001" }, ...TRAFFIC.items] };
}

function stubApi({
  weather = "ok" as "ok" | "none",
  weatherView = WEATHER,
  failing = [] as string[],
  twin = false,
  detail = VESSEL_DETAIL,
} = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      calls.push({ method: init?.method ?? "GET", path, body: (init?.body as string) ?? null });
      if (failing.includes(path)) return json({ error: "db_down" }, 503);
      if (path === "/api/sources")
        return json({
          items: [
            {
              source: "ais",
              mode: "recorded",
              detail: null,
              updatedAt: "2026-11-14T08:00:00.000Z",
            },
          ],
        });
      if (path === "/api/inbox")
        return json({
          items: [
            {
              documentId: 7,
              sender: "quotes@supplier.test",
              subject: "Kestrel LSMGO quote",
              receivedAt: "2026-11-14T08:00:00.000Z",
              kind: "email",
              extractionStatus: "needs_review",
            },
          ],
        });
      if (path === "/api/recommendations") return json({ items: [] });
      if (path === "/api/vessels") return json({ items: VESSELS });
      if (path === "/api/vessels/1") return json(detail);
      if (path === "/api/voyages/1") return json(VOYAGE);
      if (path === "/api/traffic") return json(twin ? withTwin() : TRAFFIC);
      if (path === "/api/hazards") return json(HAZARDS);
      if (path === "/api/congestion") return json(CONGESTION);
      if (path === "/api/ports") return json(PORTS);
      if (path.startsWith("/api/weather"))
        return weather === "none" ? json({ error: "no_weather_snapshot" }, 404) : json(weatherView);
      if (path === "/api/route-plan") return json(makePlan());
      if (path === "/api/route-plans/2") return json(makeStoredRoutePlan(2));
      if (path === "/api/bunker-plans/1") return json(makeBunkerPlan());
      return json({ error: "not_found" }, 404);
    }),
  );
}

/** The address the page has written, so a test can read what Clear left behind. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(initial = "/") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <CommandMenuProvider>
          <MemoryRouter initialEntries={[initial]}>
            <MapPage />
            <LocationProbe />
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
  it("heads the Needs-you column with the count and lists its items", async () => {
    renderPage();
    const column = await screen.findByRole("region", { name: "Needs you" });
    expect(within(column).getByRole("heading", { name: "Needs you" })).toBeTruthy();
    await waitFor(() => expect(within(column).getByTestId("needs-count").textContent).toBe("3"));
    expect(within(column).getByText("Kestrel LSMGO quote")).toBeTruthy();
    expect(within(column).getByRole("button", { name: "Ask where to bunker" })).toBeTruthy();
  });

  it("no weather snapshot disables the layer", async () => {
    stubApi({ weather: "none" });
    renderPage();
    const toggle = await screen.findByRole("button", { name: /weather/i });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(true));
    expect(toggle.textContent).toMatch(/no snapshot/i);
    expect(screen.queryByTestId("layer-weather-points")).toBeNull();
  });

  it("draws the weather layer from the start when a snapshot exists; the switch hides it", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", { name: /weather/i });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByTestId("layer-weather-points")).toBeTruthy();
    expect(screen.getByTestId("forecast-time").textContent).toMatch(/14 Nov 08:00Z/);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByTestId("layer-weather-points")).toBeNull());
  });

  it("forecast label reads stepTimes", async () => {
    // Irregular times: any start-plus-steps arithmetic would show 08:00Z, not these.
    const stepTimes = WEATHER.stepTimes.map((_, k) =>
      new Date(Date.parse("2026-12-01T05:30:00.000Z") + k * 7 * 3_600_000).toISOString(),
    );
    stubApi({ weatherView: { ...WEATHER, stepTimes, validAt: stepTimes[0] ?? "" } });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("forecast-time").textContent).toMatch(/1 Dec 05:30Z/),
    );
  });

  it("a failed hazard or port-queue load is said out loud, not drawn as none", async () => {
    stubApi({ failing: ["/api/hazards", "/api/congestion"] });
    renderPage();
    // 5xx reads are retried twice before they count as failed.
    await waitFor(
      () => {
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toMatch(/hazards/);
        expect(alert.textContent).toMatch(/port queues/);
      },
      { timeout: 8000 },
    );
  }, 10_000);

  it("port figures say what they are: simulated, or the AIS source's mode", () => {
    render(
      <CongestionLayer
        congestion={CONGESTION.items}
        ports={PORTS.items}
        compact={false}
        aisMode="recorded"
      />,
    );
    const words = screen.getAllByTestId("congestion-source").map((el) => el.textContent);
    expect(words).toContain("simulated");
    expect(words).toContain("recorded");
    expect(words).not.toContain("seed");
    expect(words).not.toContain("ais");
    expect(congestionSourceText("ais", null)).toBe("AIS");
    expect(congestionSourceText("ais", "live")).toBe("live");
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

  it("panel cites fuel on board", async () => {
    const fact = (id: string, value: number | string, unit: string | null): Fact => ({
      id,
      label: id,
      value,
      unit,
      provenance: { source: "db", table: "noon_reports", rowId: 4, field: id },
    });
    const facts = {
      robMt: {
        LSMGO: fact("f_rob_lsmgo", 275.5, "mt"),
        VLSFO: fact("f_rob_vlsfo", 620.25, "mt"),
        HSFO: fact("f_rob_hsfo", 0, "mt"),
      },
      voyageNo: fact("f_voyage_no", "AP-2611", null),
      nextPort: fact("f_next_port", "Piraeus", null),
      nextPortEta: fact("f_next_eta", "2026-11-16T15:45:07.200Z", null),
    };
    stubApi({ detail: { ...VESSEL_DETAIL, facts } });
    renderPage("/?vessel=1");
    const panel = await screen.findByRole("region", { name: "Vessel panel" });
    await waitFor(() => expect(panel.querySelector('[data-fact-id="f_rob_lsmgo"]')).not.toBeNull());
    for (const id of ["f_rob_vlsfo", "f_rob_hsfo", "f_voyage_no", "f_next_port", "f_next_eta"])
      expect(panel.querySelector(`[data-fact-id="${id}"]`)).not.toBeNull();
    // Cited facts never animate: no number-flow element remains for them.
    expect(panel.querySelector("number-flow-react")).toBeNull();
  });

  it("panel shows skeletons while the detail loads", async () => {
    stubApi();
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) =>
        String(input) === "/api/vessels/1"
          ? new Promise<Response>(() => {})
          : (base as typeof fetch)(input, init),
      ),
    );
    renderPage("/?vessel=1");
    const panel = await screen.findByRole("region", { name: "Vessel panel" });
    await waitFor(() => expect(panel.textContent).toContain("Next port ETA"));
    expect(panel.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(6);
    expect(panel.textContent).not.toContain("275");
    expect(panel.textContent).not.toContain("AP-2611");
  });

  it("next port ETA reads — without its fact", async () => {
    renderPage("/?vessel=1");
    const panel = await screen.findByRole("region", { name: "Vessel panel" });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/vessels/1")).toBe(true));
    const label = await within(panel).findByText("Next port ETA");
    await waitFor(() => expect(label.parentElement?.textContent).toContain("—"));
    expect(panel.textContent).not.toContain("15:45");
  });

  it("panel without voyage facts shows plain values under the simulated tag", async () => {
    renderPage("/?vessel=1");
    const panel = await screen.findByRole("region", { name: "Vessel panel" });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/vessels/1")).toBe(true));
    expect(panel.querySelector("[data-fact-id]")).toBeNull();
    expect(panel.textContent).toContain("275");
    expect(panel.textContent).toContain("AP-2611");
    expect(within(panel).getByText("simulated data")).toBeTruthy();
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

describe("stored plans from the address", () => {
  it("draws the stored route plan from ?routePlan= without posting", async () => {
    renderPage("/?vessel=1&routePlan=2");
    expect(await screen.findByTestId("route-row-B")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(calls.some((c) => c.path === "/api/route-plans/2")).toBe(true);
    expect(screen.getByText("Showing route plan 2")).toBeTruthy();
    expect(screen.getByTestId("layer-route-recommended")).toBeTruthy();
  });

  it("lights the bunker plan's ports by rank from ?bunkerPlan=", async () => {
    renderPage("/?vessel=1&bunkerPlan=1");
    expect(await screen.findByText("Showing bunker plan 1 · 3 options")).toBeTruthy();
    const best = await screen.findByTestId("bunker-port-MTMLA-kestrel");
    expect(best.getAttribute("data-best")).toBe("true");
    expect(best.textContent).toContain("1 · Kestrel Marine Fuels, Marsaxlokk");
    // The total is the plan's own fact, as a chip.
    expect(
      best.querySelector('[data-fact-id="f_plan_bunkering_1_options.0.totalCostUsd"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("bunker-port-ESALG-nordwind").getAttribute("data-best")).toBe(
      "false",
    );
    expect(screen.getByTestId("bunker-port-GIGIB-straitline").getAttribute("data-best")).toBe(
      "false",
    );
    expect(screen.getByText("Ranked by total delivered cost")).toBeTruthy();
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("says a missing plan out loud and keeps the map", async () => {
    renderPage("/?bunkerPlan=999");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Plan 999 could not be found");
    expect(within(alert).getByRole("button", { name: "Clear the plan from the map" })).toBeTruthy();
    // Every other layer still draws.
    expect(await screen.findByTestId("fleet-vessel-1")).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.queryByTestId("bunker-port-MTMLA-kestrel")).toBeNull();
  });

  it("Clear drops the plan parameter and keeps the selection", async () => {
    renderPage("/?vessel=1&bunkerPlan=1");
    await screen.findByTestId("bunker-port-MTMLA-kestrel");
    fireEvent.click(screen.getByRole("button", { name: "Clear the plan from the map" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("?vessel=1"));
    expect(screen.queryByTestId("bunker-port-MTMLA-kestrel")).toBeNull();
    expect(screen.queryByText(/Showing bunker plan/)).toBeNull();
    expect(screen.getByRole("region", { name: "Vessel panel" })).toBeTruthy();
  });

  it("Clear on a stored route plan closes its tray and keeps the selection", async () => {
    renderPage("/?vessel=1&routePlan=2");
    await screen.findByTestId("route-row-B");
    // `hidden`: while the tray is open, vaul's dialog marks the rest of the map aria-hidden.
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the plan from the map", hidden: true }),
    );
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("?vessel=1"));
    await waitFor(() => expect(screen.queryByTestId("route-row-B")).toBeNull());
    expect(screen.getByRole("region", { name: "Vessel panel" })).toBeTruthy();
  });

  it("folds the vessel panel while the route tray is open on a wide screen", async () => {
    renderPage("/?vessel=1&routePlan=2");
    await screen.findByTestId("route-row-B");
    // `hidden`: while the tray is open, vaul's dialog marks the rest of the map aria-hidden.
    const panel = screen.getByRole("region", { name: "Vessel panel", hidden: true });
    // One header row: the name, Expand and Close; the body is folded away.
    expect(panel.getAttribute("data-folded")).toBe("true");
    expect(within(panel).getByRole("heading", { level: 2, hidden: true }).textContent).toBe(
      "MV Aegean Pioneer",
    );
    expect(within(panel).queryByText("Fuel on board")).toBeNull();
    expect(within(panel).queryByText(/IMO/)).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Expand", hidden: true }));
    expect(await within(panel).findByText("Fuel on board")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Fold", hidden: true })).toBeTruthy();
  });

  it("planning again replaces the stored route plan and drops it from the address", async () => {
    renderPage("/?vessel=1&routePlan=2");
    await screen.findByTestId("route-row-B");
    const panel = screen.getByRole("region", { name: "Vessel panel", hidden: true });
    fireEvent.click(within(panel).getByRole("button", { name: "Expand", hidden: true }));
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Plan route again", hidden: true }),
    );
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("?vessel=1"));
    expect(await screen.findByTestId("route-row-B")).toBeTruthy();
    expect(screen.queryByText("Showing route plan 2")).toBeNull();
  });

  it("selecting another vessel drops a stored route plan", async () => {
    renderPage("/?vessel=1&routePlan=2");
    await screen.findByTestId("route-row-B");
    fireEvent.click(screen.getByTestId("fleet-vessel-2"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("?vessel=2"));
    await waitFor(() => expect(screen.queryByTestId("route-row-B")).toBeNull());
  });
});

describe("fleet twins in AIS traffic", () => {
  it("are not counted as public traffic", async () => {
    stubApi({ twin: true });
    renderPage();
    const toggle = await waitFor(() => {
      const el = document.querySelector('[data-layer="traffic"]');
      expect(el?.textContent).toMatch(/\d/);
      return el as Element;
    });
    expect(toggle.textContent).toMatch(new RegExp(`${TRAFFIC.items.length}\\s*$`));
  });
});
