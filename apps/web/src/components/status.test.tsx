import type { SourceStatusView } from "@pharos/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimClock } from "@/components/sim-clock";
import { DataTag, SourceBadge } from "@/components/source-badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(node: ReactNode) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("SourceBadge", () => {
  const status = (mode: "live" | "recorded"): SourceStatusView => ({
    source: "ais",
    mode,
    detail: "fixtures/recorded/ais-capture.jsonl",
    updatedAt: "2026-11-14T08:05:00Z",
  });

  it("names the source and its mode", () => {
    wrap(<SourceBadge status={status("recorded")} />);
    const badge = screen.getByText("AIS").closest("[data-source-mode]");
    expect(badge?.textContent).toBe("AIS recorded");
    expect(badge?.getAttribute("data-source-mode")).toBe("recorded");
  });

  it("marks a live source as live", () => {
    wrap(<SourceBadge status={status("live")} />);
    expect(screen.getByText("live")).toBeTruthy();
  });
});

describe("DataTag", () => {
  it("says what kind of data it is, in words", () => {
    wrap(
      <>
        <DataTag kind="simulated" />
        <DataTag kind="synthetic" />
        <DataTag kind="unverified" />
        <DataTag kind="dev-split" />
        <DataTag kind="draft" />
      </>,
    );
    for (const text of [
      "simulated data",
      "synthetic",
      "unverified",
      "dev split",
      "draft, not sent",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });
});

describe("SimClock", () => {
  it("shows a quiet placeholder until /api/clock answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })),
    );
    wrap(<SimClock />);
    expect(screen.getByLabelText("Simulation clock not available yet")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByLabelText("Simulation clock not available yet")).toBeTruthy();
  });

  it("shows the API's time in UTC and says when it is pinned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              anchor: "2026-11-14T08:00:00Z",
              now: "2026-11-14T08:05:00Z",
              pinned: true,
            }),
            { status: 200 },
          ),
      ),
    );
    wrap(<SimClock />);
    await waitFor(() => expect(screen.getByText("08:05Z")).toBeTruthy());
    expect(screen.getByText("pinned")).toBeTruthy();
    expect(screen.getByText("08:05Z").closest("time")?.getAttribute("dateTime")).toBe(
      "2026-11-14T08:05:00Z",
    );
  });
});
