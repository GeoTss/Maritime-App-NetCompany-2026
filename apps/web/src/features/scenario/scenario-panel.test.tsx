import type { ScenarioView } from "@pharos/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/queries";
import { ScenarioLauncher } from "./scenario-panel";

const VIEW: ScenarioView = {
  enabled: true,
  reason: null,
  edited: false,
  editedAt: null,
  vessels: [
    {
      id: 1,
      name: "MV Aegean Pioneer",
      values: {
        robMt: { LSMGO: 283, VLSFO: 629, HSFO: 0 },
        tankCapacityMt: { LSMGO: 600, VLSFO: 1500, HSFO: 0 },
        consumption: {
          refSpeedKn: 13,
          refMtPerDay: 30,
          auxMtPerDay: 2.5,
          minSpeedKn: 9,
          maxSpeedKn: 14.5,
        },
        dailyCostUsd: 16000,
        hullValueUsd: 40_000_000,
        stores: {
          crew: 22,
          provisionsPersonDays: 264,
          sludgeM3: 11,
          sludgeCapacityM3: 14,
          sewageM3: 6,
          sewageCapacityM3: 15,
        },
      },
    },
  ],
  hazards: [],
  weatherAreas: [],
};

let calls: { method: string; path: string }[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stub(view: ScenarioView) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", path: String(input) });
      return json(view);
    }),
  );
}

const renderLauncher = (pick?: { lat: number; lon: number }) => {
  const container = document.createElement("div");
  document.body.append(container);
  let listen: ((p: { lat: number; lon: number }) => void) | null = null;
  const utils = render(
    <QueryClientProvider client={createQueryClient()}>
      <ScenarioLauncher
        container={container}
        onPickRequest={(resolve) => {
          listen = resolve;
        }}
        onPreview={() => {}}
      />
    </QueryClientProvider>,
  );
  return { ...utils, pickAt: () => pick && listen?.(pick) };
};

beforeEach(() => stub(VIEW));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScenarioLauncher", () => {
  it("no button when disabled", async () => {
    stub({
      ...VIEW,
      enabled: false,
      reason: "Demo controls are off on this stack (DEMO_CONTROLS).",
    });
    renderLauncher();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/scenario")).toBe(true));
    expect(screen.queryByRole("button", { name: /scenario/i })).toBeNull();
  });

  it("invalid value blocks save", async () => {
    renderLauncher();
    fireEvent.click(await screen.findByRole("button", { name: /scenario/i }));
    const min = await screen.findByLabelText("Minimum speed (kn)");
    fireEvent.change(min, { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Maximum speed (kn)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save vessel" }));
    expect(await screen.findByText(/minimum ≤ reference ≤ maximum/)).toBeTruthy();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("pick fills lat lon", async () => {
    const { pickAt } = renderLauncher({ lat: 34, lon: 20 });
    fireEvent.click(await screen.findByRole("button", { name: /scenario/i }));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Hazards" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick on map" }));
    pickAt();
    await waitFor(() =>
      expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("34"),
    );
    expect((screen.getByLabelText("Longitude") as HTMLInputElement).value).toBe("20");
  });
});
