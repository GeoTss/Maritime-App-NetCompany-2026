import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandMenuProvider } from "@/components/command-menu";
import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLayout, LAYOUT_KEY, resetLayout } from "@/lib/layout";
import { createQueryClient } from "@/lib/queries";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetLayout();
});

const renderBar = (path: string) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 })),
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <CommandMenuProvider>
          <MemoryRouter initialEntries={[path]}>
            <TopBar dockOpen onToggleDock={() => {}} />
          </MemoryRouter>
        </CommandMenuProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

describe("TopBar panel switches", () => {
  it("hides the Needs you column like the assistant, and remembers it", () => {
    renderBar("/");
    fireEvent.click(screen.getByRole("button", { name: "Hide Needs you" }));
    expect(getLayout().needs).toBe(false);
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}").needs).toBe(false);
    expect(screen.getByRole("button", { name: "Show Needs you" })).toBeTruthy();
  });

  it("focus mode hides the Needs you column too; the switches show on the map only", () => {
    renderBar("/");
    fireEvent.click(screen.getByRole("button", { name: "Focus on the map (F)" }));
    expect(getLayout().focus).toBe(true);
    expect(screen.getByRole("button", { name: "Show Needs you" })).toBeTruthy();
    cleanup();
    renderBar("/inbox");
    expect(screen.queryByRole("button", { name: /Needs you/ })).toBeNull();
    expect(screen.getByRole("button", { name: /assistant/ })).toBeTruthy();
  });
});
