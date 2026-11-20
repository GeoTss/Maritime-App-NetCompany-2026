import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricNumber } from "@/components/metric-number";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion: reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MetricNumber", () => {
  it("is static text under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    const { container } = render(<MetricNumber value={23.5} unit="h" />);
    expect(container.textContent).toBe("23.5 h");
    expect(container.querySelector("number-flow-react")).toBeNull();
  });

  it("animates through NumberFlow otherwise, with the same display format", () => {
    mockReducedMotion(false);
    const { container } = render(<MetricNumber value={656} unit={null} />);
    const flow = container.querySelector("number-flow-react");
    expect(flow).not.toBeNull();
    // Assistive tech reads the formatted value, not the animated digits.
    expect(container.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("656");
  });
});
