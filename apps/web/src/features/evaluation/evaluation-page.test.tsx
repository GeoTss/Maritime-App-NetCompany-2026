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
    // k of N in the readout voice (Archivo at 75 % width), the rest in Archivo too.
    const kOfN = within(row).getByTestId("k-of-n");
    expect(kOfN.textContent).toBe("646 of 651");
    expect(kOfN.className).toMatch(/font-readout/);
    expect(kOfN.className).not.toMatch(/font-mono/);
    expect(within(row).getByText("99.2%")).toBeTruthy();
    // One percent style, sentence-consistent: "95%" like "99.2%".
    expect(within(row).getByText("95% interval 98.2% to 99.7%")).toBeTruthy();
    expect(row.querySelector(".font-mono")).toBeNull();
    // Mono only for what you would copy: model id, prompt version, run time.
    expect(screen.getByText("claude-haiku-5-5").className).toMatch(/font-mono/);
    expect(screen.getByText("extract-quote/v2").className).toMatch(/font-mono/);
    expect(screen.getByText("5.5 s").className).not.toMatch(/font-mono/);
    expect(screen.getByText("USD 0.0007").className).not.toMatch(/font-mono/);
    // "dev split" once per suite (the tag), and the run's live mode as a tag, not "(live)".
    expect(screen.getAllByText("dev split")).toHaveLength(1);
    expect(screen.getByText("live run").getAttribute("data-kind")).toBe("live-run");
    expect(document.body.textContent).not.toMatch(/\(live\)|95 %/);
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
    expect(within(row).getByTestId("k-of-n").textContent).toBe("0 of 84");
    expect(within(row).getByText("Target is 0; lower is better")).toBeTruthy();
    expect(row.textContent).toContain("none observed");
    expect(row.textContent).toContain("95% upper bound 4.4%");
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
