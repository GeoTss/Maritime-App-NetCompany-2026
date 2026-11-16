import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/queries";
import { EvaluationPage } from "./evaluation-page";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const summary = {
  generatedAt: "2026-11-16T00:38:33.489Z",
  suites: [
    {
      suite: "extraction",
      split: "dev",
      label: "dev-x",
      model: "claude-haiku-5-5",
      promptVersion: "extract-quote/v2",
      runAt: "2026-11-15T03:39:24.789Z",
      mode: "live",
      metrics: [
        {
          key: "critical",
          label: "Critical-field accuracy",
          k: 646,
          n: 651,
          rate: 0.9923,
          ci95: [0.9821, 0.9967],
        },
        {
          key: "unsafe",
          label: "Unsafe auto-accepts (expected 0)",
          k: 0,
          n: 84,
          rate: 0,
          ci95: [0, 0.0437],
        },
      ],
      latency: [{ key: "emailMean", label: "Per email, mean", seconds: 5.45 }],
      costUsdPerItem: 0.00073,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <EvaluationPage />
    </QueryClientProvider>,
  );
}

describe("EvaluationPage", () => {
  it("intervals and counts are shown as published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(summary)),
    );
    renderPage();
    const row = await waitFor(() => {
      const el = document.querySelector('[data-metric="critical"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(row).getByText("646 of 651")).toBeTruthy();
    expect(within(row).getByText("99.2%")).toBeTruthy();
    expect(within(row).getByText("95 % interval 98.2% to 99.7%")).toBeTruthy();
    expect(screen.getByText("claude-haiku-5-5")).toBeTruthy();
    expect(screen.getByText("extract-quote/v2")).toBeTruthy();
    expect(screen.getByText("5.5 s")).toBeTruthy();
    expect(screen.getByText("USD 0.0007")).toBeTruthy();
    expect(screen.getByText("dev split")).toBeTruthy();
  });

  it("an expected-0 metric reads as a count of failures, not a success rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(summary)),
    );
    renderPage();
    const row = await waitFor(() => {
      const el = document.querySelector('[data-metric="unsafe"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(row).getByText("0 of 84")).toBeTruthy();
    expect(within(row).getByText("Target is 0; lower is better")).toBeTruthy();
    expect(row.textContent).toContain("none observed");
    expect(row.textContent).toContain("95 % upper bound 4.4%");
    expect(row.textContent).not.toContain("0.0%");
    expect(row.textContent).not.toContain("(expected 0)");
  });

  it("shows how to publish when no summary exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "no_published_summary" }, 404)),
    );
    renderPage();
    expect(await screen.findByText("No evaluation summary is published yet")).toBeTruthy();
    expect(screen.getByText("npm run eval:publish")).toBeTruthy();
  });
});
