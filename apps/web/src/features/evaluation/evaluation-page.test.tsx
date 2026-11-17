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
          expectedZero: false,
        },
        {
          key: "unsafe",
          label: "Unsafe auto-accepts (expected 0)",
          k: 0,
          n: 84,
          rate: 0,
          ci95: [0, 0.0437],
          expectedZero: true,
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

const heldout = {
  ...summary.suites[0],
  split: "heldout",
  label: "held-x",
  runAt: "2026-11-17T09:10:11.000Z",
};
const qaDev = { ...summary.suites[0], suite: "qa", label: "qa-dev" };
const both = { ...summary, suites: [summary.suites[0], heldout, qaDev] };

describe("EvaluationPage", () => {
  it("renders one section per (suite, split), held-out before dev, each with its own tag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(both)),
    );
    renderPage();
    await waitFor(() => expect(document.querySelectorAll("section[data-suite]").length).toBe(3));
    const secs = [...document.querySelectorAll("section[data-suite]")];
    expect(secs.map((s) => s.id)).toEqual(["extraction-heldout", "extraction-dev", "qa-dev"]);
    expect(new Set(secs.map((s) => s.id)).size).toBe(3);
    expect(secs[0]?.getAttribute("data-split")).toBe("heldout");
    expect(
      within(secs[0] as HTMLElement)
        .getByText("held-out, run once")
        .getAttribute("data-kind"),
    ).toBe("heldout-split");
    expect(
      within(secs[1] as HTMLElement)
        .getByText("dev split")
        .getAttribute("data-kind"),
    ).toBe("dev-split");
    expect(secs[0]?.getAttribute("aria-labelledby")).toBe("extraction-heldout-title");
    expect(document.getElementById("extraction-dev-title")).not.toBeNull();
  });

  it("the header copy is neutral: true with dev entries only, it claims no held-out run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(summary)),
    );
    renderPage();
    await waitFor(() => expect(document.querySelectorAll("section[data-suite]").length).toBe(1));
    const intro = document.querySelector("header p");
    expect(intro?.textContent).toBe(
      "Measured accuracy of extraction and answers, from published live runs; each section names its split.",
    );
    expect(intro?.textContent).not.toMatch(/held-out|run once/i);
  });

  it('shows "held-out pending" only for a suite with no held-out entry', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(both)),
    );
    renderPage();
    await waitFor(() => expect(document.querySelectorAll("section[data-suite]").length).toBe(3));
    const pending = screen.getAllByText("held-out pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.closest("section")?.id).toBe("qa-dev");
  });

  it("the run date includes the year", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(summary)),
    );
    renderPage();
    const t = await waitFor(() => {
      const el = document.querySelector("section time");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(t.textContent).toBe("2026-11-15 03:39:24Z");
    expect(document.body.textContent).toContain("Published 2026-11-16 00:38:33Z");
  });

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
    expect(screen.queryByText("held-out, run once")).toBeNull();
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
    expect(row.textContent).toContain("Unsafe auto-accepts (expected 0)");
  });

  it("expected-zero layout reads expectedZero, not the label", async () => {
    const swap = {
      ...summary,
      suites: [
        {
          ...summary.suites[0],
          metrics: [
            {
              ...summary.suites[0]?.metrics[0],
              key: "a",
              label: "Plain (expected 0)",
              expectedZero: false,
            },
            {
              ...summary.suites[0]?.metrics[1],
              key: "b",
              label: "Hard failures",
              expectedZero: true,
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(swap)),
    );
    renderPage();
    const a = await waitFor(() => {
      const el = document.querySelector('[data-metric="a"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const b = document.querySelector('[data-metric="b"]') as HTMLElement;
    expect(within(a).queryByText("Target is 0; lower is better")).toBeNull();
    expect(a.textContent).toContain("Plain (expected 0)");
    expect(within(b).getByText("Target is 0; lower is better")).toBeTruthy();
    expect(b.textContent).toContain("Hard failures");
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
